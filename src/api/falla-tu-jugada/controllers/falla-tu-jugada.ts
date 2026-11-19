/**
 * Controllers del content-type `falla-tu-jugada`.
 *
 * Endpoints custom:
 *   POST /falla-tu-jugadas/mia      → registra jugada del user autenticado
 *   GET  /falla-tu-jugadas/mis-stats → stats del user desde la BD
 *   GET  /falla-tu-jugadas/leaderboard?period=&limit= → ranking global
 *
 * SRP: validan input + delegan al service. Sin lógica de negocio.
 */

import { factories } from '@strapi/strapi';

type Ctx = any;

function isValidDecision(v: any): v is 'C' | 'CP' | 'NC' {
	return v === 'C' || v === 'CP' || v === 'NC';
}

export default factories.createCoreController('api::falla-tu-jugada.falla-tu-jugada', ({ strapi }) => ({
	async crearMia(ctx: Ctx) {
		const userId = ctx.state.user?.id;
		if (!userId) return ctx.unauthorized();

		const body = ctx.request.body ?? {};
		const {
			caseDocumentId,
			decision,
			confidence,
			correct,
			brierScore,
			playedAt,
			dayKey
		} = body;

		if (typeof caseDocumentId !== 'string' || !caseDocumentId) {
			return ctx.badRequest('caseDocumentId requerido');
		}
		if (!isValidDecision(decision)) {
			return ctx.badRequest('decision debe ser C, CP o NC');
		}
		const conf = Number(confidence);
		if (!Number.isInteger(conf) || conf < 1 || conf > 3) {
			return ctx.badRequest('confidence debe ser 1, 2 o 3');
		}
		const brier = Number(brierScore);
		if (!Number.isFinite(brier) || brier < 0 || brier > 1) {
			return ctx.badRequest('brierScore debe estar entre 0 y 1');
		}
		if (typeof playedAt !== 'string' || !playedAt) {
			return ctx.badRequest('playedAt requerido');
		}
		if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
			return ctx.badRequest('dayKey debe tener formato YYYY-MM-DD');
		}

		// Defensa contra re-submits: solo se permite UNA jugada del mismo
		// usuario para el mismo case+day. La webapp ya bloquea esto en
		// `/falla-tu/+page.server.ts` revisando la cookie, pero si alguien
		// pega curl directo (o pierde su cookie y vuelve a jugar el mismo
		// caso del día), evitamos inflar el score con duplicados.
		const existente = await strapi.db
			.query('api::falla-tu-jugada.falla-tu-jugada')
			.findOne({
				where: {
					user: userId,
					caseDocumentId,
					dayKey
				},
				select: ['id']
			});
		if (existente) {
			ctx.status = 409;
			return {
				ok: false,
				error: 'jugada-duplicada',
				message: 'Ya registraste tu decisión para este caso en este día.'
			};
		}

		const created = await strapi
			.service('api::falla-tu-jugada.falla-tu-jugada')
			.registrar(userId, {
				caseDocumentId,
				decision,
				confidence: conf,
				correct: !!correct,
				brierScore: brier,
				playedAt,
				dayKey
			});

		return { ok: true, id: (created as any).id };
	},

	async misStats(ctx: Ctx) {
		const userId = ctx.state.user?.id;
		if (!userId) return ctx.unauthorized();

		const stats = await strapi
			.service('api::falla-tu-jugada.falla-tu-jugada')
			.statsDeUsuario(userId);
		return stats;
	},

	async leaderboard(ctx: Ctx) {
		const userId = ctx.state.user?.id ?? undefined;
		const period = (ctx.query.period as string) ?? 'all';
		const limit = Number(ctx.query.limit ?? 50);

		const validPeriod = ['all', 'month', 'week'].includes(period)
			? (period as 'all' | 'month' | 'week')
			: 'all';

		const result = await strapi
			.service('api::falla-tu-jugada.falla-tu-jugada')
			.leaderboard({
				period: validPeriod,
				limit,
				currentUserId: userId
			});
		return result;
	}
}));
