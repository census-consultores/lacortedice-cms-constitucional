/**
 * Controllers de la Tribuna Tributaria · temas (hilos).
 *
 * Reglas:
 *   - Todo requiere sesión (rol authenticated; permisos concedidos en el
 *     bootstrap de src/index.ts).
 *   - Cualquier usuario registrado lee y publica. Publicación directa.
 *   - Los temas `oculto` no se listan ni se abren (solo un admin los ve
 *     desde la moderación).
 *   - Anti-spam: máximo TEMAS_POR_DIA temas por usuario por día.
 */

import { factories } from '@strapi/strapi';
import { notificarTemaNuevo } from '../../../utils/push-emisores';
import { revisarContenido } from '../../../utils/moderacion';

type Ctx = any;

const TEMAS_POR_DIA = 10;
const PAGE_SIZE = 20;

export function esAdmin(user: any): boolean {
	return user?.userRole === 'admin' || user?.userRole === 'superadmin';
}

/**
 * Nombre visible del autor en el Debate: nombres + apellidos del perfil.
 * El username (a veces un solo nombre o un alias) queda solo como fallback
 * para publicaciones viejas de perfiles incompletos.
 */
export function nombreCompleto(u: any): string {
	const completo = [u?.firstName, u?.lastName]
		.map((s: unknown) => String(s ?? '').trim())
		.filter(Boolean)
		.join(' ');
	return completo || u?.username || 'Usuario';
}

/**
 * Foto del autor para el Debate. Solo URLs http(s) — `picture` es texto
 * libre en el perfil y un `javascript:`/`data:` ahí terminaría pintado en
 * el `src` de un <img> de todos los lectores del hilo.
 */
export function fotoDe(u: any): string | null {
	const url = String(u?.picture ?? '').trim();
	return /^https:\/\/|^http:\/\//i.test(url) ? url : null;
}

/** Campos del usuario que necesita el Debate para mostrar autores. */
export const USER_AUTOR = ['id', 'username', 'firstName', 'lastName', 'picture'];

/**
 * Regla del Debate: quien publica debe verse con su nombre y su apellido,
 * sin importar la vía por la que entró (correo, Apple, admin). Devuelve el
 * mensaje de error si el perfil no cumple, o null si está bien.
 */
export async function faltaNombreCompleto(strapi: any, userId: number): Promise<string | null> {
	const u = await strapi.db
		.query('plugin::users-permissions.user')
		.findOne({ where: { id: userId }, select: ['firstName', 'lastName'] });
	const nombres = String(u?.firstName ?? '').trim();
	const apellidos = String(u?.lastName ?? '').trim();
	if (!nombres || !apellidos) {
		return 'Para publicar en el Debate, completa tu nombre y tu apellido en Mi cuenta → Identidad.';
	}
	// Se exige nombre Y apellido, no "dos apellidos": fuera de Ecuador un solo
	// apellido es lo normal (y un revisor de Apple llamado "John Smith" no
	// podía publicar, lo que dejaba sin probar justo la parte del producto que
	// más se inspecciona). El pedido de John —que se vea quién habla— se
	// cumple igual: nadie publica con un solo nombre ni con un alias.
	return null;
}

/**
 * Materias (categorías) de las causas referidas por un lote de temas:
 * documentId de causa → nombres. El Debate las muestra bajo el título en
 * reemplazo del cuerpo autogenerado "Hilo para debatir…".
 */
export async function categoriasDeCausas(
	strapi: any,
	slugs: string[]
): Promise<Map<string, string[]>> {
	const mapa = new Map<string, string[]>();
	const unicos = [...new Set(slugs.filter(Boolean))];
	if (unicos.length === 0) return mapa;
	const causas: any[] = await strapi.db.query('api::causa.causa').findMany({
		where: { documentId: { $in: unicos }, publishedAt: { $notNull: true } },
		select: ['documentId'],
		populate: { categorias: { select: ['nombre'] } },
		limit: unicos.length * 2
	});
	for (const c of causas) {
		const nombres = (c.categorias ?? []).map((x: any) => x.nombre).filter(Boolean);
		if (nombres.length) mapa.set(c.documentId, nombres);
	}
	return mapa;
}

/** Normaliza texto de usuario: recorta espacios y limita longitud. */
export function textoLimpio(v: unknown, max: number): string {
	return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function inicioDelDia(): Date {
	const d = new Date();
	d.setUTCHours(d.getUTCHours() - 5); // día calendario de Ecuador
	d.setUTCHours(5, 0, 0, 0); // 00:00 Guayaquil expresado en UTC
	if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
	return d;
}

/**
 * Silenciamiento entre usuarios (Guideline 1.2 de Apple: toda app con
 * contenido de usuarios debe permitir bloquear a usuarios abusivos).
 * La lista de ids silenciados por cada usuario vive en el core store; los
 * listados y el detalle filtran esas publicaciones como si no existieran.
 */
async function idsSilenciados(strapi: any, userId: number): Promise<number[]> {
	const v = await strapi.store({ type: 'plugin', name: 'admin-panel' }).get({ key: `tribuna-mute:${userId}` });
	return Array.isArray(v) ? v.filter((x: any) => Number.isInteger(x)) : [];
}
/**
 * Ocultar a una persona oculta SUS COMENTARIOS, y nada más.
 *
 * El tema no se toca: es la discusión de una causa, no la expresión personal
 * de quien la abrió, y taparlo (o peor, esconderlo) se llevaba por delante la
 * conversación de todos los demás. Antes se excluía del listado y el detalle
 * respondía 404; después se mostraba con el título reemplazado. Las dos cosas
 * estaban mal: el hilo no tiene nada que ver con a quién decidí no leer.
 *
 * Para el contenido abusivo de un tema están «Denunciar» y la moderación de
 * administradores, que sí lo retiran para todo el mundo.
 */
async function guardarSilenciados(strapi: any, userId: number, ids: number[]): Promise<void> {
	await strapi.store({ type: 'plugin', name: 'admin-panel' }).set({ key: `tribuna-mute:${userId}`, value: ids.slice(0, 500) });
}

export default factories.createCoreController('api::tribuna-tema.tribuna-tema', ({ strapi }) => ({
	/** GET /tribuna/temas?page=1 — lista de hilos visibles, más recientes en actividad primero. */
	async listar(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();

		const page = Math.max(1, Math.min(200, Number(ctx.query?.page) || 1));
		const q = textoLimpio(ctx.query?.q, 120);

		const where: any = { estado: 'visible' };
		if (q) where.titulo = { $containsi: q };
		// ?expediente=<slug>: los temas atados a una causa concreta (el botón
		// "Debatir" del expediente pregunta por acá si el caso ya tiene hilo).
		const expediente = textoLimpio(ctx.query?.expediente, 200);
		if (expediente) where.expedienteSlug = expediente;
		// Los temas se listan siempre, sin importar a quién tenga oculto:
		// excluirlos borraba hilos enteros con los comentarios de todo el
		// mundo. El silenciamiento solo recorta los comentarios.
		const silenciados = await idsSilenciados(strapi, user.id);

		const [temas, total] = await Promise.all([
			strapi.db.query('api::tribuna-tema.tribuna-tema').findMany({
				where,
				orderBy: [{ ultimaActividadAt: 'desc' }, { createdAt: 'desc' }],
				offset: (page - 1) * PAGE_SIZE,
				limit: PAGE_SIZE,
				populate: { user: { select: USER_AUTOR } }
			}),
			strapi.db.query('api::tribuna-tema.tribuna-tema').count({ where })
		]);

		// Materias de las causas referidas (para TODOS los temas de casos,
		// también los viejos: se resuelven al vuelo, no se guardan en el tema).
		const categoriasPorCausa = await categoriasDeCausas(
			strapi,
			temas.map((t: any) => t.expedienteSlug)
		);

		const filas = await Promise.all(
			temas.map(async (t: any) => ({
				documentId: t.documentId,
				titulo: t.titulo,
				cuerpo: (t.cuerpo ?? '').slice(0, 240),
				expedienteSlug: t.expedienteSlug ?? null,
				categorias: t.expedienteSlug ? (categoriasPorCausa.get(t.expedienteSlug) ?? []) : [],
				autor: nombreCompleto(t.user),
				autorFoto: fotoDe(t.user),
				creadoEn: t.createdAt,
				ultimaActividadAt: t.ultimaActividadAt ?? t.createdAt,
				comentarios: await strapi.db
					.query('api::tribuna-comentario.tribuna-comentario')
					.count({
						where: {
							tema: { id: t.id },
							estado: 'visible',
							// Mismo filtro que el detalle: sin esto el listado
							// anunciaba «9 comentarios» y el hilo mostraba 7,
							// delatando el contenido que el propio usuario ocultó.
							...(silenciados.length ? { user: { id: { $notIn: silenciados } } } : {})
						}
					})
			}))
		);

		ctx.body = { ok: true, page, pageSize: PAGE_SIZE, total, temas: filas };
	},

	/** POST /tribuna/temas {titulo, cuerpo?, expedienteSlug?} */
	async crear(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();

		const body = ctx.request.body ?? {};
		const titulo = textoLimpio(body.titulo, 180);
		const cuerpo = textoLimpio(body.cuerpo, 5000);
		const expedienteSlug = textoLimpio(body.expedienteSlug, 200) || null;
		if (titulo.length < 5) return ctx.badRequest('El título debe tener al menos 5 caracteres');

		// Autores con nombre y apellidos completos, siempre.
		const faltaNombre = await faltaNombreCompleto(strapi, user.id);
		if (faltaNombre) return ctx.badRequest(faltaNombre);

		// Un caso, un hilo: si la causa ya tiene tema visible, se devuelve ese
		// en lugar de crear un duplicado (dos personas tocando "Debatir" a la
		// vez terminan en la misma conversación).
		if (expedienteSlug) {
			const existente = await strapi.db.query('api::tribuna-tema.tribuna-tema').findOne({
				where: { expedienteSlug, estado: 'visible' }
			});
			if (existente) {
				ctx.body = { ok: true, documentId: existente.documentId, existente: true };
				return;
			}
		}

		const hoy = await strapi.db.query('api::tribuna-tema.tribuna-tema').count({
			where: { user: { id: user.id }, createdAt: { $gte: inicioDelDia() } }
		});
		if (hoy >= TEMAS_POR_DIA) {
			return ctx.badRequest(`Máximo ${TEMAS_POR_DIA} temas por día — sigue la conversación en los que ya abriste`);
		}

		// Filtro de contenido ANTES de publicar (Apple 1.2): lo ofensivo no
		// entra, y lo dudoso entra pero queda marcado para revisión.
		const veredicto = revisarContenido(cuerpo, titulo);
		if (veredicto.accion === 'bloquear') {
			strapi.log.warn(`[tribuna] tema bloqueado (user ${user.id}): ${veredicto.motivo}`);
			return ctx.badRequest(veredicto.mensaje);
		}

		const creado = await strapi.db.query('api::tribuna-tema.tribuna-tema').create({
			data: {
				user: user.id,
				titulo,
				cuerpo,
				expedienteSlug,
				estado: 'visible',
				ultimaActividadAt: new Date()
			}
		});

		// A revisión: se publica, pero entra a la cola con una denuncia del
		// propio sistema para que un admin lo mire.
		if (veredicto.accion === 'revisar') {
			await strapi.db
				.query('api::tribuna-denuncia.tribuna-denuncia')
				.create({
					data: {
						tipo: 'tema',
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
		// Push en segundo plano: tema nuevo (+ variante favoritos del caso).
		notificarTemaNuevo(strapi, { documentId: creado.documentId, titulo, expedienteSlug }, user.id);
		ctx.body = { ok: true, documentId: creado.documentId };
	},

	/** GET /tribuna/temas/:documentId — el hilo completo con sus comentarios visibles. */
	async detalle(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();

		const documentId = textoLimpio(ctx.params?.documentId, 64);
		const tema = await strapi.db.query('api::tribuna-tema.tribuna-tema').findOne({
			where: { documentId },
			populate: { user: { select: USER_AUTOR } }
		});
		if (!tema || (tema.estado !== 'visible' && !esAdmin(user))) {
			return ctx.notFound('Tema no encontrado');
		}
		// El tema se devuelve entero aunque su autor esté oculto. Lo único que
		// se recorta son sus comentarios, abajo.
		const silenciados = await idsSilenciados(strapi, user.id);

		const comentarios = await strapi.db
			.query('api::tribuna-comentario.tribuna-comentario')
			.findMany({
				where: {
					tema: { id: tema.id },
					...(esAdmin(user) ? {} : { estado: 'visible' }),
					...(silenciados.length ? { user: { id: { $notIn: silenciados } } } : {})
				},
				orderBy: { createdAt: 'asc' },
				limit: 500,
				populate: { user: { select: USER_AUTOR } }
			});

		// Materias del caso referido (chips bajo el título en la app).
		const categoriasPorCausa = await categoriasDeCausas(
			strapi,
			tema.expedienteSlug ? [tema.expedienteSlug] : []
		);

		ctx.body = {
			ok: true,
			tema: {
				documentId: tema.documentId,
				titulo: tema.titulo,
				cuerpo: tema.cuerpo ?? '',
				expedienteSlug: tema.expedienteSlug ?? null,
				categorias: tema.expedienteSlug
					? (categoriasPorCausa.get(tema.expedienteSlug) ?? [])
					: [],
				estado: tema.estado,
				autor: nombreCompleto(tema.user),
				autorFoto: fotoDe(tema.user),
				autorId: tema.user?.id ?? null,
				esMio: tema.user?.id === user.id,
				creadoEn: tema.createdAt
			},
			comentarios: comentarios.map((c: any) => ({
				documentId: c.documentId,
				cuerpo: c.cuerpo,
				estado: c.estado,
				autor: nombreCompleto(c.user),
				autorFoto: fotoDe(c.user),
				esMio: c.user?.id === user.id,
				creadoEn: c.createdAt
			}))
		};
	},

	/**
	 * POST /tribuna/silenciar { tipo: 'tema'|'comentario', documentId }
	 * Alterna el silenciamiento del AUTOR de esa publicación para el usuario
	 * actual. No expone ids de usuario: el server resuelve el autor. Devuelve
	 * { ok, silenciado, autor } para el mensaje de confirmación.
	 */
	async silenciar(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();

		const tipo = textoLimpio(ctx.request.body?.tipo, 12);
		const documentId = textoLimpio(ctx.request.body?.documentId, 64);
		if (!documentId || (tipo !== 'tema' && tipo !== 'comentario')) {
			return ctx.badRequest('parametros_invalidos');
		}

		const uid =
			tipo === 'tema'
				? 'api::tribuna-tema.tribuna-tema'
				: 'api::tribuna-comentario.tribuna-comentario';
		const pub = await strapi.db.query(uid).findOne({
			where: { documentId },
			// USER_AUTOR y no ['id','username']: sin firstName/lastName,
			// nombreCompleto caía al username y el aviso decía «John Arias»
			// donde el resto de la app dice «John Arias Izquierdo».
			populate: { user: { select: USER_AUTOR } }
		});
		if (!pub?.user?.id) return ctx.notFound('Publicación no encontrada');
		if (pub.user.id === user.id) return ctx.badRequest('no_puedes_silenciarte');

		const lista = await idsSilenciados(strapi, user.id);
		const ya = lista.includes(pub.user.id);
		const nueva = ya ? lista.filter((x) => x !== pub.user.id) : [...lista, pub.user.id];
		await guardarSilenciados(strapi, user.id, nueva);

		strapi.log.info(
			`[tribuna] ${user.username} ${ya ? 'des-silenció' : 'silenció'} a ${pub.user.username}`
		);
		// autorId: el detalle del tema ya expone `autorId`, así que esto no
		// revela nada nuevo, y le permite a la app saber si acaba de ocultar
		// justamente a quien escribió el hilo en el que está parada.
		ctx.body = {
			ok: true,
			silenciado: !ya,
			autor: nombreCompleto(pub.user),
			autorId: pub.user.id
		};
	},

	/**
	 * GET /tribuna/silenciados — a quién tengo oculto.
	 *
	 * Sin esto, ocultar era una puerta de una sola vía: al desaparecer TODAS
	 * las publicaciones de esa persona, no queda ninguna donde volver a tocar
	 * el botón, y el bloqueo no se podía revertir nunca.
	 */
	async silenciados(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();

		const ids = await idsSilenciados(strapi, user.id);
		if (!ids.length) return (ctx.body = { ok: true, usuarios: [] });

		const filas = await strapi.db.query('plugin::users-permissions.user').findMany({
			where: { id: { $in: ids } },
			select: USER_AUTOR
		});
		ctx.body = {
			ok: true,
			usuarios: filas.map((u: any) => ({
				id: u.id,
				nombre: nombreCompleto(u),
				foto: fotoDe(u)
			}))
		};
	},

	/**
	 * POST /tribuna/mostrar { id } — vuelve a mostrar a alguien que oculté.
	 *
	 * Sólo QUITA de mi propia lista: un id que no esté ahí se rechaza, así
	 * que este endpoint no sirve para ocultar a nadie ni para saber quién
	 * existe. Ocultar sigue siendo /tribuna/silenciar, que resuelve el autor
	 * a partir de una publicación y nunca recibe ids.
	 */
	async mostrar(ctx: Ctx) {
		const user = ctx.state.user;
		if (!user?.id) return ctx.unauthorized();

		const id = Number(ctx.request.body?.id);
		if (!Number.isInteger(id)) return ctx.badRequest('parametros_invalidos');

		const lista = await idsSilenciados(strapi, user.id);
		if (!lista.includes(id)) return ctx.badRequest('no_esta_oculto');

		await guardarSilenciados(strapi, user.id, lista.filter((x) => x !== id));
		strapi.log.info(`[tribuna] ${user.username} volvió a mostrar al usuario ${id}`);
		ctx.body = { ok: true };
	}
}));
