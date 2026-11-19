import { ensureLaunch } from './services/launch-sequence';
import { ensureAcquisition } from './services/acquisition';
import type { Core } from '@strapi/strapi';
import { iniciarCjEstadisticas } from './cj-estadisticas';

/**
 * Ensure the "currentJob" column exists in up_users.
 * Strapi’s auto-migration sometimes skips columns added to
 * extended content-types, so we create it manually if needed.
 */
const ensureCurrentJobColumn = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "currentJob" varchar(255)'
    );
    strapi.log.info('[admin-panel] Ensured currentJob column exists');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure currentJob column: ' + e.message);
  }
};

/**
 * Ensure the "picture" column exists in up_users so users can store
 * their profile photo URL. Strapi's auto-migration sometimes skips
 * columns added to extended content-types, so we create it manually
 * if needed.
 */
const ensurePictureColumn = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "picture" varchar(255)'
    );
    strapi.log.info('[admin-panel] Ensured picture column exists');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure picture column: ' + e.message);
  }
};

/**
 * Sprint 12 · password recovery / forced password change.
 * Columns:
 *   - mustChangePassword       boolean  (default false)
 *   - passwordChangedAt        timestamp
 *   - passwordResetRequestedAt timestamp
 */
const ensureMustChangePasswordColumn = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean DEFAULT false'
    );
    strapi.log.info('[admin-panel] Ensured mustChangePassword column exists');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure mustChangePassword column: ' + e.message);
  }
};

const ensurePasswordChangedAtColumn = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp'
    );
    strapi.log.info('[admin-panel] Ensured passwordChangedAt column exists');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure passwordChangedAt column: ' + e.message);
  }
};

const ensurePasswordResetRequestedAtColumn = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "passwordResetRequestedAt" timestamp'
    );
    strapi.log.info('[admin-panel] Ensured passwordResetRequestedAt column exists');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure passwordResetRequestedAt column: ' + e.message);
  }
};

/**
 * Sprint 12b · rediseño por token.
 * La contraseña NUNCA se cambia al enviar el formulario. Sólo cuando el
 * usuario hace clic en el link del correo, se valida el token y ahí se
 * define la nueva contraseña.
 *   - passwordResetTokenHash         varchar(255)  (sha-256 hex del token)
 *   - passwordResetTokenExpiresAt    timestamp     (1h desde emisión)
 */
const ensurePasswordResetTokenColumns = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" varchar(255)'
    );
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "passwordResetTokenExpiresAt" timestamp'
    );
    strapi.log.info('[admin-panel] Ensured password-reset token columns exist');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure token columns: ' + e.message);
  }
};

/**
 * Sprint registro-whitelist · columnas de auto-registro estudiantil.
 *   - firstName, lastName: nombre y apellido capturados en el form de registro.
 *     Hoy `username` se usa como handle público; estas columnas guardan el
 *     dato real para reportes y para mostrarlos en la UI sin parsear el username.
 *   - termsAcceptedAt: timestamp del consentimiento al checkbox de términos.
 *     Requisito de compliance (LOPDP) para auditar quién aceptó y cuándo.
 */
const ensureRegistrationColumns = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "firstName" varchar(80)'
    );
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "lastName" varchar(80)'
    );
    await strapi.db.connection.raw(
      'ALTER TABLE up_users ADD COLUMN IF NOT EXISTS "termsAcceptedAt" timestamp'
    );
    strapi.log.info('[admin-panel] Ensured registration columns (firstName/lastName/termsAcceptedAt)');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure registration columns: ' + e.message);
  }
};

/**
 * Sprint registro-whitelist · índices en invited_emails.
 *   - lower(email) unique: anti-duplicados case-insensitive.
 *   - registrationTokenHash: lookup en confirmar.
 *   - (status, university): filtros y analítica del panel.
 *   - batch_id: trazabilidad CSV.
 *
 * Strapi crea la tabla la primera vez que arranca con el nuevo schema; los
 * índices se aplican aquí porque el schema JSON no soporta declararlos.
 */
const ensureInvitedEmailIndexes = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS invited_emails_lower_email_uniq ON invited_emails (LOWER(email))'
    );
    await strapi.db.connection.raw(
      'CREATE INDEX IF NOT EXISTS invited_emails_token_hash_idx ON invited_emails (registration_token_hash) WHERE registration_token_hash IS NOT NULL'
    );
    await strapi.db.connection.raw(
      'CREATE INDEX IF NOT EXISTS invited_emails_status_university_idx ON invited_emails (status, university)'
    );
    await strapi.db.connection.raw(
      'CREATE INDEX IF NOT EXISTS invited_emails_batch_idx ON invited_emails (batch_id) WHERE batch_id IS NOT NULL'
    );
    strapi.log.info('[admin-panel] Ensured invited_emails indexes');
  } catch (e: any) {
    strapi.log.warn('[admin-panel] Could not ensure invited_emails indexes: ' + e.message);
  }
};

/**
 * Grant the "authenticated" role permission to access specific
 * content-api actions exposed by this plugin.
 */
const ensureAuthenticatedPermissions = async (strapi: Core.Strapi) => {
  const actions = [
    // Public routes (any authenticated user)
    'plugin::admin-panel.controller.updateProfile',
    'plugin::admin-panel.controller.activityPing',
    // Sin estas entries users-permissions responde 403 ANTES de que corra el
    // controlador, y el aviso muere en silencio (el cliente no lo reporta).
    // La app avisa que corre instalada → KPI "Con la app instalada" + columna App.
    'plugin::admin-panel.controller.appInstalada',
    // Sello de login real → lastLoginAt / loginCount del panel.
    'plugin::admin-panel.controller.trackLogin',
    // Borrado de la propia cuenta desde la app (lo exige Apple, guideline 5.1.1).
    'plugin::admin-panel.controller.deleteOwnAccount',
    // Sprint 12 · cambio forzado de contraseña (JWT requerido)
    'plugin::admin-panel.changePassword.changePassword',
    // Premium: activación por compra In-App y créditos de Jurimetría IA
    'plugin::admin-panel.premium.iapActivar',
    'plugin::admin-panel.premium.jurimetriaSaldo',
    'plugin::admin-panel.premium.jurimetriaConsumir',
    // Admin routes (isAdmin policy handles authorization)
    'plugin::admin-panel.controller.getUsers',
    'plugin::admin-panel.controller.getStats',
    'plugin::admin-panel.controller.getUserById',
    'plugin::admin-panel.controller.updateUser',
    'plugin::admin-panel.controller.updateUserRole',
    'plugin::admin-panel.controller.toggleBlockUser',
    // Sprint actual · crear usuario sin depender de allow_register
    'plugin::admin-panel.controller.createUser',
    // Borrado duro desde panel admin
    'plugin::admin-panel.controller.deleteUser',
    // Broadcast de correos (relaunch) — sin estas entries users-permissions
    // rechaza la llamada antes de que la policy isAdmin corra → 403 mudo.
    'plugin::admin-panel.broadcast.preview',
    'plugin::admin-panel.broadcast.sendRelaunch',
    // Lanzamiento de la app nativa — mismo motivo que las dos de arriba.
    'plugin::admin-panel.broadcast.previewAppLaunch',
    'plugin::admin-panel.broadcast.sendAppLaunch',
    // Invitación al directorio de profesionales — mismo motivo: sin la entry,
    // users-permissions responde 403 antes de que corra la policy isAdmin.
    'plugin::admin-panel.broadcast.previewProfesionales',
    'plugin::admin-panel.broadcast.vistaProfesionales',
    'plugin::admin-panel.broadcast.sendProfesionales',
    // Control de las campañas a cuentagotas — misma trampa de permisos.
    'plugin::admin-panel.broadcast.estadoCampanas',
    'plugin::admin-panel.resultadosCorreo.resultados',
    'plugin::admin-panel.acquisition.report',
    'plugin::admin-panel.launch.status',
    'plugin::admin-panel.launch.import',
    'plugin::admin-panel.launch.test',
    'plugin::admin-panel.launch.configure',

    'plugin::admin-panel.broadcast.configurarCampana',
    'plugin::admin-panel.broadcast.tandaAhora',
    // Ranking Legal Ecuador — misma trampa de permisos.
    'plugin::admin-panel.broadcast.previewRanking',
    'plugin::admin-panel.broadcast.sendRanking',
    // Registro por invitación — endpoints admin (la policy isAdmin filtra).
    'plugin::admin-panel.invitedEmails.bulk',
    'plugin::admin-panel.invitedEmails.create',
    'plugin::admin-panel.invitedEmails.list',
    'plugin::admin-panel.invitedEmails.delete',
    'plugin::admin-panel.invitedEmails.resend',
    'plugin::admin-panel.invitedEmails.stats',
    // Reenvío del correo de bienvenida desde el panel (la policy isAdmin filtra).
    'plugin::admin-panel.invitedEmails.resendWelcome',
    'plugin::admin-panel.invitedEmails.bulkResendWelcome',
    'plugin::admin-panel.invitedEmails.bulkResendWelcomeStatus',
    // CRUD de contenido jurídico desde el panel admin (la policy isAdmin filtra).
    // Sin estas entries, Strapi rechaza con 403 mudo ANTES de correr la policy.
    'plugin::admin-panel.content.createContent',
    'plugin::admin-panel.content.updateContent',
    'plugin::admin-panel.content.deleteContent',
    // Subir y borrar archivos del Upload library (PDFs de sentencia) desde panel admin.
    'plugin::admin-panel.uploadAdmin.uploadFile',
    'plugin::admin-panel.uploadAdmin.deleteFile',
    // Sinónimos / relaciones del buscador (la policy isAdmin filtra). Sin estas
    // entries, Strapi rechaza con 403 mudo ANTES de correr la policy.
    'plugin::admin-panel.sinonimos.list',
    'plugin::admin-panel.sinonimos.create',
    'plugin::admin-panel.sinonimos.update',
    'plugin::admin-panel.sinonimos.remove',
    // Reenvío programado de bienvenida (la policy isAdmin filtra).
    'plugin::admin-panel.reenvioBienvenida.estado',
    'plugin::admin-panel.reenvioBienvenida.programar',
    'plugin::admin-panel.reenvioBienvenida.cancelar',
  ];

  // Find the "authenticated" role created by users-permissions
  const authenticatedRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });

  if (!authenticatedRole) {
    strapi.log.warn(
      '[admin-panel] Could not find "authenticated" role \u2013 skipping permission bootstrap',
    );
    return;
  }

  for (const action of actions) {
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({
        where: { action, role: authenticatedRole.id },
      });

    if (!existing) {
      await strapi
        .query('plugin::users-permissions.permission')
        .create({
          data: { action, role: authenticatedRole.id },
        });
      strapi.log.info(`[admin-panel] Granted "\${action}" to authenticated role`);
    }
  }
};

/**
 * Vocabulario del buscador ("¿Quisiste decir…?" en la webapp).
 *
 * La tabla vive aquí y no en la webapp porque el usuario de BD de la webapp
 * (DATABASE_URL_READONLY) no puede crear tablas. El CMS la crea, la puebla
 * desde el corpus publicado (causas + casaciones) y la refresca a diario;
 * la webapp solo hace SELECT por similitud trigram.
 *
 * `forma` guarda la grafía más frecuente (con tildes) para mostrar al
 * usuario; `palabra` es la clave normalizada (minúsculas, sin tildes) para
 * el matching. HAVING >= 2 filtra palabras que aparecen una sola vez
 * (suelen ser erratas del propio texto) para no "corregir" hacia una errata.
 */
const refreshBuscadorVocabulario = async (strapi: Core.Strapi) => {
  const conn = strapi.db.connection;
  await conn.raw(`
    CREATE TABLE IF NOT EXISTS buscador_vocabulario (
      palabra text PRIMARY KEY,
      forma   text NOT NULL,
      nveces  int  NOT NULL
    )`);
  // En una base nueva (CMS derivado por materia) la extensión no existe todavía.
  await conn.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await conn.raw(`
    CREATE INDEX IF NOT EXISTS buscador_vocabulario_trgm
    ON buscador_vocabulario USING gin (palabra gin_trgm_ops)`);
  await conn.raw('DELETE FROM buscador_vocabulario');
  await conn.raw(`
    INSERT INTO buscador_vocabulario (palabra, forma, nveces)
    SELECT lower(f_unaccent(forma)) AS palabra,
           (array_agg(forma ORDER BY n DESC))[1] AS forma,
           sum(n)::int AS nveces
    FROM (
      SELECT lower(m[1]) AS forma, count(*) AS n
      FROM (
        SELECT concat_ws(' ',
          c.juicio, c.resumen_del_caso, c.antecedentes, c.objeto_de_controversia,
          c.pretensiones, c.argumentos_del_actor, c.argumentos_del_demandado,
          c.criterio_sala_para_resolver, c.jurisprudencia_mencionada) AS texto
        FROM causas c WHERE c.published_at IS NOT NULL
        UNION ALL
        SELECT concat_ws(' ',
          ca.antecedentes, ca.argumentos_del_recurrente, ca.argumentos_contraparte,
          ca.criterio_sala_para_resolver, ca.jurisprudencia_mencionada)
        FROM casaciones ca WHERE ca.published_at IS NOT NULL
      ) docs,
      LATERAL regexp_matches(docs.texto, '[[:alpha:]]{4,}', 'g') m
      GROUP BY lower(m[1])
    ) palabras
    GROUP BY lower(f_unaccent(forma))
    HAVING sum(n) >= 2`);
  strapi.log.info('[admin-panel] buscador_vocabulario refrescado');
};

const iniciarVocabularioBuscador = (strapi: Core.Strapi) => {
  const correr = () =>
    refreshBuscadorVocabulario(strapi).catch((e: any) =>
      strapi.log.warn('[admin-panel] vocabulario del buscador falló: ' + e.message)
    );
  // Al arrancar (fuera del boot crítico) y luego una vez al día.
  setTimeout(correr, 30_000);
  const timer = setInterval(correr, 24 * 60 * 60 * 1000);
  (timer as any).unref?.();
};

/**
 * Reloj del reenvío programado de bienvenida: cada minuto revisa si hay una
 * programación cuya hora llegó (o una ejecución interrumpida por reinicio)
 * y la dispara. Vive aquí, no en un cron del sistema, para que sobreviva a
 * los redeploys de Render sin configuración externa.
 */
const iniciarReenvioBienvenida = (strapi: Core.Strapi) => {
  const tick = () => {
    strapi
      .plugin('admin-panel')
      .service('reenvioBienvenida')
      .tick()
      .catch((err: any) =>
        strapi.log.error('[reenvio-bienvenida] tick falló: ' + (err?.message ?? err))
      );
  };
  const timer = setInterval(tick, 60_000);
  (timer as any).unref?.();
  // Primer chequeo al arrancar: retoma envíos interrumpidos por el deploy.
  setTimeout(tick, 15_000);
};

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  await ensureAcquisition(strapi.db.connection);
  await ensureLaunch(strapi.db.connection);
  await ensureCurrentJobColumn(strapi);
  await ensurePictureColumn(strapi);
  await ensureMustChangePasswordColumn(strapi);
  await ensurePasswordChangedAtColumn(strapi);
  await ensurePasswordResetRequestedAtColumn(strapi);
  await ensurePasswordResetTokenColumns(strapi);
  await ensureRegistrationColumns(strapi);
  await ensureInvitedEmailIndexes(strapi);
  await ensureAuthenticatedPermissions(strapi);
  iniciarReenvioBienvenida(strapi);
  iniciarVocabularioBuscador(strapi);
  iniciarCjEstadisticas(strapi);
};

export default bootstrap;
