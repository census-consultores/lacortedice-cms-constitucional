/**
 * Qué pasa cuando alguien denuncia algo en el Debate.
 *
 * La guía 1.2 de Apple no pide solo un botón de denuncia: pide actuar sobre
 * el contenido denunciado. Antes la denuncia se guardaba y ahí quedaba, a la
 * espera de que un administrador entrara por su cuenta a la cola — el
 * contenido seguía visible mientras tanto y nadie se enteraba.
 *
 * Ahora, al recibir una denuncia:
 *   · si dos personas DISTINTAS denunciaron lo mismo, se oculta al instante
 *     (el admin puede restaurarlo desde la cola si fue un abuso del botón);
 *   · se avisa a los administradores con un push, con enlace a la cola.
 *
 * Todo es "mejor esfuerzo": nada de esto puede tumbar la denuncia en sí.
 */
import { emitir } from './push-emisores';

type Core = any;

/** Denuncias de usuarios distintos que ocultan automáticamente. */
const UMBRAL_OCULTAR = 2;

const UID_POR_TIPO: Record<string, string> = {
	tema: 'api::tribuna-tema.tribuna-tema',
	comentario: 'api::tribuna-comentario.tribuna-comentario'
};

export async function autoOcultarPorDenuncias(
	strapi: Core,
	tipo: 'tema' | 'comentario',
	objetivoDocumentId: string
): Promise<void> {
	try {
		const denuncias = await strapi.db
			.query('api::tribuna-denuncia.tribuna-denuncia')
			.findMany({
				where: { tipo, objetivoDocumentId, estado: 'pendiente' },
				populate: { user: { select: ['id'] } },
				limit: 50
			});
		const distintos = new Set(
			denuncias.map((d: any) => d.user?.id).filter(Boolean) as number[]
		);
		if (distintos.size < UMBRAL_OCULTAR) return;

		await strapi.db
			.query(UID_POR_TIPO[tipo])
			.update({ where: { documentId: objetivoDocumentId }, data: { estado: 'oculto' } });
		strapi.log.info(
			`[tribuna] ${tipo} ${objetivoDocumentId} oculto automáticamente (${distintos.size} denuncias)`
		);
	} catch (e: any) {
		strapi.log.error('[tribuna.autoOcultar] ' + (e?.message ?? e));
	}
}

export async function avisarDenunciaAAdmins(
	strapi: Core,
	tipo: 'tema' | 'comentario',
	objetivoDocumentId: string,
	motivo: string
): Promise<void> {
	try {
		const admins = await strapi.db.query('plugin::users-permissions.user').findMany({
			where: { userRole: { $in: ['admin', 'superadmin'] }, blocked: false },
			select: ['id'],
			limit: 50
		});
		const ids = admins.map((a: any) => a.id);
		if (ids.length === 0) return;

		await emitir(strapi, ids, {
			titulo: 'Contenido denunciado en el Debate ⚑',
			cuerpo: `${tipo === 'tema' ? 'Un tema' : 'Un comentario'} fue denunciado${
				motivo ? `: ${motivo.slice(0, 90)}` : ''
			}`,
			// El aviso llega al TELÉFONO del admin y /admin/* no se empaqueta en
			// el binario (ver scripts/prepare-mobile-routes.mjs): tocar la
			// notificación abría una ruta inexistente. La moderación del Debate
			// se hace desde el propio hilo, que sí viaja en la app.
			data: { url: tipo === 'tema' ? `/tribuna/${objetivoDocumentId}` : '/tribuna' },
			threadId: 'moderacion'
		});
	} catch (e: any) {
		strapi.log.error('[tribuna.avisarDenuncia] ' + (e?.message ?? e));
	}
}
