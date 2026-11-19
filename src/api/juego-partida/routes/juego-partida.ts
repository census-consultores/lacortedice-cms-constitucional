/**
 * Router custom para Juegos · Partida (motor común de juegos).
 *
 * Igual que `falla-tu-jugada`: NO usamos `createCoreRouter` porque el CRUD
 * genérico dejaría leer partidas ajenas o crear con user arbitrario. Sólo
 * exponemos los endpoints que la webapp (BFF) necesita, todos scoped al
 * usuario autenticado dentro del controller.
 *
 *   POST /juego-partidas/mia          → registra una ronda cerrada
 *   GET  /juego-partidas/mis-stats    → totales, rondas de hoy, racha
 *   GET  /juego-partidas/leaderboard  → ranking por juego y período
 *   GET  /juego-partidas/recientes    → documentIds jugados en los últimos N días
 *
 * Las actions se conceden al rol `authenticated` desde el bootstrap del
 * plugin admin-panel (ensureAuthenticatedPermissions) — sin eso Strapi
 * devuelve 403 mudo aunque el JWT sea válido.
 */

export default {
	routes: [
		{
			method: 'POST',
			path: '/juego-partidas/mia',
			handler: 'juego-partida.crearMia',
			config: { policies: [] }
		},
		{
			method: 'GET',
			path: '/juego-partidas/mis-stats',
			handler: 'juego-partida.misStats',
			config: { policies: [] }
		},
		{
			method: 'GET',
			path: '/juego-partidas/leaderboard',
			handler: 'juego-partida.leaderboard',
			config: { policies: [] }
		},
		{
			method: 'GET',
			path: '/juego-partidas/recientes',
			handler: 'juego-partida.recientes',
			config: { policies: [] }
		}
	]
};
