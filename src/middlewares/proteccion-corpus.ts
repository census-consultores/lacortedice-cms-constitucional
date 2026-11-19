/**
 * Candado del corpus editorial (hallazgo S-1 de la auditoría).
 *
 * Sin este middleware, /graphql y /api/causas|casaciones son legibles por
 * cualquiera sin cuenta: todo el valor editorial (resúmenes, antecedentes,
 * criterios de sala) queda scrapeable. El único consumidor legítimo sin
 * token de usuario es el BFF de la webapp (páginas anónimas), así que la
 * regla es: pasa quien traiga un Bearer (users-permissions lo valida después)
 * o la clave interna compartida con el BFF.
 *
 * SOFT-LAUNCH: si `CORPUS_INTERNAL_KEY` no está definida en el entorno, el
 * middleware solo OBSERVA (loggea accesos anónimos) y no bloquea nada. Así el
 * deploy es seguro: primero sale el código, después se configura la misma
 * clave en Render (CMS y webapp) y el candado se cierra sin tocar código.
 */

const RUTAS_PROTEGIDAS = [/^\/graphql\/?$/, /^\/api\/causas(\/|$|\?)/, /^\/api\/casaciones(\/|$|\?)/];

export default () => {
  return async (ctx: any, next: () => Promise<void>) => {
    const proteger = RUTAS_PROTEGIDAS.some((re) => re.test(ctx.path));
    if (!proteger) return next();

    const clave = process.env.CORPUS_INTERNAL_KEY || '';
    const traeBearer = String(ctx.request.headers['authorization'] ?? '').startsWith('Bearer ');
    const traeClave = clave !== '' && ctx.request.headers['x-lcd-interna'] === clave;

    if (traeBearer || traeClave) return next();

    if (!clave) {
      // Modo observación: aún sin clave configurada, solo se registra.
      strapi.log.info(`[corpus] acceso anónimo (observación) ${ctx.method} ${ctx.path} ip=${ctx.ip}`);
      return next();
    }

    ctx.status = 401;
    ctx.body = { error: { status: 401, name: 'UnauthorizedError', message: 'Autenticación requerida' } };
  };
};
