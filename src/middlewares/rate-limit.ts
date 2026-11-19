/**
 * Rate Limiting Middleware para Strapi
 * Protege la API contra abuso limitando requests por IP.
 *
 * Configuración:
 * - API/GraphQL: 60 requests por minuto por IP
 * - Auth (login): 10 requests por minuto por IP (previene fuerza bruta)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Limpieza periódica cada 2 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 120_000);

export default (config: { maxRequests?: number; windowMs?: number } = {}) => {
  const maxRequests = config.maxRequests || 60;
  const windowMs = config.windowMs || 60_000; // 1 minuto

  return async (ctx: any, next: () => Promise<void>) => {
    const ip = ctx.request.ip || ctx.request.headers['x-forwarded-for'] || 'unknown';
    const path = ctx.request.path;

    // Rate limit más estricto para login
    const isAuth = path.includes('/api/auth/');
    const limit = isAuth ? 10 : maxRequests;
    const key = `${ip}:${isAuth ? 'auth' : 'api'}`;

    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Headers informativos
    ctx.set('X-RateLimit-Limit', String(limit));
    ctx.set('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    ctx.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
      ctx.status = 429;
      ctx.body = {
        error: {
          status: 429,
          name: 'TooManyRequests',
          message: 'Demasiadas solicitudes. Intente nuevamente en un momento.',
        },
      };
      return;
    }

    await next();
  };
};
