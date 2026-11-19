/**
 * Sprint 12 · endpoint /admin-panel/auth/change-password
 *
 * Permite al usuario autenticado cambiar su contraseña cumpliendo la policy.
 * Este endpoint:
 *   - verifica la contraseña actual
 *   - valida la nueva contra la policy
 *   - actualiza `password`, `passwordChangedAt`
 *   - setea `mustChangePassword = false`
 */

import type { Core } from '@strapi/strapi';
import bcrypt from 'bcryptjs';
import { validatePassword } from '../services/password-policy';

type Ctx = any;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async changePassword(ctx: Ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { currentPassword, newPassword } = ctx.request.body ?? {};
    if (!currentPassword || !newPassword) {
      return ctx.badRequest('currentPassword y newPassword son requeridos.');
    }

    const full = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: user.id } });
    if (!full) return ctx.unauthorized();

    const ok = await bcrypt.compare(currentPassword, full.password);
    if (!ok) return ctx.badRequest('La contraseña actual es incorrecta.');

    if (currentPassword === newPassword) {
      return ctx.badRequest('La nueva contraseña debe ser distinta de la actual.');
    }

    const policy = validatePassword(newPassword);
    if (!policy.ok) {
      return ctx.badRequest('Contraseña débil: ' + policy.errors.join(' '));
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    return ctx.send({ ok: true });
  },
});
