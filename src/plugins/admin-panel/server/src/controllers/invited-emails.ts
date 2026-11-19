/**
 * Sprint registro-whitelist · endpoints ADMIN de la whitelist `invited_emails`.
 *
 * Todos protegidos por la policy `plugin::admin-panel.isAdmin` aplicada
 * en `routes/content-api.ts`. Aquí asumimos que ctx.state.user existe y es
 * admin/superadmin.
 *
 * Endpoints (7):
 *   - POST   /admin-panel/invited-emails/bulk                  → carga CSV/XLSX parseado
 *   - POST   /admin-panel/invited-emails                       → alta manual
 *   - GET    /admin-panel/invited-emails                       → listado paginado
 *   - DELETE /admin-panel/invited-emails/:id                   → borrado (bloquea verified)
 *   - POST   /admin-panel/invited-emails/:id/resend            → reenviar magic link (post-form)
 *   - POST   /admin-panel/invited-emails/:id/resend-welcome    → reenviar correo de bienvenida
 *   - GET    /admin-panel/invited-emails/stats                 → métricas funnel
 *
 * Notificaciones de bienvenida: bulk crea filas con welcomeEmailStatus='pending'
 * y dispara un sender background con throttle de ~600ms entre mails. El admin
 * ve la tabla con cada fila pasando de pending → sent / failed. Las filas con
 * failed exponen un botón de reenvío manual.
 */

import type { Core } from '@strapi/strapi';
import crypto from 'crypto';
import {
  sendInvitationVerificationEmail,
  sendInvitationWelcomeEmail,
} from '../services/mailer';

type Ctx = any;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESENDS = 15;
const BULK_LIMIT = 5000;

// Titan Mail nos permite 200 correos/hora a nivel de cuenta. Dejamos margen
// generoso para los demás correos del día a día (magic links de registro,
// password reset, welcome de altas manuales, broadcast) y limitamos los
// flujos masivos de invitaciones a 20/h: 3600s / 20 = 180s.
const BULK_MAIL_THROTTLE_MS = 180_000;

// Cap de intentos en el welcome. Después de N fallos seguramente es bounce
// permanente o cuenta inválida — no tiene sentido seguir reintentando.
const MAX_WELCOME_ATTEMPTS = 5;

const FRONT_BASE_URL =
  process.env.PUBLIC_WEB_URL ??
  process.env.FRONT_BASE_URL ??
  'https://app.lacortedicetributaria.com';

function registroUrl(): string {
  return `${FRONT_BASE_URL.replace(/\/$/, '')}/registro`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Estado en memoria del job bulk-resend-welcome.
//
// Se mantiene module-level para evitar disparar dos jobs simultáneos (un
// admin haciendo doble click duplicaría envíos y dispararía el rate-limit).
// Si el proceso muere a mitad, los invited_emails que quedaron en `failed`
// siguen en `failed` y un nuevo click los reintenta. No hay persistencia
// del progreso en BD a propósito: este job es siempre reanudable desde
// cero porque la query selecciona dinámicamente los que aún están failed.
// ---------------------------------------------------------------------------
interface BulkResendState {
  running: boolean;
  startedAt: Date | null;
  total: number;
  done: number;
  ok: number;
  failed: number;
  skipped: number;
  pausedUntil: Date | null;
  lastError: string | null;
  finishedAt: Date | null;
}

const bulkResendState: BulkResendState = {
  running: false,
  startedAt: null,
  total: 0,
  done: 0,
  ok: 0,
  failed: 0,
  skipped: 0,
  pausedUntil: null,
  lastError: null,
  finishedAt: null,
};

// Parsea el "till [time=2026-05-19 23:25:31 UTC]" del error 550 de Titan
// y devuelve un Date hasta el cual hay que pausar. Null si no matchea.
function parseTitanQuotaUntil(errorMessage: string): Date | null {
  const m = errorMessage.match(/till\s*\[time=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*UTC\]/i);
  if (!m) return null;
  const parsed = new Date(m[1].replace(' ', 'T') + 'Z');
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isTitanQuotaError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return /5\.4\.6\s*Sender Hourly Quota Exceeded/i.test(errorMessage);
}

/**
 * Envía el welcome a un solo registro y persiste el resultado. No lanza:
 * captura errores y los marca como `failed` en la BD.
 *
 * Se usa tanto desde `create` (alta manual, síncrono) como desde el sender
 * background del `bulk` y desde `resendWelcome`.
 */
async function sendWelcomeAndPersist(
  strapi: Core.Strapi,
  row: { id: number; email: string; university?: string | null; welcomeEmailAttempts?: number | null },
): Promise<{ sent: boolean; dryRun: boolean; error?: string }> {
  const attempts = (row.welcomeEmailAttempts ?? 0) + 1;
  try {
    const r = await sendInvitationWelcomeEmail({
      to: row.email,
      email: row.email,
      university: row.university ?? null,
      registroUrl: registroUrl(),
    });

    // DRY-RUN cuenta como "sent" para no dejar la fila en pending eternamente
    // mientras SMTP no esté configurado. El log ya lo marca como dry-run.
    if (r.sent || r.dryRun) {
      await strapi.db.query('api::invited-email.invited-email').update({
        where: { id: row.id },
        data: {
          welcomeEmailStatus: 'sent',
          welcomeEmailSentAt: new Date(),
          welcomeEmailError: null,
          welcomeEmailAttempts: attempts,
        },
      });
      return { sent: true, dryRun: r.dryRun };
    }

    await strapi.db.query('api::invited-email.invited-email').update({
      where: { id: row.id },
      data: {
        welcomeEmailStatus: 'failed',
        welcomeEmailError: r.error ?? 'unknown_error',
        welcomeEmailAttempts: attempts,
      },
    });
    return { sent: false, dryRun: false, error: r.error };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await strapi.db.query('api::invited-email.invited-email').update({
      where: { id: row.id },
      data: {
        welcomeEmailStatus: 'failed',
        welcomeEmailError: message,
        welcomeEmailAttempts: attempts,
      },
    });
    return { sent: false, dryRun: false, error: message };
  }
}

/**
 * Envía el magic link de verificación y persiste el resultado en los
 * campos `magicLink*` de la fila. Patrón idéntico a `sendWelcomeAndPersist`
 * pero para el segundo correo del flujo (verificación post-form).
 *
 * Compartido por `registration.completar()` (primer envío tras formulario)
 * y por `invited-emails.resend()` (reenvío manual desde admin). Por eso se
 * exporta.
 *
 * NO genera el token ni actualiza `registrationTokenHash` / `tokenExpiresAt`
 * — eso es responsabilidad del caller (cada flujo tiene su propia lógica
 * de generación). Esta función solo manda el correo y registra el outcome.
 */
export async function sendMagicLinkAndPersist(
  strapi: Core.Strapi,
  row: {
    id: number;
    email: string;
    nombre: string;
    university?: string | null;
    magicLinkAttempts?: number | null;
  },
  verifyUrl: string,
  expiresAt: Date,
): Promise<{ sent: boolean; dryRun: boolean; error?: string }> {
  const attempts = (row.magicLinkAttempts ?? 0) + 1;
  try {
    const r = await sendInvitationVerificationEmail({
      to: row.email,
      nombre: row.nombre,
      email: row.email,
      university: row.university ?? '',
      verifyUrl,
      expiresAt,
    });

    if (r.sent || r.dryRun) {
      await strapi.db.query('api::invited-email.invited-email').update({
        where: { id: row.id },
        data: {
          magicLinkStatus: 'sent',
          magicLinkSentAt: new Date(),
          magicLinkError: null,
          magicLinkAttempts: attempts,
        },
      });
      return { sent: true, dryRun: r.dryRun };
    }

    await strapi.db.query('api::invited-email.invited-email').update({
      where: { id: row.id },
      data: {
        magicLinkStatus: 'failed',
        magicLinkError: r.error ?? 'unknown_error',
        magicLinkAttempts: attempts,
      },
    });
    return { sent: false, dryRun: false, error: r.error };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await strapi.db.query('api::invited-email.invited-email').update({
      where: { id: row.id },
      data: {
        magicLinkStatus: 'failed',
        magicLinkError: message,
        magicLinkAttempts: attempts,
      },
    });
    return { sent: false, dryRun: false, error: message };
  }
}

/**
 * Sender background del bulk. Itera los registros recién creados con un
 * throttle entre envíos. NO se hace await desde el endpoint — corre en el
 * proceso de Node después de que la respuesta HTTP ya se envió. Si el
 * proceso muere a mitad, las filas restantes quedan en `pending` y el admin
 * puede reenviarlas manualmente.
 */
async function sendWelcomeBatch(
  strapi: Core.Strapi,
  rows: Array<{ id: number; email: string; university?: string | null }>,
): Promise<void> {
  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const r = await sendWelcomeAndPersist(strapi, row);
    if (r.sent) ok++;
    else fail++;
    if (rows.length > 1) await sleep(BULK_MAIL_THROTTLE_MS);
  }
  strapi.log.info(`[invited-emails:welcome-batch] done sent=${ok} failed=${fail} total=${rows.length}`);
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeEmail(raw: any): string {
  return String(raw ?? '').trim().toLowerCase();
}

// Campos que se pueden devolver públicamente (sin tokenHash ni expiresAt).
const SAFE_FIELDS = [
  'id',
  'email',
  'status',
  'university',
  'program',
  'invitedAt',
  'formStartedAt',
  'formCompletedAt',
  'verifiedAt',
  'lastEmailSentAt',
  'resendsCount',
  'batchId',
  'notes',
  'welcomeEmailStatus',
  'welcomeEmailSentAt',
  'welcomeEmailError',
  'welcomeEmailAttempts',
  'magicLinkStatus',
  'magicLinkSentAt',
  'magicLinkError',
  'magicLinkAttempts',
  'createdAt',
  'updatedAt',
];

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Bulk insert desde CSV ya parseado por la webapp. */
  async bulk(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      batchId?: string;
      items?: Array<{ email?: string; university?: string; program?: string }>;
    };

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return ctx.badRequest('items_required');
    if (items.length > BULK_LIMIT) return ctx.badRequest(`bulk_limit_${BULK_LIMIT}`);

    const batchId = body.batchId ?? `batch_${Date.now()}`;
    const invitedById = ctx.state.user?.id ?? null;

    let created = 0;
    let skipped = 0;
    const invalid: Array<{ email: string; reason: string }> = [];
    // IDs de los recién creados para que el sender background los procese
    // sin necesidad de un segundo query.
    const createdRows: Array<{ id: number; email: string; university: string | null }> = [];

    for (const raw of items) {
      const email = normalizeEmail(raw.email);
      const university = raw.university ? String(raw.university).trim() : null;
      const program = raw.program ? String(raw.program).trim() : null;

      if (!email || !EMAIL_RE.test(email)) {
        invalid.push({ email: String(raw.email ?? ''), reason: 'email_invalid' });
        continue;
      }

      try {
        const existing = await strapi.db
          .query('api::invited-email.invited-email')
          .findOne({ where: { email } });

        if (existing) {
          skipped++;
          continue;
        }

        const row = await strapi.db.query('api::invited-email.invited-email').create({
          data: {
            email,
            status: 'invited',
            university,
            program,
            invitedAt: new Date(),
            batchId,
            invitedBy: invitedById,
            resendsCount: 0,
            welcomeEmailStatus: 'pending',
            welcomeEmailAttempts: 0,
          },
        });
        created++;
        createdRows.push({ id: row.id, email: row.email, university: row.university ?? null });
      } catch (e: any) {
        strapi.log.error(`[invited-emails:bulk] error en ${email}: ${e.message}`);
        invalid.push({ email, reason: 'db_error' });
      }
    }

    strapi.log.info(`[invited-emails:bulk] batch=${batchId} created=${created} skipped=${skipped} invalid=${invalid.length}`);

    // Fire-and-forget: el sender procesa los mails en background con throttle.
    // El admin ve las filas en `pending` y van pasando a `sent`/`failed`.
    if (createdRows.length > 0) {
      sendWelcomeBatch(strapi, createdRows).catch((err) => {
        strapi.log.error(`[invited-emails:welcome-batch] crash: ${err?.message ?? err}`);
      });
    }

    return ctx.send({
      batchId,
      total: items.length,
      created,
      skipped_duplicates: skipped,
      invalid,
      welcome_emails_pending: createdRows.length,
    });
  },

  /** Alta manual de un solo correo. */
  async create(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      email?: string;
      university?: string;
      program?: string;
      notes?: string;
    };

    const email = normalizeEmail(body.email);
    const university = body.university ? String(body.university).trim() : null;

    if (!email || !EMAIL_RE.test(email)) return ctx.badRequest('email_invalid');

    const existing = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { email } });

    if (existing) return ctx.conflict('already_invited');

    const created = await strapi.db.query('api::invited-email.invited-email').create({
      data: {
        email,
        status: 'invited',
        university,
        program: body.program ? String(body.program).trim() : null,
        notes: body.notes ? String(body.notes).trim() : null,
        invitedAt: new Date(),
        invitedBy: ctx.state.user?.id ?? null,
        resendsCount: 0,
        welcomeEmailStatus: 'pending',
        welcomeEmailAttempts: 0,
      },
    });

    // Síncrono: alta manual = un solo correo. El admin espera el resultado
    // y el toast del frontend le dice si se envió o falló.
    const mailRes = await sendWelcomeAndPersist(strapi, {
      id: created.id,
      email: created.email,
      university: created.university ?? null,
      welcomeEmailAttempts: 0,
    });

    // Re-leemos para devolver los campos actualizados de welcomeEmail*.
    const fresh = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { id: created.id } });

    return ctx.send({
      ok: true,
      item: pickSafe(fresh ?? created),
      welcomeEmail: { sent: mailRes.sent, dryRun: mailRes.dryRun, error: mailRes.error },
    });
  },

  /** Listado paginado con filtros (status, university, search, batchId). */
  async list(ctx: Ctx) {
    const q = ctx.query ?? {};
    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize ?? '25'), 10) || 25));
    const status = q.status ? String(q.status) : null;
    const university = q.university ? String(q.university) : null;
    const search = q.search ? String(q.search).trim().toLowerCase() : null;
    const batchId = q.batchId ? String(q.batchId) : null;

    const where: any = {};
    if (status) {
      // Acepta uno solo (`invited`) o varios separados por coma
      // (`form_started,pending_verification`) para agrupar tabs del funnel.
      const list = status.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length > 1) where.status = { $in: list };
      else if (list.length === 1) where.status = list[0];
    }
    if (university) where.university = university;
    if (batchId) where.batchId = batchId;
    if (search) where.email = { $containsi: search };

    const [rows, total] = await Promise.all([
      strapi.db.query('api::invited-email.invited-email').findMany({
        where,
        offset: (page - 1) * pageSize,
        limit: pageSize,
        orderBy: { invitedAt: 'desc' },
      }),
      strapi.db.query('api::invited-email.invited-email').count({ where }),
    ]);

    return ctx.send({
      data: rows.map(pickSafe),
      pagination: {
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        total,
      },
    });
  },

  /** Borrar registro (bloquea si status=verified). */
  async delete(ctx: Ctx) {
    const id = parseInt(String(ctx.params?.id ?? ''), 10);
    if (!Number.isFinite(id)) return ctx.badRequest('id_invalid');

    const invited = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { id } });

    if (!invited) return ctx.notFound('not_found');

    if (invited.status === 'verified') {
      return ctx.badRequest('cannot_delete_verified');
    }

    await strapi.db.query('api::invited-email.invited-email').delete({ where: { id } });
    strapi.log.info(`[invited-emails:delete] id=${id} email=${invited.email}`);

    return ctx.send({ ok: true });
  },

  /** Reenviar magic link a un correo en pending_verification. */
  async resend(ctx: Ctx) {
    const id = parseInt(String(ctx.params?.id ?? ''), 10);
    if (!Number.isFinite(id)) return ctx.badRequest('id_invalid');

    const invited = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { id }, populate: { user: true } });

    if (!invited) return ctx.notFound('not_found');
    if (!['pending_verification', 'form_started'].includes(invited.status)) {
      return ctx.badRequest('invalid_status');
    }
    if (!invited.user) return ctx.badRequest('no_user_associated');
    if (invited.user.confirmed) return ctx.badRequest('already_confirmed');
    if ((invited.resendsCount ?? 0) >= MAX_RESENDS) {
      return ctx.tooManyRequests('max_resends_reached');
    }

    const tokenPlain = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(tokenPlain);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await strapi.db.query('api::invited-email.invited-email').update({
      where: { id },
      data: {
        registrationTokenHash: tokenHash,
        tokenExpiresAt: expiresAt,
        lastEmailSentAt: new Date(),
        resendsCount: (invited.resendsCount ?? 0) + 1,
      },
    });

    const verifyUrl = `${FRONT_BASE_URL.replace(/\/$/, '')}/registro/verificar/${tokenPlain}`;
    const nombre = `${invited.user.firstName ?? ''} ${invited.user.lastName ?? ''}`.trim() || invited.email;

    const r = await sendMagicLinkAndPersist(
      strapi,
      {
        id: invited.id,
        email: invited.email,
        nombre,
        university: invited.university,
        magicLinkAttempts: invited.magicLinkAttempts,
      },
      verifyUrl,
      expiresAt,
    );

    if (r.dryRun) {
      strapi.log.warn(`[invited-emails:resend] DRY-RUN verify URL para ${invited.email}: ${verifyUrl}`);
    } else if (!r.sent) {
      strapi.log.error(`[invited-emails:resend] falló envío a ${invited.email}: ${r.error}`);
    } else {
      strapi.log.info(`[invited-emails:resend] reenviado a ${invited.email}`);
    }

    return ctx.send({ ok: true, dryRun: r.dryRun, sent: r.sent });
  },

  /**
   * Reenviar el correo de bienvenida (welcome) a un invitado.
   *
   * Permitido cuando welcomeEmailStatus es `failed` o `pending`. Si ya está
   * en `sent`, devolvemos 400 para evitar spam accidental (el botón en la UI
   * solo aparece para failed/pending, esto es defensa adicional).
   *
   * No requiere que el status del funnel sea `invited` — un row que
   * accidentalmente avanzó pero falló el welcome inicial también debería
   * poder reintentarse.
   */
  async resendWelcome(ctx: Ctx) {
    const id = parseInt(String(ctx.params?.id ?? ''), 10);
    if (!Number.isFinite(id)) return ctx.badRequest('id_invalid');

    const invited = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { id } });

    if (!invited) return ctx.notFound('not_found');
    if (invited.welcomeEmailStatus === 'sent') {
      return ctx.badRequest('already_sent');
    }

    const r = await sendWelcomeAndPersist(strapi, {
      id: invited.id,
      email: invited.email,
      university: invited.university ?? null,
      welcomeEmailAttempts: invited.welcomeEmailAttempts ?? 0,
    });

    if (r.dryRun) {
      strapi.log.warn(`[invited-emails:resend-welcome] DRY-RUN ${invited.email}`);
    } else if (!r.sent) {
      strapi.log.error(`[invited-emails:resend-welcome] falló envío a ${invited.email}: ${r.error}`);
    } else {
      strapi.log.info(`[invited-emails:resend-welcome] reenviado a ${invited.email}`);
    }

    const fresh = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { id } });

    return ctx.send({
      ok: true,
      sent: r.sent,
      dryRun: r.dryRun,
      error: r.error,
      item: pickSafe(fresh),
    });
  },

  /**
   * Reintento masivo del correo de bienvenida para todos los invitados que
   * quedaron en welcomeEmailStatus='failed'. Útil cuando Titan rechazó por
   * "Sender Hourly Quota Exceeded" durante el bulk inicial.
   *
   * Comportamiento:
   *   - Selecciona failed con welcomeEmailAttempts < MAX_WELCOME_ATTEMPTS
   *     (los que ya pasaron N intentos se omiten — probable bounce permanente).
   *   - Responde 202 inmediato con { queued, etaMinutes }.
   *   - El envío corre en background con throttle de BULK_MAIL_THROTTLE_MS
   *     entre correos (= 100/h por defecto, dentro del cuota Titan).
   *   - Si Titan devuelve "550 Quota Exceeded", parsea la hora UTC del mensaje
   *     y pausa hasta esa hora antes de continuar — no aborta el job.
   *   - Singleton: si ya hay un job corriendo, responde 409 con el estado.
   *
   * El estado se consulta en GET /invited-emails/bulk-resend-welcome/status.
   */
  async bulkResendWelcome(ctx: Ctx) {
    if (bulkResendState.running) {
      return ctx.conflict('already_running', { state: bulkResendState });
    }

    const knex = strapi.db.connection;
    const rows = (await knex('invited_emails')
      .select('id', 'email', 'university', 'welcome_email_attempts')
      .where('welcome_email_status', 'failed')
      .andWhere((qb: any) =>
        qb.where('welcome_email_attempts', '<', MAX_WELCOME_ATTEMPTS).orWhereNull('welcome_email_attempts'),
      )) as Array<{ id: number; email: string; university: string | null; welcome_email_attempts: number | null }>;

    if (rows.length === 0) {
      return ctx.send({ queued: 0, etaMinutes: 0, message: 'no_failed_to_resend' });
    }

    // Reset + arranque del estado.
    bulkResendState.running = true;
    bulkResendState.startedAt = new Date();
    bulkResendState.total = rows.length;
    bulkResendState.done = 0;
    bulkResendState.ok = 0;
    bulkResendState.failed = 0;
    bulkResendState.skipped = 0;
    bulkResendState.pausedUntil = null;
    bulkResendState.lastError = null;
    bulkResendState.finishedAt = null;

    // Background. NO se hace await: la respuesta sale inmediata y el loop
    // sigue corriendo en el proceso de Node.
    (async () => {
      strapi.log.info(`[invited-emails:bulk-resend-welcome] start total=${rows.length}`);
      try {
        for (const row of rows) {
          // Si el job se canceló desde fuera (futuro), salir limpio.
          if (!bulkResendState.running) break;

          // Honrar pausa por quota si aplica.
          if (bulkResendState.pausedUntil && bulkResendState.pausedUntil > new Date()) {
            const waitMs = bulkResendState.pausedUntil.getTime() - Date.now();
            strapi.log.warn(
              `[invited-emails:bulk-resend-welcome] pausado por quota Titan hasta ${bulkResendState.pausedUntil.toISOString()} (${Math.round(
                waitMs / 1000,
              )}s)`,
            );
            await sleep(waitMs + 5_000); // +5s de margen
            bulkResendState.pausedUntil = null;
          }

          const r = await sendWelcomeAndPersist(strapi, {
            id: row.id,
            email: row.email,
            university: row.university,
            welcomeEmailAttempts: row.welcome_email_attempts,
          });
          bulkResendState.done++;
          if (r.sent) bulkResendState.ok++;
          else bulkResendState.failed++;

          if (!r.sent && isTitanQuotaError(r.error)) {
            const until = parseTitanQuotaUntil(r.error || '');
            if (until) {
              bulkResendState.pausedUntil = until;
              strapi.log.warn(
                `[invited-emails:bulk-resend-welcome] Titan quota agotado; pausando hasta ${until.toISOString()}`,
              );
            } else {
              // Quota detectada pero sin hora parseable — pausa conservadora 60min.
              bulkResendState.pausedUntil = new Date(Date.now() + 60 * 60_000);
              strapi.log.warn(
                '[invited-emails:bulk-resend-welcome] Titan quota agotado (hora no parseable); pausando 60min',
              );
            }
          }

          await sleep(BULK_MAIL_THROTTLE_MS);
        }
      } catch (err: any) {
        bulkResendState.lastError = err?.message ?? String(err);
        strapi.log.error(`[invited-emails:bulk-resend-welcome] error fatal: ${bulkResendState.lastError}`);
      } finally {
        bulkResendState.running = false;
        bulkResendState.finishedAt = new Date();
        strapi.log.info(
          `[invited-emails:bulk-resend-welcome] done ok=${bulkResendState.ok} failed=${bulkResendState.failed} total=${bulkResendState.total}`,
        );
      }
    })().catch((err) => {
      strapi.log.error(`[invited-emails:bulk-resend-welcome] unhandled: ${err?.message ?? err}`);
      bulkResendState.running = false;
    });

    const etaMinutes = Math.ceil((rows.length * BULK_MAIL_THROTTLE_MS) / 60_000);
    return ctx.send({ queued: rows.length, etaMinutes });
  },

  /** Devuelve el estado del job bulk-resend-welcome (running, progreso, pausa). */
  bulkResendWelcomeStatus(ctx: Ctx) {
    return ctx.send(bulkResendState);
  },

  /**
   * Métricas funnel + breakdown por universidad + timeline 30d.
   * Pega directo a la BD vía knex (strapi.db.connection) para queries
   * agregadas que el ORM no expresa bien.
   */
  async stats(ctx: Ctx) {
    const knex = strapi.db.connection;

    const funnelRows = await knex('invited_emails')
      .select('status')
      .count<{ status: string; count: string }[]>('* as count')
      .groupBy('status');

    const funnel: Record<string, number> = {
      invited: 0,
      form_started: 0,
      pending_verification: 0,
      verified: 0,
      expired: 0,
      revoked: 0,
    };
    for (const r of funnelRows as any[]) {
      funnel[r.status] = parseInt(r.count, 10);
    }
    const totalInvited = Object.values(funnel).reduce((a, b) => a + b, 0);
    const conversionRate = totalInvited > 0 ? funnel.verified / totalInvited : 0;

    // KPI "Nuevos esta semana": cuántas invitaciones se crearon en los
    // últimos 7 días. Sirve para ver ritmo de crecimiento; "total invitados"
    // ya es acumulativo y siempre sube.
    const newThisWeekRes = await knex.raw(
      `SELECT COUNT(*)::int AS c FROM invited_emails
       WHERE invited_at >= NOW() - INTERVAL '7 days'`,
    );
    const newThisWeek = parseInt(newThisWeekRes.rows?.[0]?.c ?? '0', 10);

    // KPI "Correos con error": filas donde el welcome o el magic link
    // quedaron en estado failed. Sirve para que el admin sepa de un vistazo
    // si hay que reenviar algo o si SMTP está sano. 0 = todo OK.
    const failedEmailsRes = await knex.raw(
      `SELECT COUNT(*)::int AS c FROM invited_emails
       WHERE welcome_email_status = 'failed' OR magic_link_status = 'failed'`,
    );
    const failedEmails = parseInt(failedEmailsRes.rows?.[0]?.c ?? '0', 10);

    const byUniRows = await knex('invited_emails')
      .select('university')
      .count<{ university: string; total: string; verified: string }[]>('* as total')
      .countDistinct({ verified: knex.raw("CASE WHEN status = 'verified' THEN id END") })
      .groupBy('university')
      .orderBy('total', 'desc')
      .limit(20);

    const byUniversity = (byUniRows as any[]).map((r) => ({
      university: r.university,
      total: parseInt(r.total, 10),
      verified: parseInt(r.verified, 10),
      conversionRate: parseInt(r.total, 10) > 0 ? parseInt(r.verified, 10) / parseInt(r.total, 10) : 0,
    }));

    // Timeline últimos 30 días: invitados creados vs verificados verificados.
    const timelineRows = await knex.raw(
      `
      SELECT
        TO_CHAR(d::date, 'YYYY-MM-DD') AS date,
        (SELECT COUNT(*) FROM invited_emails WHERE invited_at::date = d::date) AS invited,
        (SELECT COUNT(*) FROM invited_emails WHERE verified_at::date = d::date) AS verified
      FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day'::interval) d
      ORDER BY d ASC
      `
    );

    const timeline = (timelineRows.rows ?? []).map((r: any) => ({
      date: r.date,
      invited: parseInt(r.invited, 10),
      verified: parseInt(r.verified, 10),
    }));

    return ctx.send({
      funnel: { ...funnel, totalInvited, conversionRate, newThisWeek, failedEmails },
      byUniversity,
      timeline,
    });
  },
});

function pickSafe(row: any): any {
  if (!row) return null;
  const out: any = {};
  for (const k of SAFE_FIELDS) out[k] = row[k];
  return out;
}
