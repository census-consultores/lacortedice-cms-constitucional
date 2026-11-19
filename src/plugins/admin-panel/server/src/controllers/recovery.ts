/**
 * Sprint 12b · endpoint público POST /api/admin-panel/auth/recuperar
 *
 * REDISEÑO POR TOKEN (2026-04-20):
 * ---------------------------------------------------------------------------
 * El endpoint NUNCA cambia la contraseña. Sólo genera un token firmado con
 * expiración (1h), guarda el hash del token en DB y envía al usuario un correo
 * con un link del tipo:
 *
 *     https://app.lacortedicetributaria.com/recuperar/confirmar?token=<UUID>
 *
 * La contraseña se actualiza sólo cuando el usuario entra a ese link y
 * define una nueva (ver controller `confirm-reset.ts`).
 *
 * Esto elimina el DoS del diseño anterior: ya no se puede bloquear la
 * cuenta de otra persona enviando recovery a su email.
 *
 * Garantías:
 *   - Anti-enumeración: siempre responde 200 con el mismo mensaje.
 *   - Rate-limit en memoria: 60s por email.
 *   - Token: 32 bytes random hex (64 chars), expira en 1h, single-use.
 *   - En DB guardamos el SHA-256 del token, nunca el token plano.
 */

import type { Core } from '@strapi/strapi';
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../services/mailer';

type Ctx = any;

// rate-limit en memoria (suficiente para un solo nodo Render)
const lastRequest = new Map<string, number>();
const WINDOW_MS = 60_000; // 60s entre requests por email
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

const FRONT_BASE_URL =
  process.env.PUBLIC_WEB_URL ??
  process.env.FRONT_BASE_URL ??
  'https://app.lacortedicetributaria.com';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async request(ctx: Ctx) {
    const rawEmail = (ctx.request.body?.email ?? '').toString().trim().toLowerCase();

    const genericOk = {
      ok: true,
      message: 'Si existe una cuenta con ese correo, recibirás un mensaje en los próximos minutos.',
    };

    if (!rawEmail || !rawEmail.includes('@')) {
      return ctx.send(genericOk);
    }

    // rate-limit 60s por email
    const now = Date.now();
    const prev = lastRequest.get(rawEmail);
    if (prev && now - prev < WINDOW_MS) {
      return ctx.send(genericOk);
    }
    lastRequest.set(rawEmail, now);

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email: rawEmail, blocked: false },
    });

    if (!user) {
      strapi.log.info(`[recovery] intento para email no registrado: ${rawEmail}`);
      return ctx.send(genericOk);
    }

    // Genera token plano + hash para DB
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(tokenPlain);
    const expiresAt = new Date(now + TOKEN_TTL_MS);

    // IMPORTANTE: sólo actualizamos los campos de token. NO tocamos password.
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetTokenExpiresAt: expiresAt,
        passwordResetRequestedAt: new Date(),
      },
    });

    const nombre = (user.username || user.email.split('@')[0] || 'colega').trim();
    const resetUrl = `${FRONT_BASE_URL.replace(/\/$/, '')}/recuperar/confirmar?token=${encodeURIComponent(tokenPlain)}`;

    const mail = await sendPasswordResetEmail({
      to: user.email,
      nombre,
      email: user.email,
      resetUrl,
      expiresAt,
    });

    if (mail.dryRun) {
      strapi.log.warn(`[recovery] SMTP no configurado · reset URL para ${user.email}: ${resetUrl}`);
    } else if (!mail.sent) {
      strapi.log.error(`[recovery] falló envío a ${user.email}: ${mail.error}`);
      // Nota: aunque el correo falle, el token ya se guardó. Si el admin
      // recupera el link desde los logs, aún sirve dentro de la ventana.
    } else {
      strapi.log.info(`[recovery] link enviado a ${user.email} (exp ${expiresAt.toISOString()})`);
    }

    return ctx.send(genericOk);
  },
});
