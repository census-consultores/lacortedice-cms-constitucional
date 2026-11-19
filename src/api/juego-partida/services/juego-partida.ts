/**
 * Service del content-type `juego-partida` (motor común de juegos).
 *
 * Encapsula:
 *   - Persistencia de rondas cerradas.
 *   - Stats del usuario: totales por juego, rondas jugadas hoy (para el
 *     límite diario gratuito) y racha de plataforma.
 *   - Ranking por juego y período.
 *   - Lista de documentIds jugados recientemente (anti-repetición).
 *
 * Racha de plataforma: cuenta días consecutivos (dayKey, corte 06:00 GYE
 * como Falla Tú) con AL MENOS una partida cerrada en cualquier juego, o una
 * jugada de Falla Tú. Una sola racha para toda la app, no una por juego.
 */

import { factories } from '@strapi/strapi';

export type Juego = 'express' | 'gemelos' | 'ojo' | 'causal' | 'criterio' | 'voto';
export type Periodo = 'week' | 'month' | 'all';

/**
 * Cómo se agrega el puntaje de un usuario en el ranking de cada juego.
 *   - 'mejor': la mejor ronda del período (arcade: Tribunal Express).
 *   - 'suma':  suma de puntos del período (juegos de lectura: Gemelos, etc.).
 */
const MODO_RANKING: Record<Juego, 'mejor' | 'suma'> = {
	express: 'mejor',
	gemelos: 'suma',
	ojo: 'suma',
	causal: 'suma',
	criterio: 'suma',
	voto: 'suma'
};

const MIN_PARTIDAS_PARA_RANKEAR: Record<Juego, number> = {
	express: 3,
	gemelos: 3,
	ojo: 3,
	causal: 3,
	criterio: 3,
	voto: 3
};

export type EntradaRanking = {
	userId: number;
	username: string;
	partidas: number;
	aciertos: number;
	total: number;
	precision: number;
	puntaje: number;
};

/** dayKey → día anterior (aritmética UTC sobre YYYY-MM-DD). */
function diaAnterior(dayKey: string): string {
	const [y, m, d] = dayKey.split('-').map(Number);
	const t = Date.UTC(y, m - 1, d) - 86_400_000;
	const x = new Date(t);
	return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Racha actual y máxima a partir de un conjunto de dayKeys. La racha actual
 * sólo cuenta si incluye hoy o ayer (si hoy aún no jugó, la racha sigue viva
 * hasta el corte del día siguiente).
 */
export function calcularRacha(dayKeys: Iterable<string>, hoy: string): { actual: number; maxima: number } {
	const dias = Array.from(new Set(dayKeys)).filter(Boolean).sort();
	if (dias.length === 0) return { actual: 0, maxima: 0 };

	let maxima = 1;
	let corrida = 1;
	for (let i = 1; i < dias.length; i++) {
		if (diaAnterior(dias[i]) === dias[i - 1]) corrida++;
		else corrida = 1;
		if (corrida > maxima) maxima = corrida;
	}

	const set = new Set(dias);
	let cursor = set.has(hoy) ? hoy : set.has(diaAnterior(hoy)) ? diaAnterior(hoy) : null;
	let actual = 0;
	while (cursor && set.has(cursor)) {
		actual++;
		cursor = diaAnterior(cursor);
	}
	return { actual, maxima };
}

export default factories.createCoreService('api::juego-partida.juego-partida', ({ strapi }) => ({
	async registrar(
		userId: number,
		data: {
			juego: Juego;
			partidaId: string;
			dayKey: string;
			puntaje: number;
			aciertos: number;
			total: number;
			duracionMs: number;
			estado: 'cerrada' | 'fuera_de_tiempo';
			ronda: unknown;
			respuestas: unknown;
			playedAt: string;
			retoId: string | null;
			origen?: 'online' | 'offline';
		}
	) {
		return strapi.db.query('api::juego-partida.juego-partida').create({
			data: { user: userId, ...data }
		});
	},

	async statsDeUsuario(userId: number, opts: { juego?: Juego; dayKey?: string }) {
		const where: any = { user: userId };
		if (opts.juego) where.juego = opts.juego;

		const partidas = await strapi.db.query('api::juego-partida.juego-partida').findMany({
			where,
			select: ['juego', 'dayKey', 'puntaje', 'aciertos', 'total', 'estado', 'playedAt'],
			orderBy: { playedAt: 'desc' },
			limit: 2000
		});

		const hoy = opts.dayKey ?? partidas[0]?.dayKey ?? '';
		const rondasHoy = hoy ? partidas.filter((p: any) => p.dayKey === hoy).length : 0;
		const cerradas = partidas.filter((p: any) => p.estado === 'cerrada');
		const totalPartidas = cerradas.length;
		const aciertos = cerradas.reduce((s: number, p: any) => s + Number(p.aciertos || 0), 0);
		const total = cerradas.reduce((s: number, p: any) => s + Number(p.total || 0), 0);
		const mejorPuntaje = cerradas.reduce((m: number, p: any) => Math.max(m, Number(p.puntaje || 0)), 0);
		const sumaPuntaje = cerradas.reduce((s: number, p: any) => s + Number(p.puntaje || 0), 0);

		// Racha de plataforma: dayKeys de TODAS las partidas del usuario (cualquier
		// juego) + jugadas de Falla Tú.
		const todas = opts.juego
			? await strapi.db.query('api::juego-partida.juego-partida').findMany({
					where: { user: userId },
					select: ['dayKey'],
					limit: 5000
				})
			: partidas;
		const fallaTu = await strapi.db.query('api::falla-tu-jugada.falla-tu-jugada').findMany({
			where: { user: userId },
			select: ['dayKey'],
			limit: 5000
		});
		const dayKeys = [...todas.map((p: any) => p.dayKey), ...fallaTu.map((p: any) => p.dayKey)];
		const racha = hoy ? calcularRacha(dayKeys, hoy) : calcularRacha(dayKeys, dayKeys.sort().at(-1) ?? '');

		return {
			juego: opts.juego ?? null,
			dayKey: hoy || null,
			rondasHoy,
			totalPartidas,
			aciertos,
			total,
			precision: total ? aciertos / total : 0,
			mejorPuntaje,
			sumaPuntaje,
			racha,
			ultimas: cerradas.slice(0, 10).map((p: any) => ({
				juego: p.juego,
				dayKey: p.dayKey,
				puntaje: p.puntaje,
				aciertos: p.aciertos,
				total: p.total,
				playedAt: p.playedAt
			}))
		};
	},

	async leaderboard(opts: { juego: Juego; period: Periodo; limit: number; currentUserId?: number }) {
		const limit = Math.min(Math.max(opts.limit, 1), 100);
		const where: any = { juego: opts.juego, estado: 'cerrada' };
		if (opts.period !== 'all') {
			const since = new Date();
			if (opts.period === 'week') since.setUTCDate(since.getUTCDate() - 7);
			if (opts.period === 'month') since.setUTCMonth(since.getUTCMonth() - 1);
			where.playedAt = { $gte: since.toISOString() };
		}

		const partidas = await strapi.db.query('api::juego-partida.juego-partida').findMany({
			where,
			populate: { user: { select: ['id', 'username'] } },
			select: ['puntaje', 'aciertos', 'total'],
			limit: 50_000
		});

		const modo = MODO_RANKING[opts.juego];
		const minPartidas = MIN_PARTIDAS_PARA_RANKEAR[opts.juego];

		const porUsuario = new Map<number, { username: string; partidas: number; aciertos: number; total: number; mejor: number; suma: number }>();
		for (const p of partidas) {
			const u = (p as any).user;
			if (!u?.id) continue;
			const agg = porUsuario.get(u.id) ?? { username: u.username, partidas: 0, aciertos: 0, total: 0, mejor: 0, suma: 0 };
			agg.partidas++;
			agg.aciertos += Number(p.aciertos || 0);
			agg.total += Number(p.total || 0);
			agg.mejor = Math.max(agg.mejor, Number(p.puntaje || 0));
			agg.suma += Number(p.puntaje || 0);
			porUsuario.set(u.id, agg);
		}

		const construir = (userId: number, agg: NonNullable<ReturnType<typeof porUsuario.get>>): EntradaRanking => ({
			userId,
			username: agg.username,
			partidas: agg.partidas,
			aciertos: agg.aciertos,
			total: agg.total,
			precision: agg.total ? agg.aciertos / agg.total : 0,
			puntaje: modo === 'mejor' ? agg.mejor : agg.suma
		});

		const elegibles: EntradaRanking[] = [];
		for (const [userId, agg] of porUsuario) {
			if (agg.partidas < minPartidas) continue;
			elegibles.push(construir(userId, agg));
		}
		elegibles.sort((a, b) => {
			if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
			if (b.precision !== a.precision) return b.precision - a.precision;
			return b.partidas - a.partidas;
		});

		let yo: (EntradaRanking & { rank: number }) | null = null;
		if (opts.currentUserId) {
			const idx = elegibles.findIndex((e) => e.userId === opts.currentUserId);
			if (idx >= 0) yo = { ...elegibles[idx], rank: idx + 1 };
			else {
				const agg = porUsuario.get(opts.currentUserId);
				if (agg) yo = { ...construir(opts.currentUserId, agg), rank: -1 };
			}
		}

		return {
			juego: opts.juego,
			period: opts.period,
			modo,
			top: elegibles.slice(0, limit),
			yo,
			totalRankeados: elegibles.length,
			minPartidasParaRankear: minPartidas
		};
	},

	/** documentIds (de `ronda.items[].documentId`) jugados en los últimos `dias`. */
	async documentIdsRecientes(userId: number, juego: Juego, dias: number): Promise<string[]> {
		const since = new Date(Date.now() - dias * 86_400_000).toISOString();
		const partidas = await strapi.db.query('api::juego-partida.juego-partida').findMany({
			where: { user: userId, juego, playedAt: { $gte: since } },
			select: ['ronda'],
			limit: 1000
		});
		const ids = new Set<string>();
		for (const p of partidas) {
			const items = (p as any).ronda?.items;
			if (!Array.isArray(items)) continue;
			for (const it of items) {
				if (typeof it?.documentId === 'string') ids.add(it.documentId);
				// Gemelos guarda pares: a y b.
				if (typeof it?.a === 'string') ids.add(it.a);
				if (typeof it?.b === 'string') ids.add(it.b);
			}
		}
		return Array.from(ids);
	}
}));
