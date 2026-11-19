/** Router custom de la Tribuna · denuncias y moderación (ver tribuna-tema.ts). */
export default {
	routes: [
		{
			method: 'POST',
			path: '/tribuna/denuncias',
			handler: 'tribuna-denuncia.crear',
			config: { policies: [] }
		},
		{
			method: 'GET',
			path: '/tribuna/moderacion',
			handler: 'tribuna-denuncia.moderacion',
			config: { policies: [] }
		},
		{
			method: 'POST',
			path: '/tribuna/moderar',
			handler: 'tribuna-denuncia.moderar',
			config: { policies: [] }
		}
	]
};
