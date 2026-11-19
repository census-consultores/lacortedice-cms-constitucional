/**
 * Router custom para Falla Tú · Jugada.
 *
 * NO usamos el `createCoreRouter` default porque ese expone CRUD genérico
 * (find, findOne, create, update, delete) que sería un agujero — cualquier
 * usuario podría leer jugadas de otros o crear con user_id arbitrario.
 *
 * En su lugar declaramos solo los 3 endpoints que necesitamos, todos
 * protegidos por auth (cualquier user autenticado puede llamar a sus
 * propios endpoints). El controller se encarga de scoped-al-user.
 */

export default {
	routes: [
		{
			method: 'POST',
			path: '/falla-tu-jugadas/mia',
			handler: 'falla-tu-jugada.crearMia',
			config: {
				policies: []
			}
		},
		{
			method: 'GET',
			path: '/falla-tu-jugadas/mis-stats',
			handler: 'falla-tu-jugada.misStats',
			config: {
				policies: []
			}
		},
		{
			method: 'GET',
			path: '/falla-tu-jugadas/leaderboard',
			handler: 'falla-tu-jugada.leaderboard',
			config: {
				policies: []
			}
		}
	]
};
