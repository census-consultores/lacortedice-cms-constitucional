/**
 * Service del content-type `falla-tu-jugada`.
 *
 * Encapsula:
 *   - Lógica de scoring compuesto (accuracy + brier).
 *   - Cálculo del leaderboard global agregando por usuario.
 *   - Persistencia de jugadas.
 *
 * Mantiene SRP: los controllers solo hacen ctx -> service -> respuesta.
 */

import { factories } from '@strapi/strapi';

const MIN_PLAYS_TO_RANK = 14; // 1 semana × 2 jugadas/día
const BRIER_WEIGHT = 30; // K en `score = accuracy*100 - avgBrier*K`

export type AggregatedUserStats = {
	userId: number;
	username: string;
	totalPlays: number;
	correctPlays: number;
	accuracy: number;
	avgBrier: number;
	score: number;
};

/**
 * Aplica la fórmula compuesta del puntaje.
 *   accuracy en [0,1] -> aporte hasta 100 puntos
 *   avgBrier en [0,1] -> resta hasta 30 puntos
 * Clamp a [0, 100] para mantener escala intuitiva.
 */
export function computeScore(accuracy: number, avgBrier: number): number {
	const raw = accuracy * 100 - avgBrier * BRIER_WEIGHT;
	return Math.max(0, Math.round(raw));
}

export default factories.createCoreService('api::falla-tu-jugada.falla-tu-jugada', ({ strapi }) => ({
	/**
	 * Registra una jugada del usuario autenticado. El controller ya valida
	 * el shape; aquí solo persistimos.
	 */
	async registrar(userId: number, data: {
		caseDocumentId: string;
		decision: 'C' | 'CP' | 'NC';
		confidence: number;
		correct: boolean;
		brierScore: number;
		playedAt: string;
		dayKey: string;
	}) {
		return strapi.db.query('api::falla-tu-jugada.falla-tu-jugada').create({
			data: {
				user: userId,
				caseDocumentId: data.caseDocumentId,
				decision: data.decision,
				confidence: data.confidence,
				correct: data.correct,
				brierScore: data.brierScore,
				playedAt: data.playedAt,
				dayKey: data.dayKey
			}
		});
	},

	/**
	 * Stats del usuario actual leídos desde la BD. Equivalente al
	 * `computeStats` de la webapp pero sobre el universo persistido.
	 */
	async statsDeUsuario(userId: number) {
		const plays = await strapi.db.query('api::falla-tu-jugada.falla-tu-jugada').findMany({
			where: { user: userId },
			select: ['decision', 'confidence', 'correct', 'brierScore']
		});

		if (plays.length === 0) {
			return {
				totalPlays: 0,
				correctPlays: 0,
				accuracy: 0,
				avgBrier: 0,
				score: 0
			};
		}

		const totalPlays = plays.length;
		const correctPlays = plays.filter((p: any) => p.correct).length;
		const sumBrier = plays.reduce((s: number, p: any) => s + Number(p.brierScore), 0);
		const accuracy = correctPlays / totalPlays;
		const avgBrier = sumBrier / totalPlays;
		return {
			totalPlays,
			correctPlays,
			accuracy,
			avgBrier,
			score: computeScore(accuracy, avgBrier)
		};
	},

	/**
	 * Devuelve el ranking global agregado por usuario.
	 *   - Filtra usuarios con < MIN_PLAYS_TO_RANK jugadas
	 *   - Ordena por score desc, accuracy desc, totalPlays desc
	 *   - Devuelve top N + la posición del usuario actual si está rankeado
	 *
	 * Implementación: pulla todas las jugadas en el período y agrega en
	 * memoria. Es N+1 friendly (un solo SELECT con join al user). Si la
	 * tabla crece a >100k jugadas, esto se mueve a SQL agregado con knex.
	 */
	async leaderboard(opts: {
		period?: 'all' | 'month' | 'week';
		limit?: number;
		currentUserId?: number;
	}) {
		const period = opts.period ?? 'all';
		const limit = Math.min(opts.limit ?? 50, 100);

		const where: any = {};
		if (period !== 'all') {
			const since = new Date();
			if (period === 'week') since.setUTCDate(since.getUTCDate() - 7);
			if (period === 'month') since.setUTCMonth(since.getUTCMonth() - 1);
			where.playedAt = { $gte: since.toISOString() };
		}

		const plays = await strapi.db.query('api::falla-tu-jugada.falla-tu-jugada').findMany({
			where,
			populate: { user: { select: ['id', 'username'] } },
			select: ['correct', 'brierScore']
		});

		// Agrupar por usuario
		const byUser = new Map<number, { username: string; total: number; correct: number; sumBrier: number }>();
		for (const p of plays) {
			const u = (p as any).user;
			if (!u?.id) continue;
			const agg = byUser.get(u.id) ?? { username: u.username, total: 0, correct: 0, sumBrier: 0 };
			agg.total++;
			if (p.correct) agg.correct++;
			agg.sumBrier += Number(p.brierScore);
			byUser.set(u.id, agg);
		}

		// Construir array de stats elegibles
		const eligible: AggregatedUserStats[] = [];
		for (const [userId, agg] of byUser) {
			if (agg.total < MIN_PLAYS_TO_RANK) continue;
			const accuracy = agg.correct / agg.total;
			const avgBrier = agg.sumBrier / agg.total;
			eligible.push({
				userId,
				username: agg.username,
				totalPlays: agg.total,
				correctPlays: agg.correct,
				accuracy,
				avgBrier,
				score: computeScore(accuracy, avgBrier)
			});
		}

		// Ordenar
		eligible.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
			return b.totalPlays - a.totalPlays;
		});

		// Top N y posición del user actual
		const top = eligible.slice(0, limit);
		let myEntry: (AggregatedUserStats & { rank: number }) | null = null;
		if (opts.currentUserId) {
			const idx = eligible.findIndex((e) => e.userId === opts.currentUserId);
			if (idx >= 0) {
				myEntry = { ...eligible[idx], rank: idx + 1 };
			} else {
				// Usuario no rankeado: devolver sus stats parciales y cuántas le faltan
				const agg = byUser.get(opts.currentUserId);
				if (agg) {
					const accuracy = agg.total ? agg.correct / agg.total : 0;
					const avgBrier = agg.total ? agg.sumBrier / agg.total : 0;
					myEntry = {
						userId: opts.currentUserId,
						username: agg.username,
						totalPlays: agg.total,
						correctPlays: agg.correct,
						accuracy,
						avgBrier,
						score: computeScore(accuracy, avgBrier),
						rank: -1 // no rankeado
					};
				}
			}
		}

		return {
			period,
			top,
			myEntry,
			totalRanked: eligible.length,
			minPlaysToRank: MIN_PLAYS_TO_RANK
		};
	}
}));
