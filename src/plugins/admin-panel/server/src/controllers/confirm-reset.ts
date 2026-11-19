/**
 * Sprint 12b · endpoint público POST /api/admin-panel/auth/recuperar/confirmar
 *
 * Recibe { token, newPassword }. Si el token es válido (existe, no expiró,
 * coincide con el hash en DB), actualiza la contraseña del usuario y
 * invalida el token para que no pueda reutilizarse.
 *
 * Después de esto:
 *   - password queda como la nueva contraseña elegida por el usuario
 *   - mustChangePassword = false (porque ya eligió una propia)
 *   - passwordResetTokenHash = null
 *   - passwordResetTokenExpiresAt = null
 *   - passwordChangedAt = NOW()
 *
 * Respuestas:
 *   - 400 si el token está malformado, expiró, o la contraseña no cumple
 *     la policy.
 *   - 200 con { ok: true, email } si el reset fue exitoso (la webapp
 *     manda al usuario a /login con pre-fill del email).
 *
 * Notas de seguridad:
 *   - Sólo se identifica al usuario por el token (single-source-of-truth).
 *     El email del formulario es cosmético / para UX.
 *   - Token single-use: al completar, se blanquean los campos.
 */

import type { Core } from '@strapi/strapi';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { validatePassword } from '../services/password-policy';

type Ctx = any;

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async confirm(ctx: Ctx) {
    const { token, newPassword } = (ctx.request.body ?? {}) as {
      token?: string;
      newPassword?: string;
    };

    if (!token || typeof token !== 'string' || token.length < 32) {
      return ctx.badRequest('Token inválido.');
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return ctx.badRequest('newPassword es requerido.');
    }

    const policy = validatePassword(newPassword);
    if (!policy.ok) {
      return ctx.badRequest('Contraseña débil: ' + policy.errors.join(' '));
    }

    const tokenHash = sha256Hex(token);

    // Búsqueda por hash del token. Strapi no indexa este campo,
    // pero la tabla up_users es pequeña (pocos cientos de filas).
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { passwordResetTokenHash: tokenHash, blocked: false },
    });

    if (!user) {
      return ctx.badRequest('El link es inválido o ya fue utilizado.');
    }

    const expiresAt = (user as any).passwordResetTokenExpiresAt;
    if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
      // Limpiamos igual el campo para no dejar basura
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: null,
          passwordResetTokenExpiresAt: null,
        },
      });
      return ctx.badRequest('El link expiró. Pide una nueva recuperación.');
    }

    // Todo OK: actualizamos password + limpiamos token
    const hashed = await bcrypt.hash(newPassword, 10);

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        password: hashed,
        passwordResetTokenHash: null,
        passwordResetTokenExpiresAt: null,
        passwordChangedAt: new Date(),
        // si el usuario tenía mustChangePassword=true por haber sido creado
        // con contraseña temporal, al pasar por recuperación también queda
        // saneado (eligió una nueva propia).
        mustChangePassword: false,
      },
    });

    strapi.log.info(`[recovery-confirm] password actualizada para ${user.email}`);

    return ctx.send({
      ok: true,
      email: user.email,
    });
  },

  // Endpoint auxiliar para que el frontend pueda mostrar un mensaje
  // "Tu link expiró" antes de que el usuario escriba su nueva contraseña.
  async inspect(ctx: Ctx) {
    const token = (ctx.request.body?.token ?? ctx.query?.token ?? '').toString();
    if (!token || token.length < 32) {
      return ctx.send({ valid: false, reason: 'invalid' });
    }
    const tokenHash = sha256Hex(token);
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { passwordResetTokenHash: tokenHash, blocked: false },
      select: ['email', 'passwordResetTokenExpiresAt'],
    });
    if (!user) {
      return ctx.send({ valid: false, reason: 'invalid' });
    }
    const expiresAt = (user as any).passwordResetTokenExpiresAt;
    if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
      return ctx.send({ valid: false, reason: 'expired' });
    }
    return ctx.send({
      valid: true,
      email: user.email,
      expiresAt,
    });
  },
});
