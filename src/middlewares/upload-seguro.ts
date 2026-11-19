/**
 * Candado de /api/upload para usuarios NO administradores.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────
 * La foto de perfil se sube con el JWT del propio usuario, así que el rol
 * `authenticated` tiene concedida la action `plugin::upload.content-api.upload`
 * (bootstrap 2.58). El plugin de Strapi, por defecto, NO limita el tipo de
 * archivo y acepta hasta 1 GB: con ese permiso, cualquier registrado podía
 * subir un .html o un .js y quedaba servido desde el MISMO origen que el
 * panel de administración — XSS almacenado con acceso a la sesión del admin,
 * más alojamiento gratuito de lo que se le ocurriera.
 *
 * Las validaciones del BFF (`/api/upload-avatar`: solo JPG/PNG/WebP/GIF,
 * máx. 2 MB, nombre saneado) viven en la webapp y se saltan llamando al CMS
 * directamente. Este middleware las vuelve a aplicar EN EL SERVIDOR, que es
 * donde no se pueden esquivar.
 *
 * A los administradores no se les toca: el panel sube PDFs de sentencias,
 * imágenes de eventos y otros formatos legítimos.
 */
import type { Core } from '@strapi/strapi';

/** Lo único que un usuario común necesita subir: su foto. */
const TIPOS_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXTENSIONES_PERMITIDAS = /\.(jpe?g|png|webp|gif)$/i;
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB — la app ya recorta a 400×400

/**
 * Firma real del archivo. El `Content-Type` y la extensión los pone quien
 * sube, así que se comprueba además el encabezado de los bytes: un .png que
 * por dentro es HTML no pasa.
 */
function pareceImagen(buf: Buffer): boolean {
	if (buf.length < 12) return false;
	// JPEG FF D8 FF · PNG 89 50 4E 47 · GIF 'GIF8' · WebP 'RIFF'…'WEBP'
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
	if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return true;
	if (
		buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
		buf.subarray(8, 12).toString('ascii') === 'WEBP'
	)
		return true;
	return false;
}

const ROLES_ADMIN = new Set(['admin', 'superadmin']);

/**
 * ¿La petición viene autenticada con un API Token de Strapi (no un JWT de
 * usuario)? El extractor de sentencias sube los PDF y las fichas Word con el
 * API Token de servicio (full-access), no con un JWT de users-permissions, así
 * que `rolDelBearer` no lo reconoce como admin y caía en el candado de "solo
 * imágenes". Un usuario común NO posee este token (es un secreto del servidor),
 * por lo que dejar pasar a quien lo presenta no debilita la protección.
 *
 * Los API tokens se guardan hasheados (HMAC-SHA512 con `admin.apiToken.salt`),
 * así que se hashea el Bearer y se busca la coincidencia en `admin::api-token`.
 */
async function esApiTokenValido(ctx: any, strapi: Core.Strapi): Promise<boolean> {
	try {
		const cabecera = String(ctx.request?.header?.authorization ?? '');
		if (!cabecera.toLowerCase().startsWith('bearer ')) return false;
		const token = cabecera.slice(7).trim();
		if (!token) return false;
		const salt = strapi.config.get('admin.apiToken.salt') as string | undefined;
		if (!salt) return false;
		const { createHmac } = await import('node:crypto');
		const hash = createHmac('sha512', salt).update(token).digest('hex');
		const encontrado = await strapi.db
			.query('admin::api-token')
			.findOne({ where: { accessKey: hash }, select: ['id'] });
		return Boolean(encontrado);
	} catch {
		return false;
	}
}

/**
 * Rol del que hace la petición, resuelto desde el Bearer.
 *
 * No sirve `ctx.state.user`: los middlewares globales corren ANTES de la
 * autenticación de la ruta, así que en este punto siempre está vacío. Sin
 * esto, la excepción para administradores no se aplicaría nunca y el panel
 * dejaría de poder subir PDFs de sentencias.
 *
 * Cualquier fallo (sin cabecera, token inválido, usuario borrado) devuelve
 * undefined y la petición sigue por el camino estricto.
 */
async function rolDelBearer(ctx: any, strapi: Core.Strapi): Promise<string | undefined> {
	try {
		const cabecera = String(ctx.request?.header?.authorization ?? '');
		if (!cabecera.toLowerCase().startsWith('bearer ')) return undefined;
		const token = cabecera.slice(7).trim();
		if (!token) return undefined;
		const payload: any = await strapi.plugin('users-permissions').service('jwt').verify(token);
		if (!payload?.id) return undefined;
		const usuario = await strapi.db.query('plugin::users-permissions.user').findOne({
			where: { id: payload.id },
			select: ['id', 'userRole'],
		});
		return usuario?.userRole;
	} catch {
		return undefined;
	}
}

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
	return async (ctx: any, next: any) => {
		const esUpload =
			ctx.request?.method === 'POST' && String(ctx.request?.url ?? '').startsWith('/api/upload');
		if (!esUpload) return next();

		// El panel de Strapi va por /admin/... y trae su propia sesión; y los
		// usuarios con rol admin del producto pueden subir lo que necesiten.
		const rol = ctx.state?.user?.userRole ?? (await rolDelBearer(ctx, strapi));
		if (rol && ROLES_ADMIN.has(rol)) return next();

		// El extractor sube PDFs/Word con el API Token de servicio (full-access):
		// se le permite subir cualquier formato legítimo, igual que a un admin.
		if (await esApiTokenValido(ctx, strapi)) return next();

		const crudos = ctx.request?.files?.files ?? ctx.request?.files?.['files'];
		const archivos = Array.isArray(crudos) ? crudos : crudos ? [crudos] : [];
		if (archivos.length === 0) return next();

		// Un usuario común sube su foto: de a uno.
		if (archivos.length > 1) {
			return ctx.badRequest('Solo se puede subir un archivo a la vez.');
		}

		for (const f of archivos) {
			const tipo = String(f?.mimetype ?? f?.type ?? '').toLowerCase();
			const nombre = String(f?.originalFilename ?? f?.name ?? '');
			const tam = Number(f?.size ?? 0);

			if (!TIPOS_PERMITIDOS.has(tipo) || !EXTENSIONES_PERMITIDAS.test(nombre)) {
				strapi.log.warn(
					`[upload-seguro] rechazado tipo "${tipo}" (${nombre}) de user ${ctx.state?.user?.id ?? 'anon'}`
				);
				return ctx.badRequest('Solo se permiten imágenes JPG, PNG, WebP o GIF.');
			}
			if (tam > MAX_BYTES) {
				return ctx.payloadTooLarge('La imagen no puede pesar más de 3 MB.');
			}

			// Firma real de los bytes (lee solo la cabecera del archivo temporal).
			try {
				const ruta = f?.filepath ?? f?.path;
				if (ruta) {
					const { open } = await import('node:fs/promises');
					const fh = await open(ruta, 'r');
					const buf = Buffer.alloc(12);
					await fh.read(buf, 0, 12, 0);
					await fh.close();
					if (!pareceImagen(buf)) {
						strapi.log.warn(`[upload-seguro] firma no es de imagen: ${nombre}`);
						return ctx.badRequest('El archivo no es una imagen válida.');
					}
				}
			} catch (e: any) {
				strapi.log.error('[upload-seguro] no se pudo leer la firma: ' + (e?.message ?? e));
				return ctx.badRequest('No se pudo verificar el archivo.');
			}
		}

		return next();
	};
};
