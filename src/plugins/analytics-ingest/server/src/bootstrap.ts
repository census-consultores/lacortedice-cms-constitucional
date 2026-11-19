import type { Core } from '@strapi/strapi';

/**
 * Grant the "authenticated" role permission to access the analytics-ingest
 * endpoints. Also ensures the "public" role has access to the anonymous ingest
 * endpoint (since events are captured pre-login too).
 *
 * Idempotent — only creates permission rows when they don't already exist.
 */
const ensurePermissions = async (strapi: Core.Strapi) => {
  const authenticatedActions = [
    'plugin::analytics-ingest.ingest.ingest',
  ];
  const publicActions = [
    'plugin::analytics-ingest.ingest.ingest',
  ];
  const adminActions = [
    // Sprint 0-2 — KPIs + búsqueda base
    'plugin::analytics-ingest.admin.kpis',
    'plugin::analytics-ingest.admin.keywords',
    'plugin::analytics-ingest.admin.zeroResults',
    'plugin::analytics-ingest.admin.topCases',
    'plugin::analytics-ingest.admin.userProfile',
    'plugin::analytics-ingest.admin.caseDetail',
    'plugin::analytics-ingest.admin.hotLeads',
    'plugin::analytics-ingest.admin.funnel',
    // Embudo de entrada (ingresar / crear cuenta / recuperar). Sin esta línea
    // users-permissions responde 403 ANTES de que corra el controlador y la
    // pantalla diría «el módulo está apagado» con el módulo funcionando.
    'plugin::analytics-ingest.admin.embudoEntrada',
    // Audiencia y plataforma — sin este permiso la pantalla recibe 403 y
    // muestra «el módulo está apagado», que despista: el módulo corre bien.
    'plugin::analytics-ingest.admin.audiencia',
    'plugin::analytics-ingest.admin.searchUsers',
    // Sprint 3-4 — CRM lite
    'plugin::analytics-ingest.admin.crmGet',
    'plugin::analytics-ingest.admin.crmAddNote',
    'plugin::analytics-ingest.admin.crmDeleteNote',
    'plugin::analytics-ingest.admin.crmAddTag',
    'plugin::analytics-ingest.admin.crmDeleteTag',
    'plugin::analytics-ingest.admin.crmTagsSummary',
    'plugin::analytics-ingest.admin.crmPipeline',
    // Sprint 5 — Asignación
    'plugin::analytics-ingest.admin.teamMembers',
    'plugin::analytics-ingest.admin.assignmentSet',
    'plugin::analytics-ingest.admin.assignmentClear',
    'plugin::analytics-ingest.admin.assignmentsSummary',
    'plugin::analytics-ingest.admin.myInbox',
    'plugin::analytics-ingest.admin.salesFunnel',
    'plugin::analytics-ingest.admin.teamLeaderboard',
    'plugin::analytics-ingest.admin.weeklySnapshot',
    'plugin::analytics-ingest.admin.caseSimilar',
    // Sprint 7 — Alertas
    'plugin::analytics-ingest.admin.myAlerts',
    'plugin::analytics-ingest.admin.markSeen',
    // Sprint 8 — Historial + bulk
    'plugin::analytics-ingest.admin.leadHistory',
    'plugin::analytics-ingest.admin.crmBulk',
    // Sprint 9 — Auto-rules + settings
    'plugin::analytics-ingest.admin.autoRulesList',
    'plugin::analytics-ingest.admin.autoRulesUpdate',
    'plugin::analytics-ingest.admin.autoRulesRunOne',
    'plugin::analytics-ingest.admin.settingsGet',
    'plugin::analytics-ingest.admin.settingsUpdate',
    // Sprint 10 — Webhooks + predicción
    'plugin::analytics-ingest.admin.webhooksList',
    'plugin::analytics-ingest.admin.webhooksCreate',
    'plugin::analytics-ingest.admin.webhooksUpdate',
    'plugin::analytics-ingest.admin.webhooksDelete',
    'plugin::analytics-ingest.admin.webhooksTest',
    'plugin::analytics-ingest.admin.webhooksDeliveries',
    'plugin::analytics-ingest.admin.conversionStats',
    'plugin::analytics-ingest.admin.closeProbability',
    // Insights + drill-down + banda 4
    'plugin::analytics-ingest.admin.insights',
    'plugin::analytics-ingest.admin.zeroResultDetail',
    'plugin::analytics-ingest.admin.dailyPulse',
    'plugin::analytics-ingest.admin.atRiskUsers',
    // Exports CSV
    'plugin::analytics-ingest.admin.exportHotLeads',
    'plugin::analytics-ingest.admin.exportZeroResults',
    'plugin::analytics-ingest.admin.exportAtRiskUsers',
  ];

  const grantTo = async (roleType: 'authenticated' | 'public', actions: string[]) => {
    const role = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: roleType } });

    if (!role) {
      strapi.log.warn(`[analytics-ingest] role "${roleType}" not found`);
      return;
    }

    for (const action of actions) {
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: role.id } });

      if (!existing) {
        await strapi
          .query('plugin::users-permissions.permission')
          .create({ data: { action, role: role.id } });
        strapi.log.info(`[analytics-ingest] granted "${action}" to ${roleType}`);
      }
    }
  };

  await grantTo('authenticated', [...authenticatedActions, ...adminActions]);
  await grantTo('public', publicActions);
};

/**
 * Create CRM-lite tables (user_notes + user_tags) idempotently.
 *
 * Sprint 3 — closes the commercial loop on top of the hot-leads signals:
 * once someone identifies a hot lead the sales team needs to record who
 * already reached out and what was the outcome.
 */
const ensureCrmTables = async (strapi: Core.Strapi) => {
  try {
    await strapi.db.connection.raw(`
      CREATE TABLE IF NOT EXISTS analytics.user_notes (
        id            BIGSERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL,
        author_id     INTEGER,
        author_email  TEXT,
        content       TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_user_notes_user ON analytics.user_notes (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS analytics.user_tags (
        user_id    INTEGER NOT NULL,
        tag        TEXT NOT NULL,
        author_id  INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_user_tags_tag ON analytics.user_tags (tag);

      -- Sprint 5: asignación de leads a miembros del equipo. Un lead solo
      -- puede estar asignado a una persona a la vez (PK en user_id), lo
      -- que refleja la realidad comercial: un dueño por oportunidad.
      CREATE TABLE IF NOT EXISTS analytics.user_assignments (
        user_id         INTEGER PRIMARY KEY,
        assignee_id     INTEGER NOT NULL,
        assignee_email  TEXT,
        assigned_by_id  INTEGER,
        assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        note            TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_assignments_assignee
        ON analytics.user_assignments (assignee_id);

      -- Sprint 7: persistimos "lo último que vio cada admin" para que el
      -- badge de alertas muestre sólo leads nuevos desde su última visita.
      CREATE TABLE IF NOT EXISTS analytics.admin_seen (
        admin_id                 INTEGER PRIMARY KEY,
        last_inbox_seen_at       TIMESTAMPTZ,
        last_dashboard_seen_at   TIMESTAMPTZ,
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Sprint 8: audit trail comercial del lead. Cada cambio de tag,
      -- asignación o nota deja un registro permanente aunque después se
      -- eliminen los tags/asignaciones. Permite reconstruir el ciclo de
      -- vida completo del lead y hacer análisis de time-to-stage.
      CREATE TABLE IF NOT EXISTS analytics.lead_history (
        id            BIGSERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL,
        event         TEXT    NOT NULL,
        payload       JSONB   NOT NULL DEFAULT '{}'::jsonb,
        author_id     INTEGER,
        author_email  TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_lead_history_user
        ON analytics.lead_history (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lead_history_event
        ON analytics.lead_history (event, created_at DESC);

      -- Sprint 9: motor de reglas automáticas + settings globales
      CREATE TABLE IF NOT EXISTS analytics.auto_rules (
        id              BIGSERIAL PRIMARY KEY,
        slug            TEXT UNIQUE NOT NULL,
        name            TEXT NOT NULL,
        description     TEXT,
        kind            TEXT NOT NULL DEFAULT 'add_tag', -- add_tag | (reservado para futuras acciones)
        tag             TEXT,
        condition_sql   TEXT NOT NULL,  -- debe devolver columna user_id
        enabled         BOOLEAN NOT NULL DEFAULT false,
        last_run_at     TIMESTAMPTZ,
        last_affected   INTEGER NOT NULL DEFAULT 0,
        total_affected  INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS analytics.settings (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Sprint 10: webhooks salientes para integrar con Make/Zapier/n8n/Slack
      CREATE TABLE IF NOT EXISTS analytics.webhooks (
        id              BIGSERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        url             TEXT NOT NULL,
        events          TEXT[] NOT NULL DEFAULT ARRAY['new_hot_lead','lead_became_client','rule_applied']::text[],
        secret          TEXT,
        active          BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_fired_at   TIMESTAMPTZ,
        last_status     INTEGER,
        failure_count   INTEGER NOT NULL DEFAULT 0
      );

      -- Tabla de entregas (cola + resultado) para cada webhook fire
      CREATE TABLE IF NOT EXISTS analytics.webhook_deliveries (
        id           BIGSERIAL PRIMARY KEY,
        webhook_id   BIGINT NOT NULL,
        event        TEXT NOT NULL,
        payload      JSONB NOT NULL,
        status       INTEGER,
        error        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_wh
        ON analytics.webhook_deliveries (webhook_id, created_at DESC);
    `);

    // Seeds de reglas preset (upsert idempotente por slug)
    await strapi.db.connection.raw(`
      INSERT INTO analytics.auto_rules (slug, name, description, kind, tag, condition_sql, enabled)
      VALUES
        (
          'power_reader',
          'Power reader',
          'Usuarios que abrieron 10+ sentencias distintas en los últimos 14 días. Señal fuerte de uso profesional.',
          'add_tag', 'power_reader',
          $SQL$
          SELECT DISTINCT user_id FROM analytics.case_interactions
           WHERE user_id IS NOT NULL
             AND last_open_at >= now() - interval '14 days'
           GROUP BY user_id
          HAVING COUNT(DISTINCT case_id) >= 10
          $SQL$,
          false
        ),
        (
          'retencion_urgente',
          'Retención urgente',
          'Lectores valiosos (engagement ≥ 50) con 21+ días sin venir. Candidatos a reactivación manual.',
          'add_tag', 'retencion_urgente',
          $SQL$
          SELECT user_id FROM analytics.user_profiles_computed
           WHERE engagement_score >= 50 AND days_since_last_seen >= 21
          $SQL$,
          false
        ),
        (
          'prioridad_alta',
          'Prioridad alta',
          'Hot leads con score ≥ 80 que aún no tienen ningún tag CRM. Requieren atención inmediata.',
          'add_tag', 'prioridad_alta',
          $SQL$
          SELECT upc.user_id FROM analytics.user_profiles_computed upc
           WHERE upc.lead_score >= 80
             AND NOT EXISTS (
               SELECT 1 FROM analytics.user_tags ut WHERE ut.user_id = upc.user_id
             )
          $SQL$,
          false
        ),
        (
          'imprime_mucho',
          'Imprime/descarga mucho',
          'Usuarios con 5+ impresiones o descargas en 30d. Usan el contenido para trabajo real.',
          'add_tag', 'imprime_mucho',
          $SQL$
          SELECT user_id FROM analytics.events
           WHERE event_name IN ('case_print','case_download')
             AND user_id IS NOT NULL
             AND event_timestamp >= now() - interval '30 days'
           GROUP BY user_id
          HAVING COUNT(*) >= 5
          $SQL$,
          false
        )
      ON CONFLICT (slug) DO NOTHING;
    `);

    // Seeds de settings iniciales (defaults)
    await strapi.db.connection.raw(`
      INSERT INTO analytics.settings (key, value) VALUES
        ('hot_lead_threshold', '60'::jsonb),
        ('risk_days', '14'::jsonb),
        ('new_lead_window_days', '7'::jsonb),
        ('deep_read_scroll_pct', '75'::jsonb)
      ON CONFLICT (key) DO NOTHING;
    `);
    strapi.log.info(
      '[analytics-ingest] CRM tables ensured (user_notes, user_tags, user_assignments, admin_seen)'
    );
  } catch (e) {
    strapi.log.warn('[analytics-ingest] could not ensure CRM tables', e);
  }
};

/**
 * Verify the analytics schema exists. If it doesn't, log a warning but don't
 * fail — Fase 0 instalará el schema manualmente vía SQL.
 */
const verifySchema = async (strapi: Core.Strapi) => {
  try {
    const result = await strapi.db.connection.raw(`
      SELECT COUNT(*)::int AS n
        FROM information_schema.schemata
       WHERE schema_name = 'analytics'
    `);
    const n = result.rows?.[0]?.n ?? result?.[0]?.n ?? 0;
    if (n === 0) {
      strapi.log.warn(
        '[analytics-ingest] schema "analytics" not found. ' +
        'Ejecutar 01_analytics_schema.sql antes de habilitar la ingesta.'
      );
    } else {
      strapi.log.info('[analytics-ingest] schema analytics OK');
    }
  } catch (e) {
    strapi.log.warn('[analytics-ingest] could not verify analytics schema', e);
  }
};

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  // El plugin siempre se carga — sus rutas siempre están registradas.
  // ANALYTICS_INGEST_ENABLED solo controla si se ejecutan los grants de
  // permisos y la verificación del schema. El controller ingest bloquea
  // la ingesta real si la flag está en false (ver controllers/ingest.ts).
  strapi.log.info('[analytics-ingest] plugin bootstrapped');
  try {
    await ensurePermissions(strapi);
    await verifySchema(strapi);
    await ensureCrmTables(strapi);
  } catch (e) {
    strapi.log.error('[analytics-ingest] bootstrap error:', e);
  }
};

export default bootstrap;
