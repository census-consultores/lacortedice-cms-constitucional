import type { Core } from '@strapi/strapi';

/**
 * Service de scoring. Invocable por cron:
 *
 *   config/cron.ts
 *   refreshScores: {
 *     task: ({ strapi }) => strapi
 *       .plugin('analytics-ingest').service('scoring').refreshActive(),
 *     options: { rule: '*\/15 * * * *' }     // cada 15 min
 *   },
 *   refreshKeywords: {
 *     task: ({ strapi }) => strapi
 *       .plugin('analytics-ingest').service('scoring').refreshKeywords(),
 *     options: { rule: '0 * * * *' }          // cada hora
 *   },
 *   ensurePartitions: {
 *     task: ({ strapi }) => strapi.db.connection
 *       .raw('SELECT analytics.ensure_next_events_partition()'),
 *     options: { rule: '0 3 1 * *' }          // 03:00 del día 1 de cada mes
 *   }
 */
const scoring = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Refresca el perfil (engagement + lead) de usuarios activos en las últimas 24h.
   */
  async refreshActive() {
    try {
      await strapi.db.connection.raw(`
        DO $$
        DECLARE u RECORD;
        BEGIN
          FOR u IN
            SELECT DISTINCT user_id FROM analytics.sessions
             WHERE user_id IS NOT NULL
               AND started_at >= now() - interval '24 hours'
          LOOP
            PERFORM analytics.refresh_user_profile(u.user_id);
          END LOOP;
        END$$;
      `);
      strapi.log.info('[analytics-ingest.scoring] refreshActive done');
    } catch (e) {
      strapi.log.error('[analytics-ingest.scoring.refreshActive]', e);
    }
  },

  /**
   * Refresca agregados de keywords (tendencias, zero-result rate, etc.)
   */
  async refreshKeywords() {
    try {
      await strapi.db.connection.raw('SELECT analytics.refresh_keyword_stats()');
      strapi.log.info('[analytics-ingest.scoring] refreshKeywords done');
    } catch (e) {
      strapi.log.error('[analytics-ingest.scoring.refreshKeywords]', e);
    }
  },

  /**
   * Fuerza recálculo para un único usuario.
   */
  async recomputeUser(userId: string) {
    await strapi.db.connection.raw(
      'SELECT analytics.refresh_user_profile(?::uuid)',
      [userId]
    );
  },

  /**
   * Sprint 9: ejecuta todas las auto_rules habilitadas. Cada regla:
   *   1. Evalúa su condition_sql (debe devolver user_id).
   *   2. Para cada user_id, aplica la acción (por ahora solo add_tag).
   *   3. Inserta ON CONFLICT DO NOTHING en user_tags (idempotente).
   *   4. Loguea cada nueva aplicación en analytics.lead_history con
   *      author_email = 'Auto-rule: <slug>'.
   *   5. Actualiza contador de affected y last_run_at en auto_rules.
   */
  async runAutoRules() {
    try {
      const rules = (
        await strapi.db.connection.raw(
          `SELECT id, slug, name, kind, tag, condition_sql
             FROM analytics.auto_rules WHERE enabled = true ORDER BY id`
        )
      ).rows ?? [];

      for (const rule of rules) {
        if (rule.kind !== 'add_tag' || !rule.tag) continue;
        try {
          const res = await strapi.db.connection.raw(rule.condition_sql);
          const userIds = (res.rows ?? []).map((r: any) => Number(r.user_id)).filter(Number.isFinite);

          if (userIds.length === 0) {
            await strapi.db.connection.raw(
              `UPDATE analytics.auto_rules SET last_affected = 0, last_run_at = now() WHERE id = ?`,
              [rule.id]
            );
            continue;
          }

          // Insertamos tags. ON CONFLICT DO NOTHING nos deja saber cuáles
          // son realmente nuevos usando RETURNING.
          const insertRes = await strapi.db.connection.raw(
            `
            INSERT INTO analytics.user_tags (user_id, tag, author_id)
            SELECT uid, ?, NULL
              FROM unnest(ARRAY[${userIds.join(',')}]::int[]) AS uid
            ON CONFLICT (user_id, tag) DO NOTHING
            RETURNING user_id
            `,
            [rule.tag]
          );
          const added = (insertRes.rows ?? []).length;

          // Log de cada aplicación nueva en lead_history + dispara webhooks
          if (added > 0) {
            const addedIds = (insertRes.rows ?? [])
              .map((r: any) => Number(r.user_id))
              .filter(Number.isFinite);
            for (const uid of addedIds) {
              await strapi.db.connection
                .raw(
                  `INSERT INTO analytics.lead_history (user_id, event, payload, author_email)
                   VALUES (?, 'tag_added', ?::jsonb, ?)`,
                  [
                    uid,
                    JSON.stringify({ tag: rule.tag, auto: true, rule: rule.slug }),
                    `Auto-rule: ${rule.slug}`,
                  ]
                )
                .catch(() => { });
            }
            // Sprint 10: webhook rule_applied
            try {
              await strapi
                .plugin('analytics-ingest')
                .service('webhooks')
                .fire('rule_applied', {
                  rule: { id: rule.id, slug: rule.slug, tag: rule.tag },
                  user_ids: addedIds,
                  added,
                });
              // Si el tag es "cliente", también dispara lead_became_client
              if (rule.tag === 'cliente') {
                for (const uid of addedIds) {
                  await strapi
                    .plugin('analytics-ingest')
                    .service('webhooks')
                    .fire('lead_became_client', { user_id: uid, source: 'auto_rule', rule: rule.slug });
                }
              }
              // prioridad_alta (hot lead sin tags) dispara new_hot_lead
              if (rule.slug === 'prioridad_alta') {
                for (const uid of addedIds) {
                  await strapi
                    .plugin('analytics-ingest')
                    .service('webhooks')
                    .fire('new_hot_lead', { user_id: uid, source: 'auto_rule' });
                }
              }
            } catch { /* no bloquear flujo si webhooks fallan */ }
          }

          await strapi.db.connection.raw(
            `UPDATE analytics.auto_rules
               SET last_affected = ?, total_affected = total_affected + ?, last_run_at = now()
             WHERE id = ?`,
            [added, added, rule.id]
          );
          strapi.log.info(
            `[analytics-ingest.runAutoRules] ${rule.slug}: ${added} nuevos, ${userIds.length} match`
          );
        } catch (err: any) {
          strapi.log.error(`[analytics-ingest.runAutoRules.${rule.slug}]`, err?.message ?? err);
        }
      }
    } catch (e) {
      strapi.log.error('[analytics-ingest.runAutoRules]', e);
    }
  },
});

export default scoring;
