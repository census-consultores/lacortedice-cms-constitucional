import type { Core } from '@strapi/strapi';

// Rate-limit local simple: mapa IP -> array de timestamps recientes.
// Para producción seria, usar Redis. Aquí va un mapa in-memory por proceso.
const rateMap = new Map<string, number[]>();

const ingest = {
  async ingest(ctx: any) {
    try {
      const enabled = (process.env.ANALYTICS_INGEST_ENABLED ?? 'false') === 'true';
      if (!enabled) {
        ctx.status = 503;
        ctx.body = { error: 'analytics-ingest disabled' };
        return;
      }

      const body = ctx.request.body || {};
      const events: any[] = Array.isArray(body.events) ? body.events : [];
      if (!events.length) {
        ctx.status = 204;
        return;
      }

      const strapi = ctx.state?.strapi ?? (global as any).strapi;
      // En Strapi 5 la config del plugin se lee por clave directa: .config('maxBatchSize').
      // El objeto 'default' exportado es solo la fuente de defaults; el getter
      // ya retorna el valor específico. Tomamos defaults robustos por si acaso.
      const maxBatchSize =
        Number(strapi.plugin('analytics-ingest').config('maxBatchSize')) || 50;
      const rateLimitPerMinute =
        Number(strapi.plugin('analytics-ingest').config('rateLimitPerMinute')) || 600;

      if (events.length > maxBatchSize) {
        ctx.status = 413;
        ctx.body = { error: 'Batch too large', maxBatchSize };
        return;
      }

      // Rate limiting
      const ip = ctx.request.ip || 'unknown';
      const now = Date.now();
      const bucket = (rateMap.get(ip) || []).filter(t => now - t < 60_000);
      if (bucket.length >= rateLimitPerMinute) {
        ctx.status = 429;
        ctx.body = { error: 'Rate limit exceeded' };
        return;
      }
      bucket.push(now);
      rateMap.set(ip, bucket);

      // Persistir
      const inserted = await strapi
        .plugin('analytics-ingest')
        .service('ingest')
        .persistBatch(events, { ip, received_at: new Date() });

      ctx.status = 202;
      ctx.body = { accepted: inserted };
    } catch (err) {
      const strapi = ctx.state?.strapi ?? (global as any).strapi;
      strapi?.log?.error?.('[analytics-ingest.ingest] error', err);
      ctx.status = 500;
      ctx.body = { error: 'Internal error' };
    }
  },
};

export default ingest;
