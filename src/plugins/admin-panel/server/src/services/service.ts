import { traerTodo } from '../utils/traer-todo';

const USER_QUERY = 'plugin::users-permissions.user';

// Fields to return (never expose password or tokens)
const SAFE_FIELDS = [
  'id', 'documentId', 'username', 'email',
  'confirmed', 'blocked', 'createdAt', 'updatedAt',
  'lastLoginAt', 'lastActiveAt', 'loginCount',
  'userRole', 'isProfileComplete',
  'firstName', 'lastName',
  'university', 'profession', 'city', 'country',
  'interests', 'phone', 'subscriptionTier',
  'picture', 'currentJob',
  'fechaNacimiento', 'emailPersonal',
  'termsAcceptedAt',
  'appInstalada', 'appInstaladaEn', 'appUltimoUsoEn',
];

const STUDENT_PROFESSION = 'Estudiante de Derecho';

/**
 * Valida que `username` y `email` no estén tomados por OTRO usuario distinto
 * al que se está actualizando. Tira un error con `code: 'USERNAME_TAKEN'` o
 * `'EMAIL_TAKEN'` para que el caller lo traduzca a 409 o mensaje claro.
 *
 * Estrictamente necesario porque la DB no tiene constraint UNIQUE en estos
 * campos (deuda histórica del schema users-permissions modificado post-creación).
 */
async function assertUsernameEmailUnique(
  strapi: any,
  data: { username?: string; email?: string },
  excludeUserId: number,
): Promise<void> {
  const checks: Array<{ field: 'username' | 'email'; value: string; code: string }> = [];
  if (typeof data.username === 'string' && data.username.trim()) {
    checks.push({ field: 'username', value: data.username.trim(), code: 'USERNAME_TAKEN' });
  }
  if (typeof data.email === 'string' && data.email.trim()) {
    checks.push({ field: 'email', value: data.email.trim().toLowerCase(), code: 'EMAIL_TAKEN' });
  }
  for (const c of checks) {
    const taken = await strapi.db.query(USER_QUERY).findOne({
      where: { [c.field]: c.value, id: { $ne: excludeUserId } },
      select: ['id'],
    });
    if (taken) {
      const err: any = new Error(
        c.field === 'username'
          ? `El nombre de usuario "${c.value}" ya está tomado.`
          : `El email "${c.value}" ya está registrado.`,
      );
      err.code = c.code;
      throw err;
    }
  }
}

export default ({ strapi }) => ({
  /**
   * List users with pagination, search, and filters
   */
  async getUsers({
    page = 1,
    pageSize = 25,
    search = '',
    status = '',
    role = '',
    tier = '',
    profileComplete = '',
    blocked = '',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    lastActiveFrom = '',
    lastActiveTo = '',
    lastLoginFrom = '',
    lastLoginTo = '',
    app = '',
  }: any) {
    const pg = parseInt(String(page), 10) || 1;
    const ps = Math.min(parseInt(String(pageSize), 10) || 25, 100);
    const offset = (pg - 1) * ps;
    const where: any = {};

    // Search by username or email
    if (search) {
      where.$or = [
        { username: { $containsi: search } },
        { email: { $containsi: search } },
      ];
    }

    // Filter by role
    if (role && ['user', 'admin', 'superadmin'].includes(role)) {
      where.userRole = role;
    }

    // Filter by subscription tier
    if (tier && ['free', 'premium'].includes(tier)) {
      where.subscriptionTier = tier;
    }

    // Filter by profile completion
    if (profileComplete === 'true') {
      where.isProfileComplete = true;
    } else if (profileComplete === 'false') {
      where.isProfileComplete = false;
    }

    // Filter by blocked state (KPI clickable).
    if (blocked === 'true') {
      where.blocked = true;
    } else if (blocked === 'false') {
      where.blocked = false;
    }

    // Filter by connection status
    const now = new Date();
    if (status === 'online') {
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      where.lastActiveAt = { $gte: fiveMinAgo.toISOString() };
    } else if (status === 'connected') {
      // Meta-status: online + inactive (≤ 30 min de inactividad). Cubre lo
      // que un humano consideraría "conectado al sistema".
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      where.lastActiveAt = { $gte: thirtyMinAgo.toISOString() };
    } else if (status === 'inactive') {
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      where.lastActiveAt = {
        $lt: fiveMinAgo.toISOString(),
        $gte: thirtyMinAgo.toISOString(),
      };
    } else if (status === 'offline') {
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      where.lastActiveAt = { $lt: thirtyMinAgo.toISOString() };
      where.lastLoginAt = { $notNull: true };
    } else if (status === 'never') {
      // "Nunca conectado" requiere que el usuario NO tenga ni login ni
      // actividad. Si sólo filtrábamos por lastLoginAt=null, usuarios
      // legacy con lastActiveAt poblado (que la UI pinta como "Offline")
      // también caían aquí, confundiendo al admin.
      where.lastLoginAt = { $null: true };
      where.lastActiveAt = { $null: true };
    }

    // Date-range filters por última actividad y último login. Cada campo
    // acepta ISO strings (yyyy-mm-dd o yyyy-mm-ddThh:mm). El "To" incluye
    // el día completo cuando sólo se pasa la fecha.
    const mergeDateRange = (field: string, from: string, to: string) => {
      const r: any = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) r.$gte = d.toISOString();
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d.getTime())) {
          // Si el usuario pasó sólo la fecha, extender al final del día.
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
            d.setHours(23, 59, 59, 999);
          }
          r.$lte = d.toISOString();
        }
      }
      if (Object.keys(r).length === 0) return;
      // Si ya hay un filtro previo (por status), lo fusionamos.
      where[field] = { ...(where[field] || {}), ...r };
    };
    // Filtro "App": `si` = tiene la app instalada (cualquier plataforma),
    // `no` = nunca avisó, o una plataforma concreta (pwa-ios, ios-nativa…).
    if (app === 'si') {
      where.appInstalada = { $notNull: true };
    } else if (app === 'no') {
      where.appInstalada = { $null: true };
    } else if (app) {
      where.appInstalada = String(app);
    }

    mergeDateRange('lastActiveAt', String(lastActiveFrom), String(lastActiveTo));
    mergeDateRange('lastLoginAt', String(lastLoginFrom), String(lastLoginTo));

    // Strapi orderBy se traduce a `ORDER BY col DESC|ASC` en knex/postgres.
    // En postgres, `DESC` por defecto pone NULLS FIRST — para campos como
    // lastActiveAt o lastLoginAt eso significa que los usuarios sin
    // actividad/login aparecen primero, lo cual no es lo útil para el admin.
    // Estos campos los ordenamos in-memory después de traer el set filtrado,
    // y paginamos en JS, para garantizar NULLS LAST.
    const NULLABLE_DATE_FIELDS = new Set(['lastActiveAt', 'lastLoginAt']);
    let users: any[];
    let total: number;

    if (NULLABLE_DATE_FIELDS.has(String(sortBy))) {
      const allMatching = await strapi.db.query(USER_QUERY).findMany({
        where,
        select: SAFE_FIELDS,
      });
      allMatching.sort((a: any, b: any) => {
        const av = a[sortBy];
        const bv = b[sortBy];
        // NULLS LAST sin importar asc/desc: los vacíos siempre al final.
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av === bv) return 0;
        if (sortOrder === 'desc') return av > bv ? -1 : 1;
        return av > bv ? 1 : -1;
      });
      total = allMatching.length;
      users = allMatching.slice(offset, offset + ps);
    } else {
      [users, total] = await Promise.all([
        strapi.db.query(USER_QUERY).findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          offset,
          limit: ps,
          select: SAFE_FIELDS,
        }),
        strapi.db.query(USER_QUERY).count({ where }),
      ]);
    }

    return {
      data: users,
      meta: {
        pagination: {
          page: pg,
          pageSize: ps,
          total,
          pageCount: Math.ceil(total / ps),
        },
      },
    };
  },

  /**
   * Get statistics for the admin dashboard
   */
  async getStats() {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const q = (where: any) => strapi.db.query(USER_QUERY).count({ where });

    const [
      total, online, connected, neverConnected, profileComplete,
      premium, registeredToday, registeredThisWeek,
      registeredThisMonth, blocked, conApp, conAppIos, conAppAndroid,
    ] = await Promise.all([
      q({}),
      q({ lastActiveAt: { $gte: fiveMinAgo.toISOString() } }),
      // "Conectados" = online + inactive (≤ 30 min). Es el conteo que muestra
      // el KPI del panel admin.
      q({ lastActiveAt: { $gte: thirtyMinAgo.toISOString() } }),
      q({ lastLoginAt: { $null: true } }),
      q({ isProfileComplete: true }),
      q({ subscriptionTier: 'premium' }),
      q({ createdAt: { $gte: todayStart.toISOString() } }),
      q({ createdAt: { $gte: weekStart.toISOString() } }),
      q({ createdAt: { $gte: monthStart.toISOString() } }),
      q({ blocked: true }),
      q({ appInstalada: { $notNull: true } }),
      q({ appInstalada: { $in: ['pwa-ios', 'ios-nativa'] } }),
      q({ appInstalada: { $in: ['pwa-android', 'android-nativa'] } }),
    ]);

    return {
      total, online, connected, neverConnected, profileComplete,
      premium, registeredToday, registeredThisWeek,
      registeredThisMonth, blocked,
      conApp, conAppIos, conAppAndroid,
    };
  },

  /**
   * Conteos del acervo jurídico para el dashboard.
   *
   * Usamos `strapi.documents(uid).count({ status })` (API de Documents de
   * Strapi 5) en vez de `strapi.db.query(uid).count(...)`. La diferencia es
   * crítica con `draftAndPublish: true`:
   *
   *   - `db.query.count({})` cuenta FILAS de la tabla. Cada documento
   *     publicado tiene 2 filas (una draft + una published), así que
   *     contar filas duplica el resultado real.
   *   - `documents().count({ status: 'draft' })` cuenta DOCUMENTOS únicos
   *     que tienen una entry draft (que son todos, ya que Strapi siempre
   *     mantiene un draft).
   *   - `documents().count({ status: 'published' })` cuenta documentos
   *     que tienen una entry publicada.
   *
   * Este bug fue reportado por el usuario el 2026-05-14: el KPI "Acervo
   * total" mostraba 5544 cuando el número real era ~2728.
   */
  async getContentStats() {
    const causaUid = 'api::causa.causa';
    const casacionUid = 'api::casacion.casacion';

    // Catálogos en el formato `[label, uid]` para emitir un objeto plano
    // legible desde el cliente sin acoplarlo a los nombres internos de Strapi.
    const catalogs: [string, string][] = [
      ['jueces', 'api::juez.juez'],
      ['tribunales', 'api::tribunal.tribunal'],
      ['abogados', 'api::abogado.abogado'],
      ['entidades', 'api::entidad.entidad'],
      ['categorias', 'api::categoria.categoria'],
      ['estado-del-juicios', 'api::estado-del-juicio.estado-del-juicio'],
      ['tipo-de-accions', 'api::tipo-de-accion.tipo-de-accion'],
      ['causales-invocadas', 'api::causal-invocada.causal-invocada'],
      ['decision-finals', 'api::decision-final.decision-final'],
      ['decisiones-finales-casacion', 'api::decision-final-casacion.decision-final-casacion'],
      ['recurrentes', 'api::recurrente.recurrente'],
    ];

    const counts = await Promise.all([
      // Causas — total = documentos únicos (incluyendo solo-draft + published)
      strapi.documents(causaUid as any).count({ status: 'draft' }),
      strapi.documents(causaUid as any).count({ status: 'published' }),
      // Casaciones — idem
      strapi.documents(casacionUid as any).count({ status: 'draft' }),
      strapi.documents(casacionUid as any).count({ status: 'published' }),
      // Catálogos — usamos `status: 'draft'` para obtener el conteo único
      // de documentos. Para content-types sin D&P, devuelve el total normal.
      ...catalogs.map(([, uid]) =>
        strapi.documents(uid as any).count({ status: 'draft' })
      ),
    ]);

    const [causasTotal, causasPublished, casacionesTotal, casacionesPublished, ...catalogCounts] =
      counts;

    const catalogsByName: Record<string, number> = {};
    let catalogsTotal = 0;
    catalogs.forEach(([label], i) => {
      catalogsByName[label] = catalogCounts[i];
      catalogsTotal += catalogCounts[i];
    });

    return {
      causasTotal,
      causasPublished,
      causasDraft: causasTotal - causasPublished,
      casacionesTotal,
      casacionesPublished,
      casacionesDraft: casacionesTotal - casacionesPublished,
      catalogsTotal,
      catalogsByName,
    };
  },

  /**
   * Devuelve los 5 últimos usuarios registrados y los 5 últimos que hicieron
   * login, para alimentar los feeds del dashboard. Antes eran 2 fetches HTTP
   * separados desde la webapp; ahora viajan dentro de la misma respuesta.
   */
  async getRecentActivity() {
    const [recentUsers, recentLogins] = await Promise.all([
      strapi.db.query(USER_QUERY).findMany({
        orderBy: { createdAt: 'desc' },
        limit: 5,
        select: SAFE_FIELDS,
      }),
      strapi.db.query(USER_QUERY).findMany({
        where: { lastLoginAt: { $notNull: true } },
        orderBy: { lastLoginAt: 'desc' },
        limit: 5,
        select: SAFE_FIELDS,
      }),
    ]);
    return { recentUsers, recentLogins };
  },

  /**
   * Orquesta los tres bloques de datos del dashboard en un solo Promise.all
   * para que el endpoint `/admin-panel/stats` devuelva todo en una HTTP call.
   * Reemplaza ~18 fetches REST sueltos que la webapp hacía antes.
   *
   * Resolvemos el service via `strapi.plugin().service()` en vez de `this`
   * porque Strapi a veces invoca métodos sin preservar el binding original.
   */
  async getDashboardData() {
    const self = strapi.plugin('admin-panel').service('service');
    const [users, content, activity] = await Promise.all([
      self.getStats(),
      self.getContentStats(),
      self.getRecentActivity(),
    ]);
    return {
      users,
      content,
      ...activity,
    };
  },

  /**
   * Get a single user by numeric id or documentId
   */
  async getUserById(id: number | string) {
    // Try by documentId first (Strapi 5 preferred identifier)
    let user = await strapi.db.query(USER_QUERY).findOne({
      where: { documentId: String(id) },
      select: SAFE_FIELDS,
    });
    // Fallback: try numeric id
    if (!user && !isNaN(Number(id))) {
      user = await strapi.db.query(USER_QUERY).findOne({
        where: { id: Number(id) },
        select: SAFE_FIELDS,
      });
    }
    return user;
  },

  /**
   * Resolve a user identifier (documentId or numeric id) to a where clause
   */
  async resolveUserWhere(id: number | string) {
    const byDoc = await strapi.db.query(USER_QUERY).findOne({ where: { documentId: String(id) } });
    if (byDoc) return { id: byDoc.id };
    if (!isNaN(Number(id))) return { id: Number(id) };
    return { id };
  },

  /**
   * Update a user's role (superadmin only)
   */
  async updateUserRole(id: number | string, userRole: string) {
    if (!['user', 'admin', 'superadmin'].includes(userRole)) {
      throw new Error('Rol inv\u00e1lido');
    }
    const where = await this.resolveUserWhere(id);
    return strapi.db.query(USER_QUERY).update({ where, data: { userRole } });
  },

  /**
   * Borrado duro de un usuario. Limpia filas dependientes en el schema
   * analytics antes de remover el registro de up_users, para no dejar
   * huérfanos ni chocar con foreign keys cuando existan.
   *
   * Errores estructurados:
   *   - NOT_FOUND       → el id/documentId no corresponde a un usuario
   *   - SELF_DELETE     → el admin intentó eliminarse a sí mismo
   */
  async deleteUser(id: number | string, requesterNumericId?: number) {
    const where = await this.resolveUserWhere(id);
    const existing = await strapi.db.query(USER_QUERY).findOne({ where });
    if (!existing) {
      const err: any = new Error('Usuario no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (requesterNumericId && Number(requesterNumericId) === Number(existing.id)) {
      const err: any = new Error('Self delete is not allowed');
      err.code = 'SELF_DELETE';
      throw err;
    }

    // Limpieza best-effort en el schema analytics. Lo hacemos con try/catch
    // por tabla para soportar despliegues donde el schema aún no existe.
    // NOTA: analytics.admin_audit NO se limpia — es bitácora histórica de
    // acciones admin y debe persistir aunque el actor sea borrado.
    const conn = strapi.db.connection;
    const tablesToClean = [
      'analytics.case_interactions',
      'analytics.events',
      'analytics.sessions',
      'analytics.searches',
      'analytics.user_tags',
      'analytics.user_notes',
      'analytics.user_assignments',
      'analytics.user_profiles_computed',
      'analytics.lead_history',
      'analytics.admin_seen',
      'analytics.admin_audit',
    ];
    let analyticsCleaned = 0;
    for (const tbl of tablesToClean) {
      try {
        await conn.raw(`DELETE FROM ${tbl} WHERE user_id = ?`, [existing.id]);
        analyticsCleaned++;
      } catch (e: any) {
        strapi.log.warn(`[admin-panel.deleteUser] skip cleanup ${tbl}: ${e?.message ?? e}`);
      }
    }

    // Contenido del Debate y dispositivos push del usuario. Antes quedaban
    // huérfanos: los hilos y comentarios seguían visibles (con el autor caído
    // a "Usuario") y los tokens push seguían activos, así que un teléfono
    // podía recibir avisos de una cuenta ya borrada. La pantalla de eliminar
    // promete que se borra el perfil y su actividad — esto lo cumple.
    try {
      const temas = await strapi.db
        .query('api::tribuna-tema.tribuna-tema')
        .findMany({ where: { user: { id: existing.id } }, select: ['id'], limit: 5000 });
      for (const t of temas) {
        await strapi.db
          .query('api::tribuna-comentario.tribuna-comentario')
          .deleteMany({ where: { tema: { id: t.id } } })
          .catch(() => {});
      }
      await strapi.db
        .query('api::tribuna-comentario.tribuna-comentario')
        .deleteMany({ where: { user: { id: existing.id } } });
      await strapi.db
        .query('api::tribuna-tema.tribuna-tema')
        .deleteMany({ where: { user: { id: existing.id } } });
      await strapi.db
        .query('api::tribuna-denuncia.tribuna-denuncia')
        .deleteMany({ where: { user: { id: existing.id } } });
    } catch (e: any) {
      strapi.log.warn(`[admin-panel.deleteUser] limpieza de tribuna: ${e?.message ?? e}`);
    }
    try {
      await strapi.db
        .query('api::push-dispositivo.push-dispositivo')
        .deleteMany({ where: { user: { id: existing.id } } });
      await strapi.db
        .query('api::notificacion.notificacion')
        .deleteMany({ where: { user: { id: existing.id } } });
    } catch (e: any) {
      strapi.log.warn(`[admin-panel.deleteUser] limpieza de push: ${e?.message ?? e}`);
    }

    // Apple exige que, si se ofrece "Iniciar sesión con Apple", al borrar la
    // cuenta se REVOQUE el token en sus servidores — no basta con borrar la
    // fila local. Mejor esfuerzo: si falla, el borrado continúa.
    //
    // El disparador es tener `appleRefreshToken`, NO la columna `provider`:
    // el registro siempre escribe provider:'local' (users-permissions lo
    // reserva para su propio flujo), así que condicionar a provider==='apple'
    // dejaba la revocación como código muerto — nunca se ejecutaba y ante
    // App Review la app incumplía 5.1.1(v) pese a tener el código escrito.
    // Si hay refresh token es porque el usuario entró con Apple alguna vez.
    let usuarioApple = existing;
    if (!usuarioApple?.appleRefreshToken) {
      // `existing` puede venir de una consulta con `select` acotado.
      usuarioApple = await strapi.db
        .query('plugin::users-permissions.user')
        .findOne({ where: { id: existing.id }, select: ['id', 'appleRefreshToken'] });
    }
    if (usuarioApple?.appleRefreshToken) {
      try {
        const { revocarTokenApple } = await import('../utils/apple-revocar');
        await revocarTokenApple(strapi, usuarioApple);
      } catch (e: any) {
        strapi.log.warn(`[admin-panel.deleteUser] revocación Apple: ${e?.message ?? e}`);
      }
    }

    // Paso 1 — invitación asociada por FK (relación `user`). Casos típicos:
    // user que vino del flujo de auto-registro, donde la fila quedó linkeada.
    let invitedByFk = 0;
    try {
      const linked = await strapi.db
        .query('api::invited-email.invited-email')
        .findMany({ where: { user: existing.id } });
      for (const inv of linked) {
        await strapi.db
          .query('api::invited-email.invited-email')
          .delete({ where: { id: inv.id } });
      }
      invitedByFk = linked.length;
    } catch (e: any) {
      strapi.log.warn(`[admin-panel.deleteUser] skip invited_emails (by user) cleanup: ${e?.message ?? e}`);
    }

    // Paso 2 — barrer filas huérfanas por email. Sin esto, un user creado
    // manualmente (sin pasar por invitación) dejaría una fila en
    // invited_emails con el correo, y como `email` es UNIQUE, futuras
    // invitaciones al mismo correo fallarían con 409 already_invited.
    let invitedByEmail = 0;
    try {
      if (existing.email) {
        const orphans = await strapi.db
          .query('api::invited-email.invited-email')
          .findMany({ where: { email: existing.email } });
        for (const inv of orphans) {
          await strapi.db
            .query('api::invited-email.invited-email')
            .delete({ where: { id: inv.id } });
        }
        invitedByEmail = orphans.length;
      }
    } catch (e: any) {
      strapi.log.warn(`[admin-panel.deleteUser] skip invited_emails (by email) cleanup: ${e?.message ?? e}`);
    }

    // Favoritos del usuario. Borramos las filas para no dejar `causaDocumentId`
    // sueltos referenciando un user_id que ya no existe.
    let favoritosCleaned = 0;
    try {
      const favs = await traerTodo(strapi, 'api::favorito.favorito', {
        where: { user: existing.id },
      });
      for (const f of favs) {
        await strapi.db.query('api::favorito.favorito').delete({ where: { id: f.id } });
      }
      favoritosCleaned = favs.length;
    } catch (e: any) {
      strapi.log.warn(`[admin-panel.deleteUser] skip favoritos cleanup: ${e?.message ?? e}`);
    }

    // Jugadas de Falla Tú. Si quedaran huérfanas afectan el ranking global,
    // así que las borramos también.
    let jugadasCleaned = 0;
    try {
      const jugadas = await traerTodo(strapi, 'api::falla-tu-jugada.falla-tu-jugada', {
        where: { user: existing.id },
      });
      for (const j of jugadas) {
        await strapi.db
          .query('api::falla-tu-jugada.falla-tu-jugada')
          .delete({ where: { id: j.id } });
      }
      jugadasCleaned = jugadas.length;
    } catch (e: any) {
      strapi.log.warn(`[admin-panel.deleteUser] skip falla_tu_jugadas cleanup: ${e?.message ?? e}`);
    }

    await strapi.db.query(USER_QUERY).delete({ where: { id: existing.id } });

    strapi.log.info(
      `[admin-panel.deleteUser] user=${existing.id} email=${existing.email} ` +
      `analytics_tables=${analyticsCleaned}/${tablesToClean.length} ` +
      `invited_by_fk=${invitedByFk} invited_by_email=${invitedByEmail} ` +
      `favoritos=${favoritosCleaned} jugadas=${jugadasCleaned}`,
    );

    return { deleted: true, id: existing.id };
  },

  /**
   * Toggle block/unblock user
   */
  async toggleBlockUser(id: number | string) {
    const where = await this.resolveUserWhere(id);
    const user = await strapi.db.query(USER_QUERY).findOne({ where });
    if (!user) throw new Error('Usuario no encontrado');
    return strapi.db.query(USER_QUERY).update({
      where: { id: user.id },
      data: { blocked: !user.blocked },
    });
  },

  /**
   * Update a user's data (admin action)
   * Includes profile fields so superadmins can edit username, email, location, picture, etc.
   *
   * Valida unicidad de `username` y `email` a nivel app porque la DB no
   * tiene constraint UNIQUE en esos campos. Sin esta validación, el admin
   * podría poner dos usuarios con el mismo username (probado en vivo).
   */
  async updateUser(id: number | string, data: any) {
    const allowed = [
      // admin-only controls
      //
      // `userRole` NO va acá. La ruta que llega hasta este servicio está
      // protegida por isAdmin, que acepta admin Y superadmin: dejarlo en la
      // lista permitía que un admin común se hiciera superadmin con un
      // PUT sobre su propio id (el enum del schema acepta el valor, así que
      // pasaba la validación de Strapi sin más). El cambio de rol vive en
      // updateUserRole(), que sí exige superadmin.
      'blocked', 'subscriptionTier', 'isProfileComplete',
      // profile fields (paridad con los campos del formulario de registro)
      'username', 'email', 'firstName', 'lastName',
      'university', 'profession', 'city', 'country',
      'phone', 'picture', 'currentJob', 'interests',
      'fechaNacimiento', 'emailPersonal',
    ];
    const filtered: any = {};
    for (const key of allowed) {
      if (data[key] !== undefined) filtered[key] = data[key];
    }
    const where = await this.resolveUserWhere(id);
    const existing = await strapi.db.query(USER_QUERY).findOne({ where });
    if (!existing) throw new Error('Usuario no encontrado');

    await assertUsernameEmailUnique(strapi, filtered, existing.id);

    return strapi.db.query(USER_QUERY).update({
      where: { id: existing.id },
      data: filtered,
      select: SAFE_FIELDS,
    });
  },

  /**
   * Update own profile (authenticated user)
   */
  async updateProfile(userId: number | string, data: any) {
    const profileFields = [
      'username', 'university', 'profession', 'city', 'country',
      'currentJob', 'interests', 'phone', 'picture',
      'fechaNacimiento', 'emailPersonal', 'firstName', 'lastName',
    ];
    const filtered: any = {};
    for (const key of profileFields) {
      if (data[key] !== undefined) filtered[key] = data[key];
    }

    // El usuario solo puede tocar su `username` desde mi-cuenta. Bloqueamos
    // que use uno ya tomado por otro user.
    await assertUsernameEmailUnique(strapi, filtered, Number(userId));

    const current = await strapi.db.query(USER_QUERY).findOne({ where: { id: userId } });
    const merged = { ...current, ...filtered };
    const isStudent = merged.profession === STUDENT_PROFESSION;

    const requiredFields = ['profession', 'city', 'country', 'interests', 'fechaNacimiento'];
    if (isStudent) {
      requiredFields.push('university', 'emailPersonal');
    } else {
      requiredFields.push('currentJob');
    }

    const allComplete = requiredFields.every((f) => {
      const val = merged[f];
      if (f === 'interests') {
        // interests may arrive as JSON string (from frontend) or as array
        let parsed = val;
        if (typeof val === 'string') {
          try { parsed = JSON.parse(val); } catch { return false; }
        }
        return Array.isArray(parsed) && parsed.length > 0;
      }
      return val !== null && val !== undefined && String(val).trim().length > 0;
    });

    if (allComplete) filtered.isProfileComplete = true;

    return strapi.db.query(USER_QUERY).update({
      where: { id: userId },
      data: filtered,
      select: SAFE_FIELDS,
    });
  },
});
