/**
 * Controllers de notificaciones push: registro de dispositivos, preferencias
 * por usuario y silenciado por tema. Todo scoped al usuario del JWT.
 */
import { factories } from '@strapi/strapi';
import { prefsDe, PREFS_DEFAULT } from '../../../utils/apns';
import { emitir } from '../../../utils/push-emisores';

type Ctx = any;

const UID = 'api::push-dispositivo.push-dispositivo';

/** Juegos válidos para el recordatorio diario. */
const JUEGOS = new Set(['falla-tu', 'express', 'gemelos']);

function esAdmin(user: any): boolean {
	return user?.userRole === 'admin' || user?.userRole === 'superadmin';
}

export default factories.createCoreController(UID, ({ strapi }) => ({
	/** POST /push/registrar {token, plataforma} — upsert del dispositivo. */
	async registrar(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const body = ctx.request.body ?? {};
		const token = typeof body.token === 'string' ? body.token.trim() : '';
		const plataforma = body.plataforma === 'android' ? 'android' : 'ios';
		// Token APNs = hex de 64+; FCM más largo. Cota sana anti-basura.
		if (!token || token.length < 32 || token.length > 512) {
			return ctx.badRequest('Token inválido');
		}
		const ahora = new Date().toISOString();
		const existente = await strapi.db.query(UID).findOne({ where: { token }, select: ['id'] });
		if (existente) {
			// El token puede cambiar de dueño (otro usuario inició sesión en el
			// mismo teléfono): siempre re-apuntar al usuario actual.
			await strapi.db.query(UID).update({
				where: { id: existente.id },
				data: { user: user.id, plataforma, activo: true, ultimoRegistroEn: ahora }
			});
		} else {
			await strapi.db.query(UID).create({
				data: { user: user.id, token, plataforma, activo: true, ultimoRegistroEn: ahora }
			});
		}
		ctx.body = { ok: true };
	},

	/** POST /push/baja {token} — desactiva el token (cierre de sesión). */
	async baja(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const token = typeof ctx.request.body?.token === 'string' ? ctx.request.body.token.trim() : '';
		if (!token) return ctx.badRequest('Falta el token');
		// El `where` acota por DUEÑO además del token: sin eso, cualquier
		// usuario que conociera el token de otro le apagaba las notificaciones.
		await strapi.db
			.query(UID)
			.update({ where: { token, user: { id: user.id } }, data: { activo: false } })
			.catch(() => {});
		ctx.body = { ok: true };
	},

	/** GET /push/preferencias — prefs efectivas + temas silenciados. */
	async preferencias(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const fila = await strapi.db
			.query('plugin::users-permissions.user')
			.findOne({ where: { id: user.id }, select: ['pushPrefs', 'temasSilenciados'] });
		const dispositivos = await strapi.db
			.query(UID)
			.count({ where: { user: { id: user.id }, activo: true } });
		ctx.body = {
			ok: true,
			prefs: prefsDe(fila),
			temasSilenciados: Array.isArray(fila?.temasSilenciados) ? fila.temasSilenciados : [],
			dispositivosActivos: dispositivos
		};
	},

	/** PUT /push/preferencias {sentencias?, debates?, temasNuevos?, favoritos?, juegoDiario?} */
	async guardarPreferencias(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const body = ctx.request.body ?? {};
		const fila = await strapi.db
			.query('plugin::users-permissions.user')
			.findOne({ where: { id: user.id }, select: ['pushPrefs'] });
		const actuales = prefsDe(fila);
		const nuevas: Record<string, unknown> = { ...actuales };
		for (const k of ['sentencias', 'debates', 'temasNuevos', 'favoritos'] as const) {
			if (typeof body[k] === 'boolean') nuevas[k] = body[k];
		}
		if ('juegoDiario' in body) {
			nuevas.juegoDiario =
				typeof body.juegoDiario === 'string' && JUEGOS.has(body.juegoDiario)
					? body.juegoDiario
					: null;
		}
		await strapi.db
			.query('plugin::users-permissions.user')
			.update({ where: { id: user.id }, data: { pushPrefs: nuevas } });
		ctx.body = { ok: true, prefs: { ...PREFS_DEFAULT, ...nuevas } };
	},

	/** POST /push/silenciar-tema {temaDocumentId, silenciar} */
	async silenciarTema(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const body = ctx.request.body ?? {};
		const documentId = typeof body.temaDocumentId === 'string' ? body.temaDocumentId.trim() : '';
		if (!documentId || documentId.length > 64) return ctx.badRequest('Tema inválido');
		const silenciar = body.silenciar !== false;
		const fila = await strapi.db
			.query('plugin::users-permissions.user')
			.findOne({ where: { id: user.id }, select: ['temasSilenciados'] });
		const set = new Set<string>(Array.isArray(fila?.temasSilenciados) ? fila.temasSilenciados : []);
		if (silenciar) set.add(documentId);
		else set.delete(documentId);
		// Cota: nadie necesita silenciar más de 500 temas.
		const lista = [...set].slice(-500);
		await strapi.db
			.query('plugin::users-permissions.user')
			.update({ where: { id: user.id }, data: { temasSilenciados: lista } });
		ctx.body = { ok: true, silenciado: silenciar };
	},

	/** GET /push/notificaciones — la bandeja del usuario (últimas 50 + no leídas). */
	async notificaciones(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const [filas, noLeidas] = await Promise.all([
			strapi.db.query('api::notificacion.notificacion').findMany({
				where: { user: { id: user.id } },
				orderBy: { createdAt: 'desc' },
				limit: 50
			}),
			strapi.db
				.query('api::notificacion.notificacion')
				.count({ where: { user: { id: user.id }, leidaEn: { $null: true } } })
		]);
		ctx.body = {
			ok: true,
			noLeidas,
			notificaciones: filas.map((n: any) => ({
				documentId: n.documentId,
				titulo: n.titulo,
				cuerpo: n.cuerpo ?? '',
				url: n.url ?? null,
				leidaEn: n.leidaEn ?? null,
				creadaEn: n.createdAt
			}))
		};
	},

	/** POST /push/notificaciones-leidas {documentIds?: string[], todas?: boolean} */
	async marcarLeidas(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		const body = ctx.request.body ?? {};
		const ahora = new Date().toISOString();
		const where: any = { user: { id: user.id }, leidaEn: { $null: true } };
		if (!body.todas) {
			const ids = Array.isArray(body.documentIds)
				? body.documentIds.filter((x: unknown) => typeof x === 'string').slice(0, 100)
				: [];
			if (ids.length === 0) return ctx.badRequest('Nada que marcar');
			where.documentId = { $in: ids };
		}
		const filas = await strapi.db
			.query('api::notificacion.notificacion')
			.findMany({ where, select: ['id'], limit: 500 });
		for (const f of filas) {
			await strapi.db
				.query('api::notificacion.notificacion')
				.update({ where: { id: f.id }, data: { leidaEn: ahora } });
		}
		const noLeidas = await strapi.db
			.query('api::notificacion.notificacion')
			.count({ where: { user: { id: user.id }, leidaEn: { $null: true } } });
		ctx.body = { ok: true, noLeidas };
	},

	/** POST /push/prueba — manda una notificación de prueba al propio usuario (admin). */
	async prueba(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();
		if (!esAdmin(user)) return ctx.forbidden();
		await emitir(strapi, [user.id], {
			titulo: 'La Corte Dice Tributaria',
			cuerpo: 'Notificación de prueba: el canal push está funcionando. 🎉',
			data: { url: '/home' },
			threadId: 'prueba'
		});
		ctx.body = { ok: true };
	}
}));
