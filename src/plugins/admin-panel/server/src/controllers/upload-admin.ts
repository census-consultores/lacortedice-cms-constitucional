/**
 * Controller para administrar uploads desde el panel admin de la webapp.
 *
 * El plugin nativo `upload` de Strapi requiere que el rol del usuario tenga
 * el permiso `plugin::upload.destroy` para borrar archivos via
 * `DELETE /api/upload/files/:id`. En este proyecto NO le damos ese permiso al
 * rol "Authenticated" (todos los usuarios logueados) porque dejaría que
 * cualquiera borre cualquier archivo desde la API pública.
 *
 * En cambio, exponemos un endpoint paralelo aquí (en el plugin admin-panel)
 * protegido por la policy `isAdmin` — solo admin/superadmin pueden borrar
 * archivos. Es el mismo patrón que ya usamos para CRUD de causas/casaciones.
 *
 * Endpoint:
 *   DELETE /api/admin-panel/upload/files/:id
 *
 * Semántica: idempotente. Si el archivo ya no existe, responde 200 con
 * `alreadyGone: true` para que los flows de cleanup (reemplazo/borrado de
 * PDF en CausaForm/CasacionForm) no fallen por una doble llamada.
 */

type Ctx = any;

export default ({ strapi }) => ({
  /**
   * Sube uno o varios archivos al Upload library, vía nuestro proxy admin.
   * Igual que `deleteFile`, este endpoint reemplaza la llamada directa al
   * `/api/upload` nativo de Strapi para no requerir que el rol Authenticated
   * tenga `plugin::upload.upload` (que abriría la subida a cualquier usuario
   * logueado). Aquí lo protegemos con la policy `isAdmin`.
   *
   * El cliente envía `multipart/form-data` con campo `files`. El middleware
   * `strapi::body` parsea el multipart y deja los archivos en
   * `ctx.request.files`. Delegamos al service `upload` del plugin para que
   * persista en disco + cree la fila en `files`.
   */
  async uploadFile(ctx: Ctx) {
    // Strapi mete los archivos del multipart en ctx.request.files. Acepta
    // tanto `files` como un campo plural; el cliente actual (upload-pdf del
    // webapp) envía con el nombre `files`.
    const filesRaw = ctx.request.files?.files ?? ctx.request.files?.['files'];
    if (!filesRaw) {
      return ctx.badRequest('No se recibió ningún archivo (campo "files")');
    }
    const filesArr = Array.isArray(filesRaw) ? filesRaw : [filesRaw];

    // Subdirectorio opcional via ?path=...  El provider local de Strapi 5
    // respeta `file.path` y guarda en `public/uploads/<path>/...`, además
    // de ajustar `file.url` para incluir el subpath. Sin query, archivos
    // van a la raíz (comportamiento legacy para PDFs).
    //
    // Sanitización: dejamos pasar SOLO `[a-z0-9/_-]+` y rechazamos `..`
    // para evitar path traversal hacia afuera de public/uploads.
    const rawPath = (ctx.query?.path ?? '').toString().trim();
    let subPath: string | null = null;
    if (rawPath) {
      if (rawPath.includes('..') || !/^[a-z0-9][a-z0-9/_-]*$/i.test(rawPath)) {
        return ctx.badRequest(`path inválido: ${rawPath}`);
      }
      subPath = rawPath.replace(/^\/+|\/+$/g, '');
    }

    try {
      // Inyectamos `file.path` antes de delegar al service; eso llega al
      // provider y crea/usa el subdirectorio. Para cada archivo (multi
      // upload), aplicamos el mismo subdir.
      if (subPath) {
        for (const f of filesArr) {
          (f as any).path = subPath;
        }
      }

      const uploaded = await strapi
        .plugin('upload')
        .service('upload')
        .upload({ data: {}, files: filesArr });
      ctx.body = uploaded;
    } catch (err: any) {
      strapi.log.error(`[admin-panel.uploadFile] failed: ${err?.message ?? err}`);
      return ctx.internalServerError(err?.message ?? 'No se pudo subir el archivo.');
    }
  },

  async deleteFile(ctx: Ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return ctx.badRequest('id de archivo inválido');
    }

    // Buscar la fila en `files`. En Strapi 5 el plugin upload usa el modelo
    // `plugin::upload.file`. Si no existe, devolvemos 200 con alreadyGone
    // para que los flows de cleanup (forms reemplazando PDF) sean idempotentes.
    const file = await strapi
      .query('plugin::upload.file')
      .findOne({ where: { id } });

    if (!file) {
      ctx.body = { deleted: false, alreadyGone: true };
      return;
    }

    try {
      // service('upload').remove(file) borra el blob del provider (disco/S3)
      // Y la fila en `files`. También limpia `files_related_mph` por nosotros.
      await strapi.plugin('upload').service('upload').remove(file);
      ctx.body = { deleted: true, id };
    } catch (err: any) {
      strapi.log.error(
        `[admin-panel.deleteFile] file ${id} failed: ${err?.message ?? err}`
      );
      return ctx.internalServerError(
        err?.message ?? 'No se pudo borrar el archivo.'
      );
    }
  },
});
