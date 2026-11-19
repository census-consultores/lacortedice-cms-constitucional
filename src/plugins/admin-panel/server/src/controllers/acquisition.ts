import { acquisitionReport, recordClick, recordInstall } from '../services/acquisition';
const rate = new Map<string, { count: number; until: number }>();
export default ({ strapi }: { strapi: any }) => ({
  async click(ctx: any) {
    // Public endpoint accepts only opaque tokens, never caller-supplied recipient identities.
    const now = Date.now(),
      ip = ctx.request.ip ?? 'unknown';
    for (const [key, value] of rate) if (value.until < now) rate.delete(key);
    const bucket = rate.get(ip) ?? { count: 0, until: now + 60000 };
    if (rate.size >= 10000 || bucket.count >= 600) {
      ctx.status = 429;
      return;
    }
    bucket.count++;
    rate.set(ip, bucket);
    try {
      ctx.body = await recordClick(strapi.db.connection, ctx.request.body ?? {});
    } catch (e: any) {
      const bad = /invalid|expired or unknown/.test(e.message ?? '');
      ctx.status = bad ? 400 : 503;
      ctx.body = { recorded: false };
      if (!bad) strapi.log.warn('[acquisition] click persistence unavailable');
    }
  },
  async install(ctx: any) {
    try {
      ctx.body = await recordInstall(strapi.db.connection, ctx.request.body ?? {});
    } catch (e: any) {
      ctx.status = /invalid/.test(e.message ?? '') ? 400 : 503;
      ctx.body = { recorded: false };
    }
  },
  async report(ctx: any) {
    const days = Number(ctx.query.days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      ctx.status = 400;
      ctx.body = { error: 'Periodo inválido' };
      return;
    }
    try {
      ctx.body = await acquisitionReport(strapi.db.connection, days);
    } catch {
      ctx.status = 503;
      ctx.body = { error: 'No se pudo consultar el seguimiento' };
    }
  },
});
