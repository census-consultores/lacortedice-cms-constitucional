import type { Core } from '@strapi/strapi';

const r = (res: any) => res?.rows ?? res ?? [];

const profile = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getUser360(userId: string | number) {
    const conn = strapi.db.connection;

    // El caller puede pasarnos un `id` numérico (legacy: Strapi 4 / callers
    // internos) o un `documentId` alfanumérico (Strapi 5: URLs públicas).
    // Las tablas de analytics usan `user_id` integer, así que resolvemos
    // documentId → id con un lookup. Si ya es número, no hace falta.
    let uid: number;
    if (typeof userId === 'number' || /^\d+$/.test(String(userId))) {
      uid = Number(userId);
    } else {
      const userRow = r(await conn.raw(
        `SELECT id FROM public.up_users WHERE document_id = ? LIMIT 1`,
        [String(userId)]
      ))[0];
      if (!userRow) return null;
      uid = userRow.id;
    }

    // Hacemos LEFT JOIN al revés: partimos de up_users para tener al menos
    // la identidad básica aunque el cron de scoring todavía no haya
    // computado un perfil analytics para este user (nuevo, sin actividad, etc).
    const profileRow = r(await conn.raw(
      `SELECT u.id AS user_id, u.email, u.username, u.profession, u.city, u.country,
              upc.lead_score, upc.engagement_score, upc.churn_risk,
              upc.sessions_total, upc.sessions_last_7d, upc.sessions_last_30d,
              upc.searches_total, upc.searches_last_30d,
              upc.cases_viewed_total, upc.unique_cases_viewed,
              upc.prints_total, upc.downloads_total, upc.shares_total,
              upc.bookmarks_total, upc.zero_result_count,
              upc.first_seen_at, upc.last_seen_at, upc.days_since_last_seen,
              upc.top_keywords, upc.top_materias, upc.inferred_tags,
              upc.lead_breakdown, upc.engagement_breakdown,
              upc.segment_primary, upc.updated_at AS profile_updated_at
         FROM public.up_users u
         LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = u.id
        WHERE u.id = ?`,
      [uid]
    ))[0];

    // El user no existe en up_users → 404 vía null (caller maneja).
    if (!profileRow) return null;

    // El user existe pero el cron aún no calculó su perfil analytics.
    // Devolvemos `has_analytics: false` para que la UI muestre un estado
    // claro ("Este usuario aún no tiene actividad registrada") en vez de
    // un 204 silencioso que rompe el frontend.
    const hasAnalytics = profileRow.lead_score !== null && profileRow.lead_score !== undefined;

    const searches = r(await conn.raw(
      `SELECT search_id, query_raw, filters, results_count, zero_result, created_at
         FROM analytics.searches
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [uid]
    ));

    const cases = r(await conn.raw(
      `SELECT case_id, first_open_at, last_open_at, opens_count,
              total_dwell_sec, max_scroll_pct, print_count, download_count,
              share_count, bookmark
         FROM analytics.case_interactions
        WHERE user_id = ?
        ORDER BY last_open_at DESC
        LIMIT 100`,
      [uid]
    ));

    const activities = r(await conn.raw(
      `SELECT * FROM analytics.lead_activities
        WHERE user_id = ?
        ORDER BY happened_at DESC`,
      [uid]
    ));

    const timeline = r(await conn.raw(
      `SELECT event_id, event_name, event_timestamp, payload
         FROM analytics.events
        WHERE user_id = ?
        ORDER BY event_timestamp DESC
        LIMIT 200`,
      [uid]
    ));

    return {
      profile: profileRow,
      has_analytics: hasAnalytics,
      searches,
      cases,
      activities,
      timeline,
    };
  },

  async getCaseDetail(caseId: string) {
    const conn = strapi.db.connection;

    const metrics = r(await conn.raw(
      `SELECT * FROM analytics.content_metrics WHERE case_id = ?`,
      [caseId]
    ))[0];

    // Enriquecer con juicio/actor de public.causas (mismo patrón que
    // topCases en el controller admin). Si el caso no existe en causas,
    // caso fue reseeded o es un case_id externo, dejamos los campos en null.
    let caseInfo: { juicio: string | null; actor: string | null } | null = null;
    try {
      const causaRow = r(await conn.raw(
        `SELECT juicio, actor
           FROM public.causas
          WHERE document_id = ?
          ORDER BY id DESC
          LIMIT 1`,
        [String(caseId)]
      ))[0];
      if (causaRow) caseInfo = { juicio: causaRow.juicio ?? null, actor: causaRow.actor ?? null };
    } catch (e: any) {
      strapi.log.warn('[getCaseDetail] case enrichment skipped: ' + (e?.message ?? e));
    }

    // Primero intentamos leer de la rollup table case_interactions (rápida
    // y con métricas de dwell/scroll). Si viene vacía — porque la mayoría
    // de aperturas fueron anónimas o el rollup aún no corre — hacemos
    // fallback contra analytics.events para no dejar la ficha en blanco
    // cuando el dashboard sí ve aperturas.
    let readers = r(await conn.raw(
      `SELECT ci.user_id, u.email, u.username, u.profession, u.city,
              ci.opens_count, ci.total_dwell_sec, ci.max_scroll_pct,
              ci.print_count, ci.download_count, ci.share_count,
              upc.lead_score
         FROM analytics.case_interactions ci
         LEFT JOIN public.up_users u ON u.id = ci.user_id
         LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = ci.user_id
        WHERE ci.case_id = ?
        ORDER BY ci.opens_count DESC
        LIMIT 100`,
      [caseId]
    ));

    if (!readers || readers.length === 0) {
      try {
        readers = r(await conn.raw(
          `WITH ev AS (
              SELECT user_id,
                     COUNT(*) FILTER (WHERE event_name = 'case_open')     AS opens_count,
                     COUNT(*) FILTER (WHERE event_name = 'case_print')    AS print_count,
                     COUNT(*) FILTER (WHERE event_name = 'case_download') AS download_count,
                     COUNT(*) FILTER (WHERE event_name = 'case_share')    AS share_count
                FROM analytics.events
               WHERE case_id = ?
                 AND user_id IS NOT NULL
               GROUP BY user_id
            )
            SELECT ev.user_id,
                   u.email, u.username, u.profession, u.city,
                   ev.opens_count,
                   0::int                    AS total_dwell_sec,
                   0::numeric(5,2)           AS max_scroll_pct,
                   ev.print_count,
                   ev.download_count,
                   ev.share_count,
                   upc.lead_score
              FROM ev
              LEFT JOIN public.up_users u ON u.id = ev.user_id
              LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = ev.user_id
             ORDER BY ev.opens_count DESC
             LIMIT 100`,
          [caseId]
        ));
      } catch (e: any) {
        strapi.log.warn('[getCaseDetail] events fallback failed: ' + (e?.message ?? e));
      }
    }

    return { metrics, readers, caseInfo };
  },
});

export default profile;
