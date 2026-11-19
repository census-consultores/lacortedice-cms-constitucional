/** Router custom de la Tribuna · comentarios (ver tribuna-tema.ts). */
export default {
	routes: [
		{
			method: 'POST',
			path: '/tribuna/comentarios',
			handler: 'tribuna-comentario.crear',
			config: { policies: [] }
		}
	]
};
