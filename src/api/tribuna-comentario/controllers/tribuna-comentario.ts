/**
 * Controllers de la Tribuna Tributaria · comentarios.
 * Publicación directa por cualquier usuario registrado, con tope diario
 * anti-spam. Comentar actualiza la última actividad del tema.
 */

import { factories } from '@strapi/strapi';
import {
	faltaNombreCompleto,
	fotoDe,
	nombreCompleto,
	textoLimpio
} from '../../tribuna-tema/controllers/tribuna-tema';
import { notificarComentario } from '../../../utils/push-emisores';
import { revisarContenido } from '../../../utils/moderacion';

type Ctx = any;

const COMENTARIOS_POR_DIA = 60;

function inicioDelDia(): Date {
	const d = new Date();
	d.setUTCHours(d.getUTCHours() - 5);
	d.setUTCHours(5, 0, 0, 0);
	if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
	return d;
}

export default factories.createCoreController(
	'api::tribuna-comentario.tribuna-comentario',
	({ strapi }) => ({
		/** POST /tribuna/comentarios {temaDocumentId, cuerpo} */
		async crear(ctx: Ctx) {
			const user = ctx.state.user;
			if (!user?.id) return ctx.unauthorized();

			const body = ctx.request.body ?? {};
			const temaDocumentId = textoLimpio(body.temaDocumentId, 64);
			const cuerpo = textoLimpio(body.cuerpo, 5000);
			if (cuerpo.length < 2) return ctx.badRequest('El comentario está vacío');

			// Autores con nombre y apellidos completos, siempre.
			const faltaNombre = await faltaNombreCompleto(strapi, user.id);
			if (faltaNombre) return ctx.badRequest(faltaNombre);
			// ctx.state.user no siempre trae los nombres: leerlos para la respuesta.
			const autorFila = await strapi.db
				.query('plugin::users-permissions.user')
				.findOne({
					where: { id: user.id },
					select: ['username', 'firstName', 'lastName', 'picture']
				});

			const tema = await strapi.db.query('api::tribuna-tema.tribuna-tema').findOne({
				where: { documentId: temaDocumentId, estado: 'visible' },
				select: ['id', 'documentId', 'titulo', 'expedienteSlug']
			});
			if (!tema) return ctx.notFound('Tema no encontrado');

			const hoy = await strapi.db
				.query('api::tribuna-comentario.tribuna-comentario')
				.count({ where: { user: { id: user.id }, createdAt: { $gte: inicioDelDia() } } });
			if (hoy >= COMENTARIOS_POR_DIA) {
				return ctx.badRequest('Alcanzaste el máximo de comentarios por hoy');
			}

			// Filtro de contenido ANTES de publicar (Apple 1.2): lo ofensivo no
			// entra, y lo dudoso entra pero queda marcado para revisión.
			const veredicto = revisarContenido(cuerpo);
			if (veredicto.accion === 'bloquear') {
				strapi.log.warn(`[tribuna] comentario bloqueado (user ${user.id}): ${veredicto.motivo}`);
				return ctx.badRequest(veredicto.mensaje);
			}

			const creado = await strapi.db
				.query('api::tribuna-comentario.tribuna-comentario')
				.create({ data: { user: user.id, tema: tema.id, cuerpo, estado: 'visible' } });

			if (veredicto.accion === 'revisar') {
				await strapi.db
					.query('api::tribuna-denuncia.tribuna-denuncia')
					.create({
						data: {
							tipo: 'comentario',
							objetivoDocumentId: creado.documentId,
							motivo: `Revisión automática — ${veredicto.motivo}`,
							estado: 'pendiente',
							user: user.id
						}
					})
					.catch((e: any) =>
						strapi.log.error('[tribuna] no se pudo encolar la revisión: ' + (e?.message ?? e))
					);
			}

			await strapi.db
				.query('api::tribuna-tema.tribuna-tema')
				.update({ where: { id: tema.id }, data: { ultimaActividadAt: new Date() } });

			// Push en segundo plano: participantes del hilo + favoritos del caso.
			notificarComentario(strapi, tema, user.id, cuerpo);

			ctx.body = {
				ok: true,
				comentario: {
					documentId: creado.documentId,
					cuerpo: creado.cuerpo,
					estado: creado.estado,
					autor: nombreCompleto(autorFila ?? user),
					autorFoto: fotoDe(autorFila ?? user),
					esMio: true,
					creadoEn: creado.createdAt
				}
			};
		}
	})
);
