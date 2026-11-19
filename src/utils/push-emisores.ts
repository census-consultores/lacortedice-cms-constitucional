/**
 * Emisores de notificaciones push del producto. Cada función arma su
 * AUDIENCIA según las preferencias por usuario (pushPrefs) y dispara el
 * envío en segundo plano — NUNCA lanzan: un push caído no puede romper la
 * request que lo originó.
 *
 * Tipos (cada uno con su interruptor en la Cuenta):
 *   - temaNuevo    : alguien abrió un tema en el Debate (+ variante favoritos).
 *   - comentario   : actividad en un tema donde el usuario participó
 *                    (+ variante favoritos). Respeta temasSilenciados.
 *   - sentencias   : digest diario de sentencias publicadas (cron).
 *   - juegoDiario  : recordatorio del juego elegido (cron).
 */
import { enviarPush, prefsDe, type PushMensaje } from './apns';

/**
 * Emite una notificación COMPLETA: deja su rastro en la bandeja de cada
 * usuario (content-type `notificacion`), calcula el globo del icono
 * (no leídas por usuario) y dispara el push por APNs.
 * Toda notificación del producto debe salir por aquí — un push sin rastro
 * en la bandeja no le sirve de nada a quien lo recibe después.
 */
export async function emitir(strapi: Core, userIds: number[], mensaje: PushMensaje): Promise<void> {
	if (userIds.length === 0) return;
	const badges = new Map<number, number>();
	for (const id of userIds) {
		try {
			await strapi.db.query('api::notificacion.notificacion').create({
				data: {
					user: id,
					titulo: mensaje.titulo,
					cuerpo: mensaje.cuerpo ?? '',
					url: mensaje.data?.url ?? null
				}
			});
			badges.set(
				id,
				await strapi.db
					.query('api::notificacion.notificacion')
					.count({ where: { user: { id }, leidaEn: { $null: true } } })
			);
		} catch (e: any) {
			strapi.log.error('[push.emitir] rastro falló para user ' + id + ': ' + (e?.message ?? e));
		}
	}
	await enviarPush(strapi, userIds, mensaje, badges);
}

type Core = any;

type UsuarioPush = {
	id: number;
	pushPrefs?: unknown;
	temasSilenciados?: unknown;
};

const USER_UID = 'plugin::users-permissions.user';

async function usuariosConDispositivo(strapi: Core): Promise<UsuarioPush[]> {
	// Solo usuarios con al menos un dispositivo activo: el resto no puede
	// recibir push y filtrarlos aquí evita armar audiencias fantasma.
	const dispositivos: Array<{ user: { id: number } | null }> = await strapi.db
		.query('api::push-dispositivo.push-dispositivo')
		.findMany({ where: { activo: true }, populate: { user: { select: ['id'] } }, limit: 5000 });
	const ids = [...new Set(dispositivos.map((d) => d.user?.id).filter(Boolean))] as number[];
	if (ids.length === 0) return [];
	return strapi.db.query(USER_UID).findMany({
		where: { id: { $in: ids }, blocked: false },
		select: ['id', 'pushPrefs', 'temasSilenciados'],
		limit: 5000
	});
}

function silencio(u: UsuarioPush, temaDocumentId: string): boolean {
	return Array.isArray(u.temasSilenciados) && u.temasSilenciados.includes(temaDocumentId);
}

async function favoritosDe(strapi: Core, causaDocumentId: string | null): Promise<Set<number>> {
	if (!causaDocumentId) return new Set();
	const filas: Array<{ user: { id: number } | null }> = await strapi.db
		.query('api::favorito.favorito')
		.findMany({
			where: { causaDocumentId },
			populate: { user: { select: ['id'] } },
			limit: 5000
		});
	return new Set(filas.map((f) => f.user?.id).filter(Boolean) as number[]);
}

/** Alguien abrió un tema nuevo en el Debate. */
export function notificarTemaNuevo(
	strapi: Core,
	tema: { documentId: string; titulo: string; expedienteSlug?: string | null },
	autorId: number
): void {
	void (async () => {
		try {
			const usuarios = await usuariosConDispositivo(strapi);
			const favs = await favoritosDe(strapi, tema.expedienteSlug ?? null);
			const aFavoritos: number[] = [];
			const aGenerales: number[] = [];
			for (const u of usuarios) {
				if (u.id === autorId) continue;
				const p = prefsDe(u);
				if (favs.has(u.id) && p.favoritos) aFavoritos.push(u.id);
				else if (p.temasNuevos) aGenerales.push(u.id);
			}
			const url = `/tribuna/${tema.documentId}`;
			await emitir(strapi, aFavoritos, {
				titulo: 'Debate sobre un caso de tus favoritos ⭐',
				cuerpo: tema.titulo,
				data: { url },
				threadId: `tema-${tema.documentId}`
			});
			await emitir(strapi, aGenerales, {
				titulo: 'Nuevo tema en el Debate Tributario',
				cuerpo: tema.titulo,
				data: { url },
				threadId: `tema-${tema.documentId}`
			});
		} catch (e: any) {
			strapi.log.error('[push.temaNuevo] ' + (e?.message ?? e));
		}
	})();
}

/** Alguien comentó en un tema: avisar a los participantes y a los favoritos. */
export function notificarComentario(
	strapi: Core,
	tema: { id: number; documentId: string; titulo: string; expedienteSlug?: string | null },
	autorComentarioId: number,
	extracto: string
): void {
	void (async () => {
		try {
			// Participantes: autor del tema + autores de comentarios visibles.
			const comentarios: Array<{ user: { id: number } | null }> = await strapi.db
				.query('api::tribuna-comentario.tribuna-comentario')
				.findMany({
					where: { tema: { id: tema.id }, estado: 'visible' },
					populate: { user: { select: ['id'] } },
					limit: 2000
				});
			const temaFila = await strapi.db
				.query('api::tribuna-tema.tribuna-tema')
				.findOne({ where: { id: tema.id }, populate: { user: { select: ['id'] } } });
			const participantes = new Set<number>(
				comentarios.map((c) => c.user?.id).filter(Boolean) as number[]
			);
			if (temaFila?.user?.id) participantes.add(temaFila.user.id);

			const usuarios = await usuariosConDispositivo(strapi);
			const favs = await favoritosDe(strapi, tema.expedienteSlug ?? null);
			const aParticipantes: number[] = [];
			const aFavoritos: number[] = [];
			for (const u of usuarios) {
				if (u.id === autorComentarioId) continue;
				if (silencio(u, tema.documentId)) continue;
				const p = prefsDe(u);
				if (participantes.has(u.id) && p.debates) aParticipantes.push(u.id);
				else if (favs.has(u.id) && p.favoritos) aFavoritos.push(u.id);
			}
			const url = `/tribuna/${tema.documentId}`;
			await emitir(strapi, aParticipantes, {
				titulo: `Nuevo comentario en «${tema.titulo.slice(0, 60)}»`,
				cuerpo: extracto.slice(0, 140),
				data: { url },
				threadId: `tema-${tema.documentId}`
			});
			await emitir(strapi, aFavoritos, {
				titulo: 'Actividad en un caso de tus favoritos ⭐',
				cuerpo: extracto.slice(0, 140),
				data: { url },
				threadId: `tema-${tema.documentId}`
			});
		} catch (e: any) {
			strapi.log.error('[push.comentario] ' + (e?.message ?? e));
		}
	})();
}

/** Cron diario: digest de sentencias publicadas en las últimas 24 h. */
export async function digestSentencias(strapi: Core): Promise<void> {
	const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
	const nuevas = await strapi.db
		.query('api::causa.causa')
		.count({ where: { publishedAt: { $gte: desde } } });
	if (!nuevas) return;
	const usuarios = await usuariosConDispositivo(strapi);
	const audiencia = usuarios.filter((u) => prefsDe(u).sentencias).map((u) => u.id);
	await emitir(strapi, audiencia, {
		titulo: 'Sentencias nuevas en el repositorio',
		cuerpo:
			nuevas === 1
				? 'Se publicó 1 sentencia nueva. Ábrela antes que nadie.'
				: `Se publicaron ${nuevas} sentencias nuevas. Revísalas antes que nadie.`,
		data: { url: '/buscar?sort=publicado-desc' },
		threadId: 'sentencias'
	});
}

const NOMBRE_JUEGO: Record<string, { nombre: string; url: string }> = {
	'falla-tu': { nombre: 'Falla Tú', url: '/falla-tu' },
	express: { nombre: 'Tribunal Express', url: '/express' },
	gemelos: { nombre: 'Gemelos Divergentes', url: '/gemelos' }
};

/** Cron diario: recordatorio del juego elegido por cada usuario. */
export async function recordatorioJuego(strapi: Core): Promise<void> {
	const usuarios = await usuariosConDispositivo(strapi);
	const porJuego = new Map<string, number[]>();
	for (const u of usuarios) {
		const j = prefsDe(u).juegoDiario;
		if (j && NOMBRE_JUEGO[j]) porJuego.set(j, [...(porJuego.get(j) ?? []), u.id]);
	}
	for (const [j, ids] of porJuego) {
		const { nombre, url } = NOMBRE_JUEGO[j];
		await emitir(strapi, ids, {
			titulo: `Tu partida diaria de ${nombre} 🎯`,
			cuerpo: 'Juega la de hoy y defiende tu puesto en el ranking.',
			data: { url },
			threadId: 'juego-diario'
		});
	}
}
