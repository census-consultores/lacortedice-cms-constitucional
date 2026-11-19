/**
 * favorito routes
 *
 * Sólo endpoints custom; el CRUD por defecto del factory NO se expone
 * para no permitir GET /api/favoritos sin autorización (listaría toda
 * la tabla con info de qué user marcó qué).
 *
 * Auth model:
 * - /me y /toggle: requieren JWT. NO usamos `auth: false` porque Strapi 5
 *   con esa flag NO parsea el Authorization header → `ctx.state.user`
 *   queda undefined incluso con token válido. La permission para el rol
 *   "authenticated" se concede en src/index.ts (bootstrap).
 * - /count: público (auth: false), cualquiera puede ver la popularidad.
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/favoritos/me',
      handler: 'favorito.mine',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/favoritos/toggle',
      handler: 'favorito.toggle',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/favoritos/count',
      handler: 'favorito.count',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
