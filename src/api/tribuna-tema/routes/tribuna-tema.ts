/**
 * Router custom de la Tribuna · temas. Sin CRUD genérico: el core router
 * dejaría leer/editar temas ajenos. Todo scoped al usuario en el controller.
 *
 * Las actions se conceden al rol `authenticated` en src/index.ts — sin eso
 * Strapi responde 403 mudo aunque el JWT sea válido.
 */
export default {
	routes: [
		{
			method: 'GET',
			path: '/tribuna/temas',
			handler: 'tribuna-tema.listar',
			config: { policies: [] }
		},
		{
			method: 'POST',
			path: '/tribuna/temas',
			handler: 'tribuna-tema.crear',
			config: { policies: [] }
		},
		{
			method: 'GET',
			path: '/tribuna/temas/:documentId',
			handler: 'tribuna-tema.detalle',
			config: { policies: [] }
		},
		{
			// Silenciar/des-silenciar al autor de una publicación (Guideline 1.2).
			method: 'POST',
			path: '/tribuna/silenciar',
			handler: 'tribuna-tema.silenciar',
			config: { policies: [] }
		},
		{
			// A quién tengo oculto (para poder revertirlo desde Mi cuenta).
			method: 'GET',
			path: '/tribuna/silenciados',
			handler: 'tribuna-tema.silenciados',
			config: { policies: [] }
		},
		{
			// Volver a mostrar a alguien que oculté.
			method: 'POST',
			path: '/tribuna/mostrar',
			handler: 'tribuna-tema.mostrar',
			config: { policies: [] }
		}
	]
};
