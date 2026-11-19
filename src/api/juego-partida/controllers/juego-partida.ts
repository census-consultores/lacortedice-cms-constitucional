/**
 * Controllers del content-type `juego-partida`.
 *
 * SRP: validan el input y delegan al service. Toda la lógica de ranking,
 * racha y límites vive en `services/juego-partida.ts`.
 *
 * Las partidas SIEMPRE llegan cerradas y ya puntuadas por el BFF de la
 * webapp (que es quien conoce la respuesta correcta de cada tarjeta). El CMS
 * las guarda tal cual: es el registro persistente, no el árbitro.
 */

import { factories } from '@strapi/strapi';

type Ctx = any;

export const JUEGOS = ['express', 'gemelos', 'ojo', 'causal', 'criterio', 'voto'] as const;
export type Juego = (typeof JUEGOS)[number];

function isJuego(v: unknown): v is Juego {
	return typeof v === 'string' && (JUEGOS as readonly string[]).includes(v);
}

function isDayKey(v: unknown): v is string {
	return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function toInt(v: unknown, fallback = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n) : fallback;
}

export default factories.createCoreController('api::juego-partida.juego-partida', ({ strapi }) => ({
	async crearMia(ctx: Ctx) {
		const userId = ctx.state.user?.id;
		if (!userId) return ctx.unauthorized();

		const body = ctx.request.body ?? {};
		const { juego, partidaId, dayKey, puntaje, aciertos, total, duracionMs, estado, ronda, respuestas, playedAt, retoId, origen } = body;

		if (!isJuego(juego)) return ctx.badRequest('juego inválido');
		if (typeof partidaId !== 'string' || !/^[a-f0-9]{16,64}$/.test(partidaId)) {
			return ctx.badRequest('partidaId inválido');
		}
		if (!isDayKey(dayKey)) return ctx.badRequest('dayKey debe tener formato YYYY-MM-DD');
		if (typeof playedAt !== 'string' || Number.isNaN(Date.parse(playedAt))) {
			return ctx.badRequest('playedAt inválido');
		}
		const est = estado === 'fuera_de_tiempo' ? 'fuera_de_tiempo' : 'cerrada';
		const tot = toInt(total);
		const ac = toInt(aciertos);
		if (tot < 1 || tot > 50) return ctx.badRequest('total fuera de rango');
		if (ac < 0 || ac > tot) return ctx.badRequest('aciertos fuera de rango');
		const pts = toInt(puntaje);
		if (pts < 0 || pts > 100_000) return ctx.badRequest('puntaje fuera de rango');

		// Idempotencia: la misma partida (mismo partidaId) sólo se registra una
		// vez. El BFF reintenta el POST si la red falló; acá no se duplica.
		const existente = await strapi.db
			.query('api::juego-partida.juego-partida')
			.findOne({ where: { partidaId }, select: ['id'], populate: { user: { select: ['id'] } } });
		if (existente) {
			if (existente.user?.id && existente.user.id !== userId) return ctx.forbidden();
			ctx.status = 200;
			return { ok: true, id: existente.id, duplicada: true };
		}

		const created = await strapi.service('api::juego-partida.juego-partida').registrar(userId, {
			juego,
			partidaId,
			dayKey,
			puntaje: pts,
			aciertos: ac,
			total: tot,
			duracionMs: Math.max(0, toInt(duracionMs)),
			estado: est,
			ronda: ronda ?? null,
			respuestas: respuestas ?? null,
			playedAt,
			retoId: typeof retoId === 'string' && retoId ? retoId.slice(0, 64) : null,
			// `offline`: jugada en el teléfono sin red y sincronizada después. El
			// BFF ya la re-puntuó contra su propio inventario; acá sólo se etiqueta
			// para analítica. Vale igual para ranking, racha y límite diario.
			origen: origen === 'offline' ? 'offline' : 'online'
		});

		return { ok: true, id: (created as any).id, duplicada: false };
	},

	async misStats(ctx: Ctx) {
		const userId = ctx.state.user?.id;
		if (!userId) return ctx.unauthorized();
		const juego = ctx.query.juego;
		if (juego !== undefined && !isJuego(juego)) return ctx.badRequest('juego inválido');
		const dayKey = ctx.query.dayKey;
		if (dayKey !== undefined && !isDayKey(dayKey)) return ctx.badRequest('dayKey inválido');
		return strapi.service('api::juego-partida.juego-partida').statsDeUsuario(userId, {
			juego: juego as Juego | undefined,
			dayKey: dayKey as string | undefined
		});
	},

	async leaderboard(ctx: Ctx) {
		const userId = ctx.state.user?.id ?? undefined;
		const juego = ctx.query.juego;
		if (!isJuego(juego)) return ctx.badRequest('juego requerido');
		const period = ctx.query.period;
		const validPeriod = period === 'week' || period === 'month' || period === 'all' ? period : 'week';
		const limit = Number(ctx.query.limit ?? 50);
		return strapi.service('api::juego-partida.juego-partida').leaderboard({
			juego,
			period: validPeriod,
			limit: Number.isFinite(limit) ? limit : 50,
			currentUserId: userId
		});
	},

	async recientes(ctx: Ctx) {
		const userId = ctx.state.user?.id;
		if (!userId) return ctx.unauthorized();
		const juego = ctx.query.juego;
		if (!isJuego(juego)) return ctx.badRequest('juego requerido');
		const dias = Math.min(Math.max(Number(ctx.query.dias ?? 60) || 60, 1), 365);
		const documentIds = await strapi
			.service('api::juego-partida.juego-partida')
			.documentIdsRecientes(userId, juego, dias);
		return { juego, dias, documentIds };
	}
}));
