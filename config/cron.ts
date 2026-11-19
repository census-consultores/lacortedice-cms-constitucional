/**
 * Cron tasks del CMS.
 *
 * Se invoca sólo si `server.cron.enabled=true` (controlado por CRON_ENABLED).
 * Mantén esta config en el mismo formato que espera Strapi 5: un objeto cuyas
 * keys son identificadores lógicos de tarea y cuyos valores llevan `task` y
 * `options.rule` (cron expression).
 *
 * Tareas actuales:
 *   - refreshScores    : refresca engagement/lead score de usuarios activos
 *                        (últimas 24h). Cada 15 min.
 *   - refreshKeywords  : refresca agregados de keyword_stats y tendencias.
 *                        Cada hora en el minuto 0.
 *   - ensurePartitions : crea la partición mensual siguiente de
 *                        analytics.events antes de que expire el rango. 03:00
 *                        del día 1 de cada mes.
 *   - correoMasivo     : manda la siguiente tanda de las campañas encendidas.
 *                        Cada 15 min.
 */
import type { Core } from '@strapi/strapi';
import { digestSentencias, recordatorioJuego } from '../src/utils/push-emisores';

export default {
  appLaunchSequence: {task: async ({strapi}) => {await strapi.plugin('admin-panel').service('launchSequence').tick();}, options: {rule: '*/15 * * * *'}},
  /**
   * Correo masivo a cuentagotas.
   *
   * Cada cuarto de hora mira si hay alguna campaña encendida y manda su
   * siguiente tanda. No hay nada que configurar acá: el ritmo y el
   * interruptor viven en el content-type `campana-correo` y se manejan desde
   * el panel.
   *
   * Por qué a cuentagotas y no de una vez está explicado a fondo en
   * services/envio-masivo.ts. En corto: Titan tiene un tope de envíos por
   * hora, pasarse no retrasa los correos sino que los rebota, y el buzón que
   * se quema es el mismo que manda las claves de la app.
   *
   * OJO: esto sólo corre si CRON_ENABLED=true en el servidor. Si la campaña
   * se enciende y no sale nada, eso es lo primero que hay que mirar.
   */
  correoMasivo: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      try {
        await strapi.plugin('admin-panel').service('envioMasivo').tanda();
      } catch (e) {
        strapi.log.error('[cron.correoMasivo]', e);
      }
    },
    options: { rule: '*/15 * * * *' },
  },

  // Push: digest diario de sentencias nuevas (08:00 de Guayaquil = 13:00 UTC).
  pushDigestSentencias: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      try {
        await digestSentencias(strapi);
      } catch (e) {
        strapi.log.error('[cron.pushDigestSentencias]', e);
      }
    },
    options: { rule: '0 13 * * *' },
  },

  // Push: recordatorio del juego diario (18:30 de Guayaquil = 23:30 UTC).
  pushRecordatorioJuego: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      try {
        await recordatorioJuego(strapi);
      } catch (e) {
        strapi.log.error('[cron.pushRecordatorioJuego]', e);
      }
    },
    options: { rule: '30 23 * * *' },
  },

  refreshScores: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      try {
        const svc = strapi.plugin('analytics-ingest').service('scoring');
        await svc.refreshActive();
        // Sprint 9: después de refrescar perfiles corremos las auto_rules.
        // Así, cuando un usuario acaba de cruzar el umbral, su tag auto
        // aparece en ≤15 min sin intervención.
        await svc.runAutoRules();
      } catch (e) {
        strapi.log.error('[cron.refreshScores]', e);
      }
    },
    options: { rule: '*/15 * * * *' },
  },

  refreshKeywords: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      try {
        await strapi
          .plugin('analytics-ingest')
          .service('scoring')
          .refreshKeywords();
      } catch (e) {
        strapi.log.error('[cron.refreshKeywords]', e);
      }
    },
    options: { rule: '0 * * * *' },
  },

  ensurePartitions: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      try {
        await strapi.db.connection.raw(
          'SELECT analytics.ensure_next_events_partition()'
        );
        strapi.log.info('[cron.ensurePartitions] partition ensured');
      } catch (e) {
        strapi.log.error('[cron.ensurePartitions]', e);
      }
    },
    options: { rule: '0 3 1 * *' },
  },
};
