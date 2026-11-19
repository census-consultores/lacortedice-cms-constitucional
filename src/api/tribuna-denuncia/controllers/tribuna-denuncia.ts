/**
 * Controllers de la Tribuna Tributaria · denuncias y moderación.
 *
 * Cualquier usuario denuncia un tema o comentario; los admins
 * (userRole admin/superadmin) ven la cola y ocultan/restauran contenido.
 * Ocultar un contenido resuelve automáticamente sus denuncias.
 */

import { factories } from '@strapi/strapi';
import { esAdmin, textoLimpio } from '../../tribuna-tema/controllers/tribuna-tema';
import { avisarDenunciaAAdmins, autoOcultarPorDenuncias } from '../../../utils/moderacion-cola';

type Ctx = any;

const UID_POR_TIPO: Record<string, string> = {
	tema: 'api::tribuna-tema.tribuna-tema',
	comentario: 'api::tribuna-comentario.tribuna-comentario'
};

export default factories.createCoreController(
	'api::tribuna-denuncia.tribuna-denuncia',
	({ strapi }) => ({
		/** POST /tribuna/denuncias {tipo, documentId, motivo?} */
		async crear(ctx: Ctx) {
			const user = ctx.state.user;
			if (!user?.id) return ctx.unauthorized();

			const body = ctx.request.body ?? {};
			const tipo = body.tipo === 'comentario' ? 'comentario' : body.tipo === 'tema' ? 'tema' : null;
			const objetivoDocumentId = textoLimpio(body.documentId, 64);
			const motivo = textoLimpio(body.motivo, 300);
			if (!tipo || !objetivoDocumentId) return ctx.badRequest('Denuncia inválida');

			const objetivo = await strapi.db
				.query(UID_POR_TIPO[tipo])
				.findOne({ where: { documentId: objetivoDocumentId }, select: ['id'] });
			if (!objetivo) return ctx.notFound('Contenido no encontrado');

			// Una denuncia pendiente por usuario y contenido: reintentos no duplican.
			const existente = await strapi.db.query('api::tribuna-denuncia.tribuna-denuncia').findOne({
				where: { user: { id: user.id }, tipo, objetivoDocumentId, estado: 'pendiente' },
				select: ['id']
			});
			if (!existente) {
				await strapi.db.query('api::tribuna-denuncia.tribuna-denuncia').create({
					data: { user: user.id, tipo, objetivoDocumentId, motivo, estado: 'pendiente' }
				});
				// Apple 1.2 exige actuar sobre el contenido denunciado, y hacerlo
				// pronto. Dos cosas, en segundo plano (una denuncia no puede
				// fallar porque el aviso falle):
				//   · se oculta solo al acumular denuncias de usuarios distintos;
				//   · se avisa a los administradores para que lo revisen.
				void autoOcultarPorDenuncias(strapi, tipo, objetivoDocumentId);
				void avisarDenunciaAAdmins(strapi, tipo, objetivoDocumentId, motivo);
			}
			ctx.body = { ok: true };
		},

		/** GET /tribuna/moderacion — cola de denuncias pendientes (solo admin). */
		async moderacion(ctx: Ctx) {
			const user = ctx.state.user;
			if (!user?.id) return ctx.unauthorized();
			if (!esAdmin(user)) return ctx.forbidden();

			const denuncias = await strapi.db
				.query('api::tribuna-denuncia.tribuna-denuncia')
				.findMany({
					where: { estado: 'pendiente' },
					orderBy: { createdAt: 'desc' },
					limit: 100,
					populate: { user: { select: ['id', 'username'] } }
				});

			const filas = await Promise.all(
				denuncias.map(async (d: any) => {
					const objetivo = await strapi.db.query(UID_POR_TIPO[d.tipo]).findOne({
						where: { documentId: d.objetivoDocumentId },
						populate: { user: { select: ['username'] } }
					});
					return {
						documentId: d.documentId,
						tipo: d.tipo,
						objetivoDocumentId: d.objetivoDocumentId,
						motivo: d.motivo ?? '',
						denunciante: d.user?.username ?? 'Usuario',
						creadoEn: d.createdAt,
						objetivo: objetivo
							? {
									texto: (objetivo.titulo ?? objetivo.cuerpo ?? '').slice(0, 300),
									autor: objetivo.user?.username ?? 'Usuario',
									estado: objetivo.estado
								}
							: null
					};
				})
			);
			ctx.body = { ok: true, denuncias: filas };
		},

		/** POST /tribuna/moderar {tipo, documentId, accion: ocultar|restaurar|descartar} (solo admin). */
		async moderar(ctx: Ctx) {
			const user = ctx.state.user;
			if (!user?.id) return ctx.unauthorized();
			if (!esAdmin(user)) return ctx.forbidden();

			const body = ctx.request.body ?? {};
			const tipo = body.tipo === 'comentario' ? 'comentario' : body.tipo === 'tema' ? 'tema' : null;
			const documentId = textoLimpio(body.documentId, 64);
			const accion = ['ocultar', 'restaurar', 'descartar'].includes(body.accion)
				? body.accion
				: null;
			if (!tipo || !documentId || !accion) return ctx.badRequest('Acción inválida');

			if (accion !== 'descartar') {
				const objetivo = await strapi.db
					.query(UID_POR_TIPO[tipo])
					.findOne({ where: { documentId }, select: ['id'] });
				if (!objetivo) return ctx.notFound('Contenido no encontrado');
				await strapi.db.query(UID_POR_TIPO[tipo]).update({
					where: { id: objetivo.id },
					data: { estado: accion === 'ocultar' ? 'oculto' : 'visible' }
				});
			}

			// Ocultar o descartar cierra las denuncias pendientes de ese contenido.
			if (accion !== 'restaurar') {
				const pendientes = await strapi.db
					.query('api::tribuna-denuncia.tribuna-denuncia')
					.findMany({
						where: { tipo, objetivoDocumentId: documentId, estado: 'pendiente' },
						select: ['id']
					});
				for (const d of pendientes) {
					await strapi.db
						.query('api::tribuna-denuncia.tribuna-denuncia')
						.update({ where: { id: d.id }, data: { estado: 'resuelta' } });
				}
			}
			ctx.body = { ok: true };
		}
	})
);
