import bcrypt from 'bcryptjs';
import { sendWelcomeEmail } from '../services/mailer';
import crypto from 'crypto';

/**
 * Genera una contraseña temporal aleatoria (20 chars alfanuméricos + símbolos).
 * El usuario recién creado NUNCA la usa directamente — la sobreescribe al
 * completar el flujo /recuperar/confirmar con el token del correo.
 */
function randomTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export default ({ strapi }) => ({
  /**
   * POST /api/admin-panel/users
   *
   * Crear un usuario desde el panel de admin. Reemplaza el flujo viejo de
   * webapp `/auth/local/register` + `PUT /admin-panel/users/:id`, que:
   *   (a) dependía de la flag `allow_register` de users-permissions (si un
   *       superadmin la apagaba en la UI de Strapi, el panel se caía), y
   *   (b) intentaba setear `mustChangePassword` y `confirmed` via updateUser,
   *       pero esos campos no estaban en el allowlist del service → se
   *       descartaban en silencio y el usuario quedaba mal configurado.
   *
   * Este endpoint crea el registro atómicamente con todos los flags, sin
   * depender de allow_register, y lo deja listo para que el admin dispare
   * `/auth/forgot-password` y el usuario fije su clave vía el flujo sprint12b.
   *
   * Policy: `plugin::admin-panel.isAdmin` (admin O superadmin).
   */
  async createUser(ctx) {
    const body = ctx.request.body || {};
    const username = String(body.username ?? '').trim();
    const email = String(body.email ?? '').toLowerCase().trim();
    const rawRole = String(body.userRole ?? 'user');
    // Superadmin se asigna sólo desde el admin UI de Strapi, no desde la webapp
    const userRole = rawRole === 'admin' ? 'admin' : 'user';

    if (username.length < 2) {
      return ctx.badRequest('Nombre requerido (mínimo 2 caracteres)');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return ctx.badRequest('Email inválido');
    }

    // Duplicados: email O username ya usados
    const existing = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { $or: [{ email }, { username }] } });
    if (existing) {
      return ctx.conflict('Ese email o nombre ya está registrado.');
    }

    // Role "authenticated" de users-permissions (necesario para que el usuario
    // pueda loguearse y usar la webapp).
    const authRole = await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });
    if (!authRole) {
      return ctx.internalServerError('No se encontró el role authenticated');
    }

    const tempPassword = randomTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    let created;
    try {
      created = await strapi.db.query('plugin::users-permissions.user').create({
        data: {
          username,
          email,
          password: hashed,
          provider: 'local',
          confirmed: true,
          blocked: false,
          role: authRole.id,
          userRole,
          mustChangePassword: true,
          isProfileComplete: false,
        },
      });
    } catch (err: any) {
      strapi.log.error('[admin-panel.createUser] insert failed: ' + err?.message);
      return ctx.internalServerError('No se pudo crear el usuario.');
    }

    sendWelcomeEmail({
      to: email,
      nombre: username,
      email,
      passwordTemporal: tempPassword,
    }).then((res) => {
      if (res.sent) strapi.log.info('[admin-panel.createUser] welcome email sent to ' + email);
      else strapi.log.warn('[admin-panel.createUser] welcome skipped: ' + (res.error ?? (res.dryRun ? 'dry-run' : 'unknown')));
    }).catch((err) => {
      strapi.log.error('[admin-panel.createUser] welcome email failed: ' + (err?.message ?? err));
    });

    ctx.body = {
      id: created.id,
      documentId: created.documentId,
      username: created.username,
      email: created.email,
      userRole: created.userRole,
    };
  },

  /**
   * GET /api/admin-panel/users
   */
  async getUsers(ctx) {
    const {
      page, pageSize, search, status, role,
      tier, profileComplete, blocked, sortBy, sortOrder,
      lastActiveFrom, lastActiveTo,
      lastLoginFrom, lastLoginTo, app,
    } = ctx.query;

    const result = await strapi
      .plugin('admin-panel')
      .service('service')
      .getUsers({
        page, pageSize, search, status, role,
        tier, profileComplete, blocked, sortBy, sortOrder,
        lastActiveFrom, lastActiveTo,
        lastLoginFrom, lastLoginTo, app,
      });

    ctx.body = result;
  },

  /**
   * GET /api/admin-panel/stats
   *
   * Devuelve TODO el payload del dashboard en una sola respuesta:
   *   - users:        stats de usuarios (total, online, registeredToday, etc.)
   *   - content:      conteos de causas, casaciones y los 11 catálogos
   *   - recentUsers:  últimos 5 registros
   *   - recentLogins: últimos 5 logins
   *
   * Antes la webapp armaba esto haciendo ~18 fetches HTTP sueltos al CMS.
   * Ahora todo viaja en una sola respuesta consolidada.
   */
  async getStats(ctx) {
    const data = await strapi
      .plugin('admin-panel')
      .service('service')
      .getDashboardData();
    ctx.body = data;
  },

  /**
   * GET /api/admin-panel/users/:id
   */
  async getUserById(ctx) {
    const { id } = ctx.params;
    const user = await strapi
      .plugin('admin-panel')
      .service('service')
      .getUserById(id);

    if (!user) {
      return ctx.notFound('Usuario no encontrado');
    }
    ctx.body = user;
  },

  /**
   * PUT /api/admin-panel/users/:id
   */
  async updateUser(ctx) {
    const { id } = ctx.params;
    const data = ctx.request.body;

    // Guard de escalada de privilegio: el allowlist de `service.updateUser`
    // incluye `userRole`, y esta ruta está gateada por `isAdmin` (admin O
    // superadmin). Sin este check, un `admin` común podía autopromoverse a
    // `superadmin` mandando { userRole: 'superadmin' }, salteando la
    // verificación que sí hace updateUserRole. Solo superadmin puede tocar
    // el rol por cualquier vía.
    if (data && data.userRole !== undefined) {
      const requestingUser = await strapi.db
        .query('plugin::users-permissions.user')
        .findOne({ where: { id: ctx.state.user.id }, select: ['id', 'userRole'] });
      if (!requestingUser || requestingUser.userRole !== 'superadmin') {
        return ctx.forbidden('Solo superadmin puede cambiar el rol de un usuario');
      }
    }

    try {
      const updated = await strapi
        .plugin('admin-panel')
        .service('service')
        .updateUser(id, data);
      ctx.body = updated;
    } catch (e: any) {
      // 409 cuando el username/email ya está tomado por otro usuario,
      // así el frontend puede mostrar el mensaje exacto sin guessing.
      if (e?.code === 'USERNAME_TAKEN' || e?.code === 'EMAIL_TAKEN') {
        return ctx.conflict(e.message);
      }
      throw e;
    }
  },

  /**
   * DELETE /api/admin-panel/users/:id
   *
   * Borra el usuario identificado por numeric id o documentId. Limpia
   * dependencias en schema analytics (si existen) para evitar FKs
   * huérfanos, y luego elimina el registro de up_users.
   * Nunca permite que un admin se borre a sí mismo.
   */
  async deleteUser(ctx) {
    const { id } = ctx.params;
    const me = ctx.state.user?.id;
    try {
      const result = await strapi
        .plugin('admin-panel')
        .service('service')
        .deleteUser(id, me);
      ctx.body = result;
    } catch (e: any) {
      if (e?.code === 'SELF_DELETE') {
        return ctx.badRequest('No puedes eliminar tu propia cuenta desde el panel.');
      }
      if (e?.code === 'NOT_FOUND') {
        return ctx.notFound('Usuario no encontrado');
      }
      strapi.log.error('[admin-panel.deleteUser] failed: ' + (e?.message ?? e));
      return ctx.internalServerError('No se pudo eliminar el usuario.');
    }
  },

  /**
   * POST /api/admin-panel/account/delete
   *
   * Borrado de la propia cuenta (App Store 5.1.1(v) / Google Play).
   * Reutiliza el mismo service que el panel admin, que ya limpia las tablas
   * de analytics y las invitaciones asociadas, pero SIN pasar
   * `requesterNumericId` — acá el self-delete es exactamente lo que se busca.
   *
   * Pide confirmación explícita en el body para que una llamada accidental
   * (o un GET mal enrutado) no destruya la cuenta.
   */
  async deleteOwnAccount(ctx) {
    const me = ctx.state.user?.id;
    if (!me) {
      return ctx.unauthorized('Necesitas iniciar sesión.');
    }

    const { confirm } = ctx.request.body ?? {};
    if (confirm !== 'ELIMINAR') {
      return ctx.badRequest('Falta la confirmación explícita para eliminar la cuenta.');
    }

    try {
      // Sin requesterNumericId → no dispara el guard de SELF_DELETE.
      const result = await strapi
        .plugin('admin-panel')
        .service('service')
        .deleteUser(me);

      strapi.log.info(`[admin-panel.deleteOwnAccount] cuenta ${me} eliminada por su titular`);
      ctx.body = { ok: true, ...result };
    } catch (e: any) {
      if (e?.code === 'NOT_FOUND') {
        return ctx.notFound('Usuario no encontrado');
      }
      strapi.log.error('[admin-panel.deleteOwnAccount] failed: ' + (e?.message ?? e));
      return ctx.internalServerError('No se pudo eliminar la cuenta.');
    }
  },

  /**
   * PUT /api/admin-panel/users/:id/role
   */
  async updateUserRole(ctx) {
    const { id } = ctx.params;
    const { userRole } = ctx.request.body;

    // Only superadmin can change roles
    const requestingUser = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: ctx.state.user.id } });

    if (requestingUser.userRole !== 'superadmin') {
      return ctx.forbidden('Solo superadmin puede cambiar roles');
    }

    const updated = await strapi
      .plugin('admin-panel')
      .service('service')
      .updateUserRole(id, userRole);
    ctx.body = updated;
  },

  /**
   * PUT /api/admin-panel/users/:id/block
   */
  async toggleBlockUser(ctx) {
    const { id } = ctx.params;
    const result = await strapi
      .plugin('admin-panel')
      .service('service')
      .toggleBlockUser(id);
    ctx.body = result;
  },

  /**
   * POST /api/admin-panel/auth/track-login
   *
   * Registra un login explícito del usuario autenticado, reemplazando el
   * parche oportunista que `activityPing` hacía cuando detectaba un usuario
   * sin `lastLoginAt`. La webapp llama a este endpoint inmediatamente después
   * de `/auth/local` con el JWT recién emitido, de modo que:
   *
   *   - `lastLoginAt` pasa a reflejar el momento real del último login
   *     (antes quedaba estancado porque users-permissions no lo tocaba).
   *   - `loginCount` se incrementa cada vez y vuelve a ser útil como métrica.
   *   - `lastActiveAt` también se sella para que el estado Online aparezca
   *     en el panel admin sin esperar al próximo heartbeat.
   *
   * Policy: ninguna explícita — basta con un JWT válido. Actualiza SOLO al
   * usuario autenticado, nunca a otros.
   */
  async trackLogin(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const existing = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: userId } });

    const now = new Date();
    await strapi.db
      .query('plugin::users-permissions.user')
      .update({
        where: { id: userId },
        data: {
          lastLoginAt: now,
          lastActiveAt: now,
          loginCount: (existing?.loginCount || 0) + 1,
        },
      });

    ctx.body = { ok: true };
  },

  /**
   * POST /api/admin-panel/activity-ping
   * Updates lastActiveAt on every ping. If the user has no lastLoginAt
   * yet (because the login hook was not firing for them on earlier
   * deployments), we backfill it here so the admin panel no longer
   * shows "Nunca conectado" for people who are clearly using the app.
   */
  async activityPing(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const existing = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: userId } });

    const now = new Date();
    const data: any = { lastActiveAt: now };
    if (!existing?.lastLoginAt) {
      data.lastLoginAt = now;
      data.loginCount = (existing?.loginCount || 0) + 1;
    }

    await strapi.db
      .query('plugin::users-permissions.user')
      .update({
        where: { id: userId },
        data,
      });

    ctx.body = { ok: true };
  },

  /**
   * POST /api/admin-panel/app-instalada  { plataforma }
   *
   * Registra que el usuario autenticado abrió la app instalada en su
   * dispositivo. `appInstaladaEn` se fija la primera vez; `appUltimoUsoEn`
   * se actualiza en cada aviso (la app avisa como máximo una vez al día).
   * Si la plataforma cambia (p. ej. pasó de la PWA al binario de iOS), se
   * guarda la nueva.
   */
  async appInstalada(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    const PLATAFORMAS = ['pwa-ios', 'pwa-android', 'pwa-escritorio', 'ios-nativa', 'android-nativa'];
    const plataforma = String(ctx.request.body?.plataforma ?? '');
    if (!PLATAFORMAS.includes(plataforma)) {
      return ctx.badRequest('plataforma inválida');
    }

    const existing = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: userId }, select: ['id', 'appInstalada', 'appInstaladaEn'] });

    const now = new Date();
    const data: any = { appInstalada: plataforma, appUltimoUsoEn: now };
    if (!existing?.appInstaladaEn || existing.appInstalada !== plataforma) {
      data.appInstaladaEn = now;
    }

    await strapi.db
      .query('plugin::users-permissions.user')
      .update({ where: { id: userId }, data });

    ctx.body = { ok: true, plataforma };
  },

  /**
   * PUT /api/admin-panel/profile
   */
  async updateProfile(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    // Unwrap { data: { ... } } wrapper if present (frontend sends wrapped format)
    const raw = ctx.request.body;
    const data = raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? raw.data
      : raw;
    try {
      const updated = await strapi
        .plugin('admin-panel')
        .service('service')
        .updateProfile(userId, data);
      ctx.body = updated;
    } catch (e: any) {
      if (e?.code === 'USERNAME_TAKEN' || e?.code === 'EMAIL_TAKEN') {
        return ctx.conflict(e.message);
      }
      throw e;
    }
  },
});
