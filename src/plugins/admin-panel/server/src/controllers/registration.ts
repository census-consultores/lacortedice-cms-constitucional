/**
 * Sprint registro-whitelist · endpoints PÚBLICOS de auto-registro estudiantil.
 *
 * Flujo (4 endpoints):
 *   1. POST /admin-panel/registro/verificar-correo
 *        Step 1 del form: cliente envía email. Verificamos contra whitelist
 *        (`invited_emails`). Anti-enumeración: SIEMPRE respondemos 200 con
 *        el mismo shape. Si hay match con status válido, marcamos
 *        `form_started` y devolvemos la `university` para pre-llenar el form.
 *
 *   2. POST /admin-panel/registro/completar
 *        Step 2 del form: cliente envía datos + password. En transacción:
 *        validamos whitelist, creamos User con `confirmed=false`, generamos
 *        token (32 bytes hex + SHA-256 hash), guardamos en `invited_email`,
 *        enviamos magic link por email. Idempotente: si User ya existe sin
 *        confirmar, regenera token y reenvía (cap 5 reenvíos).
 *
 *   3. POST /admin-panel/registro/confirmar/inspeccionar
 *        Llamado por load() de la página de verificación. Valida token sin
 *        consumirlo. Útil para mostrar "Verificando..." vs "Link expirado".
 *
 *   4. POST /admin-panel/registro/confirmar
 *        Activa la cuenta: User.confirmed=true, invalida token, status →
 *        `verified`. NO auto-loguea (igual que /recuperar/confirmar).
 *
 * Seguridad:
 *   - Token: 32 bytes random hex (256 bits), SHA-256 hash en DB, single-use,
 *     TTL 24h (más generoso que recovery porque onboarding es más lento).
 *   - Anti-enumeración: jitter 30–80ms en /verificar-correo + respuesta
 *     uniforme.
 *   - Transacciones: /completar y /confirmar van en transacción para evitar
 *     race conditions ante doble-click.
 *   - userRole='user': mantenemos el rol estándar. La analítica distingue
 *     "estudiantes" por la relación con `invited_emails.user`, no por rol.
 */

import type { Core } from '@strapi/strapi';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendMagicLinkAndPersist } from './invited-emails';
import { sendAccountCreatedEmail, sendVerificationCodeEmail } from '../services/mailer';
import { verificarIdentidad, type Proveedor } from '../services/social-auth';
import { validatePassword } from '../services/password-policy';

const STUDENT_PROFESSION = 'Estudiante de Derecho';

const VALID_PROFESSIONS = new Set([
  'Abogado/a',
  'Estudiante de Derecho',
  'Contador/a',
  'Economista',
  'Juez/a',
  'Academico/a',
  'Funcionario Publico',
  'Otro',
]);

const VALID_INTERESTS = new Set([
  'Derecho Tributario',
  'Derecho Societario',
  'Derecho Penal',
  'Derecho Mercantil',
  'Derecho Civil',
  'Derecho Laboral',
  'Derecho Constitucional',
  'Inteligencia Artificial',
]);

type Ctx = any;

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const MAX_RESENDS = 15;
// Throttle entre reenvíos automáticos del propio usuario desde la pantalla
// "link expirado". 10 minutos = margen para que llegue el correo + evitar
// que un user impaciente sature SMTP / cuota Titan haciendo click cada minuto.
const RESEND_RATE_LIMIT_MS = 10 * 60 * 1000;

// ── OTP de registro (código de 6 dígitos por correo) ────────────────────────
//
// El código vive en el core store de Strapi (respaldado en Postgres, así que
// sobrevive reinicios del dyno) como { hash, exp, intentos, enviados[] }.
// Reglas: vence en 10 min, 5 intentos de verificación, máx. 3 envíos cada
// 15 min con 45s mínimo entre envíos.
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_INTENTOS = 5;
const OTP_MAX_ENVIOS = 3;
const OTP_VENTANA_ENVIOS_MS = 15 * 60 * 1000;
const OTP_MIN_ENTRE_ENVIOS_MS = 45 * 1000;

type OtpEntry = { hash: string; exp: number; intentos: number; enviados: number[] };

function otpStore(strapi: Core.Strapi) {
  return strapi.store({ type: 'plugin', name: 'admin-panel' });
}
const otpKey = (email: string) => `registro-otp:${email}`;

// Límite por IP del envío de códigos (en memoria: contra mail-bombing basta,
// aunque se reinicie con el dyno). El límite por correo de arriba protege a
// cada buzón; este protege la reputación SMTP contra ráfagas a muchos buzones.
const OTP_IP_MAX_HORA = 10;
const otpPorIp = new Map<string, number[]>();
function otpIpPermitido(ip: string): boolean {
  const ahora = Date.now();
  const marcas = (otpPorIp.get(ip) ?? []).filter((t) => ahora - t < 60 * 60 * 1000);
  if (marcas.length >= OTP_IP_MAX_HORA) {
    otpPorIp.set(ip, marcas);
    return false;
  }
  marcas.push(ahora);
  otpPorIp.set(ip, marcas);
  if (otpPorIp.size > 5000) otpPorIp.clear(); // techo de memoria
  return true;
}
const RESPONSE_JITTER_MIN = 30;
const RESPONSE_JITTER_MAX = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FRONT_BASE_URL =
  process.env.PUBLIC_WEB_URL ??
  process.env.FRONT_BASE_URL ??
  'https://app.lacortedicetributaria.com';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateToken(): { plain: string; hash: string } {
  const plain = crypto.randomBytes(32).toString('hex');
  return { plain, hash: sha256Hex(plain) };
}

function jitter(): Promise<void> {
  const ms = RESPONSE_JITTER_MIN + Math.random() * (RESPONSE_JITTER_MAX - RESPONSE_JITTER_MIN);
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeEmail(raw: any): string {
  return String(raw ?? '').trim().toLowerCase();
}

function slugifyForUsername(input: string): string {
  // Quita tildes y caracteres no [a-z0-9._-]. Si terminamos con <3 chars
  // (caso muy raro tipo "Ñu"), padding con 'x' para satisfacer minLength del
  // schema users-permissions.
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .padEnd(3, 'x');
}

/**
 * Genera un username único derivado del PRIMER nombre del usuario
 * (ej. "María José" → "mariajose"). Si choca con otro user, agrega
 * sufijo -2, -3, ... Si por alguna razón el seed queda vacío, cae al
 * prefix del email como backup.
 *
 * El username queda como handle interno + display público (Falla Tú
 * leaderboard, listados admin, "@usuario"). El admin nunca lo elige.
 */
async function deriveUniqueUsername(
  strapi: Core.Strapi,
  email: string,
  firstName?: string,
): Promise<string> {
  // Tomamos solo el primer "nombre" de pila para handles cortos:
  // "María José" → "maria" (no "mariajose"). Más legible en el leaderboard.
  const firstWord = (firstName ?? '').trim().split(/\s+/)[0] ?? '';
  const seed = firstWord ? slugifyForUsername(firstWord) : '';
  const base = seed || slugifyForUsername(email.split('@')[0]);

  let candidate = base;
  let i = 2;

  while (
    await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { username: candidate } })
  ) {
    candidate = `${base}-${i++}`;
    if (i > 999) throw new Error('cannot_derive_unique_username');
  }
  return candidate;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Step 1: verifica si el correo está en la whitelist. */
  async verificarCorreo(ctx: Ctx) {
    await jitter();

    const email = normalizeEmail(ctx.request.body?.email);

    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return ctx.send({ ok: true, authorized: false });
    }

    const invited = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { email }, populate: { user: true } });

    if (!invited) {
      // REGISTRO ABIERTO (freemium): cualquier correo puede crear su cuenta
      // gratuita sin invitación previa. Si el correo ya tiene cuenta, el
      // frontend lo manda al login en vez de duplicarlo.
      const existente = await strapi.db
        .query('plugin::users-permissions.user')
        .findOne({ where: { email }, select: ['id'] });
      if (existente) {
        return ctx.send({ ok: true, authorized: true, alreadyRegistered: true });
      }
      strapi.log.info(`[registro] verificar-correo: registro abierto para ${email}`);
      return ctx.send({ ok: true, authorized: true, open: true });
    }

    switch (invited.status) {
      case 'invited':
      case 'form_started':
        await strapi.db.query('api::invited-email.invited-email').update({
          where: { id: invited.id },
          data: { status: 'form_started', formStartedAt: new Date() },
        });
        return ctx.send({
          ok: true,
          authorized: true,
          program: invited.program ?? null,
        });

      case 'pending_verification':
        return ctx.send({
          ok: true,
          authorized: true,
          program: invited.program ?? null,
          alreadyStarted: true,
        });

      case 'verified':
        return ctx.send({
          ok: true,
          authorized: true,
          alreadyRegistered: true,
        });

      default: // expired, revoked
        return ctx.send({ ok: true, authorized: false });
    }
  },

  /**
   * Envía (o reenvía) el código de verificación de 6 dígitos al correo con el
   * que el usuario se está registrando. Anti-enumeración: siempre responde
   * { ok: true } salvo rate-limit; si el correo ya tiene cuenta no se envía
   * nada (verificar-correo ya le dijo al frontend que vaya al login).
   */
  async enviarCodigo(ctx: Ctx) {
    await jitter();
    const ip = ctx.request.ip ?? ctx.ip ?? 'desconocida';
    if (!otpIpPermitido(String(ip))) {
      strapi.log.warn(`[registro] enviar-codigo rate-limited por IP ${ip}`);
      return ctx.send({ ok: false, error: 'too_many_sends' }, 429);
    }
    const email = normalizeEmail(ctx.request.body?.email);
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return ctx.send({ ok: true });
    }

    const existente = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email }, select: ['id'] });
    if (existente) return ctx.send({ ok: true, alreadyRegistered: true });

    const store = otpStore(strapi);
    const ahora = Date.now();
    const previo = (await store.get({ key: otpKey(email) })) as OtpEntry | null;
    const enviados = (previo?.enviados ?? []).filter((t) => ahora - t < OTP_VENTANA_ENVIOS_MS);
    if (enviados.length >= OTP_MAX_ENVIOS) {
      return ctx.send({ ok: false, error: 'too_many_sends' }, 429);
    }
    const ultimo = enviados[enviados.length - 1];
    if (ultimo && ahora - ultimo < OTP_MIN_ENTRE_ENVIOS_MS) {
      return ctx.send({ ok: false, error: 'too_soon' }, 429);
    }

    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const entry: OtpEntry = {
      hash: sha256Hex(codigo),
      exp: ahora + OTP_TTL_MS,
      intentos: 0,
      enviados: [...enviados, ahora],
    };
    await store.set({ key: otpKey(email), value: entry });

    const r = await sendVerificationCodeEmail({ to: email, email, codigo });
    if (r.dryRun) strapi.log.warn(`[registro] DRY-RUN código de verificación para ${email}`);
    else if (!r.sent) strapi.log.error(`[registro] falló el código a ${email}: ${r.error}`);
    else strapi.log.info(`[registro] código de verificación enviado a ${email}`);

    return ctx.send({ ok: true });
  },

  /**
   * Crea la cuenta del usuario en un solo paso. Recibe todos los datos del
   * perfil (datos personales + profesional + contacto + intereses + password
   * + T&C) y, si el correo está en la whitelist, persiste:
   *   - User en `up_users` con `confirmed=true` e `isProfileComplete=true`.
   *   - `invited_emails.status='verified'` y `verifiedAt=NOW()`.
   *
   * Sin magic link: la app permite login con email+password sin verificar
   * correo aparte. Mandamos un correo informativo de "cuenta creada" para
   * trazabilidad y para que el usuario tenga el link de login a mano.
   */
  async completar(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      fechaNacimiento?: string;
      profession?: string;
      university?: string | null;
      currentJob?: string | null;
      emailPersonal?: string | null;
      phone?: string;
      city?: string;
      country?: string;
      interests?: unknown;
      terms?: boolean;
      privacy?: boolean;
      codigo?: string;
      socialIdToken?: string;
      socialProvider?: string;
    };

    const email = normalizeEmail(body.email);
    const firstName = String(body.firstName ?? '').trim();
    const lastName = String(body.lastName ?? '').trim();
    const password = String(body.password ?? '');
    const fechaNacimiento = String(body.fechaNacimiento ?? '').trim();
    const profession = String(body.profession ?? '').trim();
    const university = body.university ? String(body.university).trim() : '';
    const currentJob = body.currentJob ? String(body.currentJob).trim() : '';
    const emailPersonal = body.emailPersonal ? normalizeEmail(body.emailPersonal) : '';
    const phone = String(body.phone ?? '').trim();
    const city = String(body.city ?? '').trim();
    const country = String(body.country ?? '').trim();
    const interestsArr = Array.isArray(body.interests)
      ? body.interests
          .filter((x): x is string => typeof x === 'string')
          .filter((x) => VALID_INTERESTS.has(x))
      : [];

    const isStudent = profession === STUDENT_PROFESSION;

    // --- Validaciones server-side (defensa en profundidad; el webapp ya validó) ---
    if (!email || !EMAIL_RE.test(email)) return ctx.badRequest('email_invalid');
    if (firstName.length < 2 || firstName.length > 80) return ctx.badRequest('first_name_invalid');
    if (lastName.length < 2 || lastName.length > 80) return ctx.badRequest('last_name_invalid');
    // Se pide UN nombre y UN apellido. Exigir dos de cada uno es una
    // convención hispanohablante que deja fuera a «John Smith» — y el
    // revisor de Apple se registra con su nombre real.
    if (!fechaNacimiento) return ctx.badRequest('birth_date_required');
    // Mayor de edad, igual que los Términos y que el webapp. El CMS valida
    // aparte porque su API es alcanzable sin pasar por el formulario.
    {
      const nac = new Date(fechaNacimiento);
      if (Number.isNaN(nac.getTime())) return ctx.badRequest('birth_date_invalid');
      const hoy = new Date();
      const limite18 = new Date(hoy.getFullYear() - 18, hoy.getMonth(), hoy.getDate());
      const limite100 = new Date(hoy.getFullYear() - 100, hoy.getMonth(), hoy.getDate());
      if (nac > limite18 || nac < limite100) return ctx.badRequest('age_out_of_range');
    }
    if (!profession || !VALID_PROFESSIONS.has(profession)) return ctx.badRequest('profession_invalid');
    if (isStudent && !university) return ctx.badRequest('university_required');
    if (!isStudent && !currentJob) return ctx.badRequest('current_job_required');
    if (isStudent && !emailPersonal) return ctx.badRequest('email_personal_required');
    if (emailPersonal && !EMAIL_RE.test(emailPersonal)) return ctx.badRequest('email_personal_invalid');
    if (!phone || phone.length < 6) return ctx.badRequest('phone_invalid');
    if (!city) return ctx.badRequest('city_required');
    if (!country) return ctx.badRequest('country_required');
    if (interestsArr.length === 0) return ctx.badRequest('interests_required');
    if (body.terms !== true) return ctx.badRequest('terms_required');
    if (body.privacy !== true) return ctx.badRequest('privacy_required');

    const policy = validatePassword(password);
    if (!policy.ok) return ctx.badRequest('weak_password: ' + policy.errors.join(' '));

    // ── El correo tiene que estar VERIFICADO antes de crear la cuenta ──
    //
    // Dos pruebas válidas: (a) un idToken de Apple/Google cuyo correo
    // verificado coincide con el del registro (llega del flujo «Continuar
    // con Apple»), o (b) el código de 6 dígitos que enviamos a ese correo.
    let correoVerificado = false;
    const socialProvider = String(body.socialProvider ?? '').toLowerCase();
    if (body.socialIdToken && (socialProvider === 'apple' || socialProvider === 'google')) {
      try {
        const ident = await verificarIdentidad(socialProvider as Proveedor, String(body.socialIdToken));
        if (normalizeEmail(ident.email) === email) correoVerificado = true;
        else strapi.log.warn(`[registro] idToken de ${socialProvider} no coincide con ${email}`);
      } catch (e) {
        // Token vencido o inválido: no es fatal — cae a la prueba del código.
        strapi.log.warn(`[registro] idToken social inválido para ${email}: ${(e as Error).message}`);
      }
    }
    if (!correoVerificado) {
      const codigo = String(body.codigo ?? '').trim();
      if (!/^\d{6}$/.test(codigo)) return ctx.badRequest('codigo_required');
      const store = otpStore(strapi);
      const entry = (await store.get({ key: otpKey(email) })) as OtpEntry | null;
      if (!entry || entry.exp < Date.now()) return ctx.badRequest('codigo_expired');
      if (entry.intentos >= OTP_MAX_INTENTOS) return ctx.badRequest('codigo_blocked');
      if (sha256Hex(codigo) !== entry.hash) {
        await store.set({ key: otpKey(email), value: { ...entry, intentos: entry.intentos + 1 } });
        return ctx.badRequest('codigo_invalid');
      }
      correoVerificado = true;
      await store.delete({ key: otpKey(email) });
    }

    return await strapi.db.transaction(async () => {
      const invited = await strapi.db
        .query('api::invited-email.invited-email')
        .findOne({ where: { email }, populate: { user: true } });

      // REGISTRO ABIERTO (freemium): sin invitación también se puede crear la
      // cuenta gratuita. La única barrera es que el correo no tenga ya una.
      if (invited) {
        if (invited.status === 'verified' || invited.user) {
          return ctx.conflict('already_registered');
        }
        if (invited.status === 'revoked') {
          // Revocado explícitamente por un admin: esa decisión se respeta.
          return ctx.badRequest('invalid_status');
        }
      }
      const usuarioExistente = await strapi.db
        .query('plugin::users-permissions.user')
        .findOne({ where: { email }, select: ['id'] });
      if (usuarioExistente) return ctx.conflict('already_registered');

      // --- Crear el User con TODOS los datos + confirmed=true + perfil completo ---
      const username = await deriveUniqueUsername(strapi, email, firstName);

      const authRole = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } });

      if (!authRole) {
        strapi.log.error('[registro] No se encontró el rol authenticated');
        return ctx.internalServerError('role_missing');
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await strapi.db.query('plugin::users-permissions.user').create({
        data: {
          username,
          email,
          password: hashedPassword,
          confirmed: true,
          blocked: false,
          provider: 'local',
          role: authRole.id,
          userRole: 'user',
          firstName,
          lastName,
          fechaNacimiento,
          profession,
          university: isStudent ? university : null,
          currentJob: currentJob || null,
          emailPersonal: emailPersonal || null,
          phone,
          city,
          country,
          interests: interestsArr,
          termsAcceptedAt: new Date(),
          isProfileComplete: true,
          mustChangePassword: false,
        },
      });

      // --- Marcar el invited_email como verified (solo si venía invitado) ---
      if (invited)
        await strapi.db.query('api::invited-email.invited-email').update({
        where: { id: invited.id },
        data: {
          user: newUser.id,
          status: 'verified',
          formCompletedAt: new Date(),
          verifiedAt: new Date(),
          registrationTokenHash: null,
          tokenExpiresAt: null,
          lastEmailSentAt: new Date(),
        },
      });

      // --- Correo de confirmación "cuenta creada" (fire-and-forget) ---
      const loginUrl = `${FRONT_BASE_URL.replace(/\/$/, '')}/login?email=${encodeURIComponent(email)}`;
      sendAccountCreatedEmail({
        to: email,
        nombre: `${firstName} ${lastName}`.trim(),
        email,
        loginUrl,
      })
        .then((r) => {
          if (r.dryRun) strapi.log.warn(`[registro] DRY-RUN account-created para ${email}`);
          else if (!r.sent) strapi.log.error(`[registro] falló account-created a ${email}: ${r.error}`);
          else strapi.log.info(`[registro] cuenta creada confirmada por correo a ${email}`);
        })
        .catch((err) => strapi.log.error('[registro] account-created mailer error', err));

      return ctx.send({ ok: true });
    });
  },

  /** Inspecciona un token sin consumirlo. Usado por load() del frontend. */
  async inspeccionar(ctx: Ctx) {
    const token = String(ctx.request.body?.token ?? ctx.query?.token ?? '');

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return ctx.send({ valid: false, reason: 'invalid' });
    }

    const hash = sha256Hex(token);
    const invited = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { registrationTokenHash: hash }, populate: { user: true } });

    if (!invited) return ctx.send({ valid: false, reason: 'invalid' });

    if (invited.user?.confirmed) {
      return ctx.send({ valid: false, reason: 'already_used', email: invited.email });
    }

    if (!invited.tokenExpiresAt || new Date(invited.tokenExpiresAt).getTime() < Date.now()) {
      return ctx.send({ valid: false, reason: 'expired', email: invited.email });
    }

    return ctx.send({
      valid: true,
      email: invited.email,
      university: invited.university ?? '',
      expiresAt: invited.tokenExpiresAt,
    });
  },

  /** Activa la cuenta: User.confirmed=true, invalida token, status='verified'. */
  async confirmar(ctx: Ctx) {
    const token = String(ctx.request.body?.token ?? '');

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return ctx.badRequest('token_invalid');
    }

    const hash = sha256Hex(token);

    return await strapi.db.transaction(async () => {
      const invited = await strapi.db
        .query('api::invited-email.invited-email')
        .findOne({ where: { registrationTokenHash: hash }, populate: { user: true } });

      if (!invited) return ctx.badRequest('token_invalid');
      if (!invited.user) {
        strapi.log.error(`[registro] confirmar: invited_email.id=${invited.id} sin user asociado`);
        return ctx.badRequest('inconsistent_state');
      }
      if (invited.user.confirmed) return ctx.badRequest('already_used');
      if (!invited.tokenExpiresAt || new Date(invited.tokenExpiresAt).getTime() < Date.now()) {
        return ctx.badRequest('token_expired');
      }

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: invited.user.id },
        data: { confirmed: true },
      });

      await strapi.db.query('api::invited-email.invited-email').update({
        where: { id: invited.id },
        data: {
          status: 'verified',
          verifiedAt: new Date(),
          registrationTokenHash: null,
          tokenExpiresAt: null,
        },
      });

      strapi.log.info(`[registro] verified email=${invited.email} university=${invited.university}`);

      return ctx.send({ ok: true, email: invited.user.email });
    });
  },

  /**
   * Self-service de re-solicitud de magic link. Lo invoca el usuario desde la
   * pantalla `/registro/verificar/[token]` cuando ve "link expirado" o cuando
   * el correo nunca le llegó.
   *
   * Anti-enumeración: SIEMPRE respondemos `{ ok: true }` con el mismo shape.
   * El frontend muestra el mismo mensaje "si tu correo está en la lista, te
   * enviaremos un link nuevo en unos minutos". Eso evita filtrar si un email
   * está o no en la whitelist a través de este endpoint.
   *
   * Rate limit: 10 min entre reenvíos para un mismo invited_email. Usamos
   * el campo `lastEmailSentAt` que ya existe (no requiere tabla aparte).
   */
  async reenviarVerificacion(ctx: Ctx) {
    await jitter();

    const email = normalizeEmail(ctx.request.body?.email);
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return ctx.send({ ok: true });
    }

    const invited = await strapi.db
      .query('api::invited-email.invited-email')
      .findOne({ where: { email }, populate: { user: true } });

    // No existe en la whitelist → respuesta uniforme (anti-enumeración).
    if (!invited) {
      strapi.log.info(`[registro] reenviar-verificacion: email no en whitelist (${email})`);
      return ctx.send({ ok: true });
    }

    // Solo aplica si el usuario ya completó el form y está esperando verificar
    // (o si reabrió el form pero no terminó). Para los `invited` puros que
    // nunca empezaron el form, no hay token que reenviar — esos van por el
    // flow de welcome desde admin.
    if (!['pending_verification', 'form_started'].includes(invited.status)) {
      strapi.log.info(`[registro] reenviar-verificacion: status=${invited.status} no aplica (${email})`);
      return ctx.send({ ok: true });
    }

    if (!invited.user) {
      strapi.log.info(`[registro] reenviar-verificacion: sin user asociado (${email})`);
      return ctx.send({ ok: true });
    }

    // Cuenta ya confirmada → no tiene sentido reenviar verificación, debería
    // ir a login. El frontend no debería llegar a este caso (mostrar "ya
    // verificado" antes), pero defensa en profundidad.
    if (invited.user.confirmed) {
      strapi.log.info(`[registro] reenviar-verificacion: user ya confirmed (${email})`);
      return ctx.send({ ok: true });
    }

    // Rate limit: si el último envío fue hace menos de 10 min, no reenviamos.
    const lastSentMs = invited.lastEmailSentAt
      ? new Date(invited.lastEmailSentAt).getTime()
      : 0;
    if (Date.now() - lastSentMs < RESEND_RATE_LIMIT_MS) {
      strapi.log.info(`[registro] reenviar-verificacion: rate-limited (${email})`);
      return ctx.send({ ok: true });
    }

    // Cap de reenvíos para evitar abuso si alguien automatiza clicks.
    if ((invited.resendsCount ?? 0) >= MAX_RESENDS) {
      strapi.log.warn(`[registro] reenviar-verificacion: max resends reached (${email})`);
      return ctx.send({ ok: true });
    }

    const { plain, hash } = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await strapi.db.query('api::invited-email.invited-email').update({
      where: { id: invited.id },
      data: {
        registrationTokenHash: hash,
        tokenExpiresAt: expiresAt,
        lastEmailSentAt: new Date(),
        resendsCount: (invited.resendsCount ?? 0) + 1,
      },
    });

    const verifyUrl = `${FRONT_BASE_URL.replace(/\/$/, '')}/registro/verificar/${plain}`;
    const nombre =
      `${invited.user.firstName ?? ''} ${invited.user.lastName ?? ''}`.trim() || email;

    sendMagicLinkAndPersist(
      strapi,
      {
        id: invited.id,
        email,
        nombre,
        university: invited.university,
        magicLinkAttempts: invited.magicLinkAttempts,
      },
      verifyUrl,
      expiresAt,
    )
      .then((r) => {
        if (r.dryRun) strapi.log.warn(`[registro] DRY-RUN verify URL para ${email}: ${verifyUrl}`);
        else if (!r.sent) strapi.log.error(`[registro] falló reenvío self-service a ${email}: ${r.error}`);
        else strapi.log.info(`[registro] reenvío self-service a ${email} (resend #${(invited.resendsCount ?? 0) + 1})`);
      })
      .catch((err) => strapi.log.error('[registro] reenvío self-service mailer error', err));

    return ctx.send({ ok: true });
  },
});
