import type { Core } from '@strapi/strapi';

/**
 * Service de persistencia e inserción derivada.
 *
 * Recibe un batch de eventos, los escribe en analytics.events (append-only,
 * idempotente por event_id+event_timestamp) y luego deriva filas en:
 *   - analytics.sessions (session_start / session_end)
 *   - analytics.searches (search_executed)
 *   - analytics.case_interactions (case_open, case_print, case_download, ...)
 */

type RawEvent = {
  event_id: string;
  event_name: string;
  event_timestamp: string;
  user_id?: string | null;
  anonymous_id?: string;
  session_id?: string;
  device_context?: Record<string, unknown>;
  geo_context?: Record<string, unknown>;
  acquisition_context?: Record<string, unknown>;
  payload?: Record<string, any>;
  schema_version?: number;
  environment?: string;
};

const ingest = ({ strapi }: { strapi: Core.Strapi }) => ({
  async persistBatch(events: RawEvent[], meta: { ip?: string; received_at: Date }) {
    const conn = strapi.db.connection;

    const rows = events.map(e => ({
      event_id: e.event_id,
      event_name: e.event_name,
      event_timestamp: new Date(e.event_timestamp),
      event_received_at: meta.received_at,
      user_id: e.user_id || null,
      anonymous_id: e.anonymous_id || null,
      session_id: e.session_id || null,
      device_context: e.device_context || {},
      geo_context: e.geo_context || {},
      acquisition_context: e.acquisition_context || {},
      payload: e.payload || {},
      schema_version: e.schema_version ?? 1,
      environment: e.environment || 'production',
      ingested_from_ip: meta.ip || null,
    }));

    // Insert idempotente (mismo event_id + timestamp se ignora)
    await conn('analytics.events')
      .insert(rows)
      .onConflict(['event_id', 'event_timestamp'])
      .ignore();

    // Derivaciones en tiempo real
    for (const e of events) {
      await handleDerivations(conn, e);
    }

    return rows.length;
  },
});

async function handleDerivations(conn: any, e: RawEvent) {
  switch (e.event_name) {
    case 'session_start':
      await conn('analytics.sessions')
        .insert({
          session_id: e.session_id,
          user_id: e.user_id,
          anonymous_id: e.anonymous_id,
          started_at: e.event_timestamp,
          device_context: e.device_context || {},
          geo_context: e.geo_context || {},
          acquisition_context: e.acquisition_context || {},
        })
        .onConflict('session_id')
        .ignore();
      break;

    case 'session_end':
      await conn.raw(
        `UPDATE analytics.sessions
            SET ended_at = ?,
                duration_sec = GREATEST(0, EXTRACT(EPOCH FROM ?::timestamptz - started_at))::int
          WHERE session_id = ?`,
        [e.event_timestamp, e.event_timestamp, e.session_id]
      );
      break;

    case 'search_executed': {
      const p = e.payload || {};
      await conn('analytics.searches')
        .insert({
          search_id: p.search_id,
          user_id: e.user_id,
          anonymous_id: e.anonymous_id,
          session_id: e.session_id,
          query_raw: p.query_raw,
          query_normalized: p.query_normalized,
          filters: p.filters || {},
          sort: p.sort,
          results_count: p.results_count || 0,
          results_ids: p.results_ids,
          latency_ms: p.latency_ms,
          created_at: e.event_timestamp,
        })
        .onConflict('search_id')
        .ignore();
      break;
    }

    case 'result_click': {
      const p = e.payload || {};
      await conn.raw(
        `UPDATE analytics.searches
            SET time_to_first_click_ms = LEAST(COALESCE(time_to_first_click_ms, ?), ?),
                clicked_result_ids = array_append(COALESCE(clicked_result_ids, '{}'), ?::uuid)
          WHERE search_id = ?`,
        [p.time_to_click_ms, p.time_to_click_ms, p.case_id, p.search_id]
      );
      break;
    }

    case 'case_open':
    case 'case_print':
    case 'case_download':
    case 'case_share':
    case 'case_bookmark':
    case 'case_unbookmark':
    case 'case_highlight':
    case 'case_copy':
      await upsertCaseInteraction(conn, e);
      break;

    case 'case_dwell_active': {
      const p = e.payload || {};
      await conn.raw(
        `UPDATE analytics.case_interactions
            SET total_dwell_sec = total_dwell_sec + ?, updated_at = now()
          WHERE user_id = ? AND case_id = ?`,
        [p.seconds || 0, e.user_id, p.case_id]
      );
      break;
    }

    case 'case_scroll_milestone': {
      const p = e.payload || {};
      await conn.raw(
        `UPDATE analytics.case_interactions
            SET max_scroll_pct = GREATEST(max_scroll_pct, ?), updated_at = now()
          WHERE user_id = ? AND case_id = ?`,
        [p.milestone_pct || 0, e.user_id, p.case_id]
      );
      break;
    }
  }
}

async function upsertCaseInteraction(conn: any, e: RawEvent) {
  const p = e.payload || {};
  const case_id = p.case_id;
  const user_id = e.user_id;
  if (!case_id || !user_id) return;

  const opens_delta   = e.event_name === 'case_open'       ? 1 : 0;
  const prints_delta  = e.event_name === 'case_print'      ? 1 : 0;
  const dl_delta      = e.event_name === 'case_download'   ? 1 : 0;
  const sh_delta      = e.event_name === 'case_share'      ? 1 : 0;
  const hi_delta      = e.event_name === 'case_highlight'  ? 1 : 0;
  const co_delta      = e.event_name === 'case_copy'       ? 1 : 0;
  const bookmark_val  = e.event_name === 'case_bookmark'   ? true
                      : e.event_name === 'case_unbookmark' ? false
                      : null;

  await conn.raw(
    `INSERT INTO analytics.case_interactions
       (user_id, case_id, case_type, first_open_at, last_open_at,
        opens_count, print_count, download_count, share_count,
        highlight_count, copy_count, bookmark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, false))
     ON CONFLICT (user_id, case_id) DO UPDATE
        SET last_open_at    = GREATEST(analytics.case_interactions.last_open_at, EXCLUDED.last_open_at),
            opens_count     = analytics.case_interactions.opens_count     + EXCLUDED.opens_count,
            print_count     = analytics.case_interactions.print_count     + EXCLUDED.print_count,
            download_count  = analytics.case_interactions.download_count  + EXCLUDED.download_count,
            share_count     = analytics.case_interactions.share_count     + EXCLUDED.share_count,
            highlight_count = analytics.case_interactions.highlight_count + EXCLUDED.highlight_count,
            copy_count      = analytics.case_interactions.copy_count      + EXCLUDED.copy_count,
            bookmark        = COALESCE(EXCLUDED.bookmark, analytics.case_interactions.bookmark),
            updated_at      = now()`,
    [
      user_id, case_id, p.case_type || 'causa',
      e.event_timestamp, e.event_timestamp,
      opens_delta, prints_delta, dl_delta, sh_delta, hi_delta, co_delta,
      bookmark_val,
    ]
  );
}

export default ingest;
