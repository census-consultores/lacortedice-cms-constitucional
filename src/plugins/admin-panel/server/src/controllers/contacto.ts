/**
 * Endpoint público POST /api/admin-panel/contacto/send
 *
 * Recibe el formulario de contacto de la landing
 * (lacortedicetributaria.com) y envía el mensaje por mail vía Titan SMTP
 * al destinatario configurado en CONTACTO_DESTINO (o el FROM por default).
 *
 * Diseño:
 *   - auth: false → cualquiera puede llamarlo, la landing no requiere JWT.
 *   - Rate limit en memoria por IP: 3 envíos / 10 min.
 *     Devuelve 429 con header Retry-After cuando se supera; la landing
 *     respeta esto y NO reintenta.
 *   - Validación estricta: nombre/mensaje no vacíos, email parseable.
 *     Devuelve 400 cuando algo falla — la landing tampoco reintenta.
 *   - Sanitización mínima de los inputs antes de meterlos al subject o
 *     al body del mail (escape HTML + strip de \r/\n para evitar header
 *     injection vía CR/LF).
 *   - Idempotency-Key opcional: si el header viene y ya vimos esa clave
 *     en los últimos 10 min, devolvemos 200 sin reenviar el mail. Cubre
 *     el caso de la cola del cliente que re-envía mensajes encolados.
 *   - El email se envía vía el helper sendMail() que ya existe en el
 *     plugin (services/mailer.ts). Reply-To: el email del visitante,
 *     para que el admin pueda responder desde su cliente.
 *
 * Errores transitorios (SMTP caído, etc.) → 500. La landing reintenta
 * 3 veces con backoff y, si falla, encola en localStorage.
 */

import type { Core } from '@strapi/strapi';
import { sendMail } from '../services/mailer';

type Ctx = any;

// --- Rate limit por IP ----------------------------------------------------
//
// In-memory, suficiente para un solo nodo de Render. Si se escala
// horizontalmente, migrar a Redis o equivalente.
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RL_MAX = 3;
const ipBuckets = new Map<string, number[]>(); // ip → timestamps de envíos exitosos

function rateLimitOk(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const cutoff = now - RL_WINDOW_MS;
  const arr = (ipBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= RL_MAX) {
    const oldest = arr[0];
    return { ok: false, retryAfter: Math.ceil((oldest + RL_WINDOW_MS - now) / 1000) };
  }
  arr.push(now);
  ipBuckets.set(ip, arr);
  return { ok: true };
}

// --- Idempotency cache ----------------------------------------------------
const IDEM_TTL_MS = 10 * 60 * 1000;
const idemCache = new Map<string, number>(); // key → expiresAt

function idemSeen(key: string): boolean {
  const now = Date.now();
  // Cleanup lazy
  for (const [k, exp] of idemCache) {
    if (exp < now) idemCache.delete(k);
  }
  return idemCache.has(key);
}

function idemRemember(key: string): void {
  idemCache.set(key, Date.now() + IDEM_TTL_MS);
}

// --- Validación + sanitización -------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip CR/LF para subject + headers (defensa contra CRLF injection que
// permitiría a un atacante inyectar headers extras tipo Bcc:).
function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, ' ');
}

function clientIp(ctx: Ctx): string {
  // Strapi usa koa, ctx.ip respeta x-forwarded-for si proxy.trust=true.
  // Como Render mete reverse proxy, esta vía suele dar la IP real.
  return ctx.ip || ctx.request?.ip || 'unknown';
}

const DESTINO =
  process.env.CONTACTO_DESTINO ||
  process.env.SMTP_FROM_EMAIL ||
  'info@lacortedicetributaria.com';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async send(ctx: Ctx) {
    // Body parsing — koa lo deja en ctx.request.body si content-type es JSON.
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const nombre = String(body.nombre ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const asunto = String(body.asunto ?? '').trim();
    const mensaje = String(body.mensaje ?? '').trim();

    // ── Idempotencia ────────────────────────────────────────────────
    const idemKey = (ctx.request.headers['idempotency-key'] as string | undefined)?.trim();
    if (idemKey && idemSeen(idemKey)) {
      ctx.status = 200;
      ctx.body = { ok: true, dedupedByIdempotencyKey: true };
      return;
    }

    // ── Validación ──────────────────────────────────────────────────
    if (!nombre) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'nombre requerido' };
      return;
    }
    if (!email || !EMAIL_RE.test(email)) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'email inválido' };
      return;
    }
    if (!asunto) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'asunto requerido' };
      return;
    }
    if (!mensaje || mensaje.length < 5) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'mensaje requerido (mín 5 chars)' };
      return;
    }
    // Topes de longitud para evitar abuso del cuerpo del mail.
    if (nombre.length > 200 || asunto.length > 200 || mensaje.length > 5000) {
      ctx.status = 400;
      ctx.body = { ok: false, error: 'contenido demasiado largo' };
      return;
    }

    // ── Rate limit ──────────────────────────────────────────────────
    const ip = clientIp(ctx);
    const rl = rateLimitOk(ip);
    if (!rl.ok) {
      ctx.status = 429;
      ctx.set('Retry-After', String(rl.retryAfter ?? 60));
      ctx.body = { ok: false, error: 'Demasiados envíos, esperá unos minutos.' };
      return;
    }

    // ── Envío del mail ──────────────────────────────────────────────
    const safeNombre = stripCrlf(nombre);
    const safeAsunto = stripCrlf(asunto);
    const safeNombreHtml = escapeHtml(safeNombre);
    const safeAsuntoHtml = escapeHtml(safeAsunto);
    const safeMensajeHtml = escapeHtml(mensaje).replace(/\n/g, '<br>');

    // Subject del mail: usa el asunto del visitante prefijado con [Web]
    // para distinguir de otros mails internos.
    const subject = `[Web] ${safeAsunto}`;
    const text =
`Asunto: ${safeAsunto}
Nombre: ${safeNombre}
Email de respuesta: ${email}

Mensaje:
${mensaje}

---
Enviado desde el formulario de contacto de lacortedicetributaria.com
IP: ${ip}`;

    const html = `<!doctype html>
<html><body style="font-family: -apple-system, sans-serif; font-size: 14px; color: #1a1a1a; line-height: 1.5;">
  <h2 style="margin: 0 0 12px; color: #b48a47;">Nueva consulta desde la landing</h2>
  <p><strong>Asunto:</strong> ${safeAsuntoHtml}</p>
  <p><strong>Nombre:</strong> ${safeNombreHtml}</p>
  <p><strong>Email de respuesta:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
  <p style="margin-top: 16px;"><strong>Mensaje:</strong></p>
  <div style="white-space: pre-wrap; padding: 12px 14px; background: #fafafa; border-left: 3px solid #b48a47; border-radius: 4px;">${safeMensajeHtml}</div>
  <hr style="margin: 24px 0; border: 0; border-top: 1px solid #e5e7eb;">
  <p style="font-size: 12px; color: #6b7280;">
    Enviado desde el formulario de contacto de
    <a href="https://lacortedicetributaria.com">lacortedicetributaria.com</a><br>
    IP: ${escapeHtml(ip)}
  </p>
</body></html>`;

    const result = await sendMail({
      to: DESTINO,
      subject: stripCrlf(subject),
      html,
      text,
      replyTo: email,
    });

    if (result.dryRun) {
      strapi.log.warn(`[contacto] SMTP no configurado · DRY-RUN. From: ${email} <${safeNombre}>`);
      // En dry-run respondemos 200 para que el dev no se atasque, pero NO
      // marcamos la idempotencia (que el cliente pueda reintentar cuando
      // SMTP esté listo). El mensaje no llegó a destino.
      ctx.status = 200;
      ctx.body = { ok: true, dryRun: true };
      return;
    }

    if (!result.sent) {
      strapi.log.error(`[contacto] SMTP falló para mensaje de ${email}: ${result.error}`);
      ctx.status = 500;
      ctx.body = { ok: false, error: 'No se pudo enviar el mensaje, intentá de nuevo.' };
      return;
    }

    if (idemKey) idemRemember(idemKey);
    strapi.log.info(`[contacto] mensaje de ${email} (${safeNombre}) enviado a ${DESTINO}`);
    ctx.status = 200;
    ctx.body = { ok: true };
  },
});
