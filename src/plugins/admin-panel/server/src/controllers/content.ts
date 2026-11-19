/**
 * Controller para CRUD de contenido jurídico desde el panel admin.
 *
 * Reemplaza el flujo anterior donde la webapp pegaba directo a los endpoints
 * estándar de Strapi (`POST /causas`, `PUT /casaciones/:id`, etc.) con el JWT
 * del admin. Ese flujo requería abrir `create`/`update`/`delete` en el rol
 * "Authenticated" del plugin users-permissions, lo que abría esos endpoints
 * a CUALQUIER usuario logueado (no solo admins).
 *
 * Ahora los endpoints viven aquí, protegidos por la policy
 * `plugin::admin-panel.isAdmin`, y el rol "Authenticated" queda con solo
 * `find`/`findOne` (lectura pública del producto).
 *
 * Rutas (definidas en routes/content-api.ts):
 *   POST   /api/admin-panel/content/:collection
 *   PUT    /api/admin-panel/content/:collection/:documentId
 *   DELETE /api/admin-panel/content/:collection/:documentId
 *
 * El `:collection` es el pluralName del content-type (igual que en la URL
 * estándar de Strapi REST), y se resuelve al UID interno via COLLECTION_MAP.
 */

type Ctx = any;

const COLLECTION_MAP: Record<string, string> = {
  causas: 'causa',
  casaciones: 'casacion',
  jueces: 'juez',
  tribunales: 'tribunal',
  abogados: 'abogado',
  entidades: 'entidad',
  categorias: 'categoria',
  'estado-del-juicios': 'estado-del-juicio',
  'tipo-de-accions': 'tipo-de-accion',
  'causales-invocadas': 'causal-invocada',
  'decision-finals': 'decision-final',
  'decisiones-finales-casacion': 'decision-final-casacion',
  recurrentes: 'recurrente',
  eventos: 'evento',
};

function resolveUid(collection: string): string | null {
  const singular = COLLECTION_MAP[collection];
  return singular ? `api::${singular}.${singular}` : null;
}

/**
 * Campos UNIQUE por colección sobre los que pre-validamos duplicación
 * ANTES de tocar la BD. Sin esto, el constraint UNIQUE de Postgres
 * dispara cuando ya pasó update() del draft → desync irrecuperable.
 *
 * Solo listamos colecciones cuyo campo UNIQUE es semánticamente crítico
 * (un duplicado rompe el modelo del dominio). Para otras colecciones
 * con UNIQUE (jueces.nombre, tribunales.nombre, etc.) confiamos en el
 * constraint de BD — son catálogos editados manualmente, raro que dupliquen.
 */
const UNIQUE_FIELDS: Record<string, string[]> = {
  causas: ['juicio'],
  // `slug` es UID en el schema (UNIQUE en BD) y forma parte de la URL
  // pública de cada evento. Pre-validamos para devolver 409 con mensaje
  // útil en vez del error genérico de constraint que Strapi emite.
  eventos: ['slug'],
};

/**
 * Collections que tienen auditoría de autoría (campos `creado_por` y
 * `actualizado_por` apuntando a users-permissions.user). En esas, el
 * controller auto-setea esos campos con el usuario logueado al crear /
 * actualizar — la editora no los manda en el body.
 */
const AUDIT_COLLECTIONS = new Set(['eventos']);

/**
 * Si alguno de los UNIQUE_FIELDS de `uid` viene en `data` y ya pertenece
 * a OTRO documento (distinto de `excludeDocumentId`), devuelve el campo
 * conflictivo. Null si no hay conflicto.
 */
async function findUniqueConflict(
  strapi: any,
  collection: string,
  uid: string,
  data: any,
  excludeDocumentId: string | null
): Promise<{ field: string; value: string } | null> {
  const fields = UNIQUE_FIELDS[collection];
  if (!fields) return null;

  for (const field of fields) {
    const value = data?.[field];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const v = String(value).trim();

    // Sin D&P hay UNA sola fila por documento → findFirst directo. Esta
    // función también funciona con D&P activo (que es el caso de las otras
    // content-types: jueces, tribunales, etc. — donde no usamos UNIQUE_FIELDS
    // pero queda preparado para extenderlo).
    const existing = await strapi.documents(uid).findFirst({
      filters: { [field]: v },
    });
    if (existing && existing.documentId !== excludeDocumentId) {
      return { field, value: v };
    }
  }
  return null;
}

export default ({ strapi }) => ({
  async createContent(ctx: Ctx) {
    const { collection } = ctx.params;
    const uid = resolveUid(collection);
    if (!uid) {
      return ctx.badRequest(`Colección no permitida: ${collection}`);
    }

    const body = ctx.request.body ?? {};
    const data = body.data ?? body;

    // Pre-check UNIQUE. Sin esto, en CREATE Strapi devuelve 500 genérico
    // si ya existe; con esto devolvemos 422 con mensaje útil.
    const conflict = await findUniqueConflict(strapi, collection, uid, data, null);
    if (conflict) {
      return ctx.conflict(
        `Ya existe una causa con ${conflict.field}=${conflict.value}. ` +
          `No se permite duplicar este valor.`
      );
    }

    try {
      // Auditoría: si la collection lleva creado_por/actualizado_por, los
      // populamos con el user logueado (la editora no los manda en el body).
      // Como la policy isAdmin ya garantizó que ctx.state.user existe y es
      // admin/superadmin, podemos confiar en ese id sin re-chequeo.
      const dataWithAudit =
        AUDIT_COLLECTIONS.has(collection) && ctx.state.user?.id
          ? { ...data, creado_por: ctx.state.user.id, actualizado_por: ctx.state.user.id }
          : data;

      const created = await strapi.documents(uid).create({ data: dataWithAudit });
      ctx.body = { data: created };
    } catch (err: any) {
      strapi.log.error(
        `[admin-panel.createContent] ${collection} failed: ${err?.message ?? err}`
      );
      return ctx.badRequest(err?.message ?? 'No se pudo crear el registro.');
    }
  },

  async updateContent(ctx: Ctx) {
    const { collection, documentId } = ctx.params;
    const uid = resolveUid(collection);
    if (!uid) {
      return ctx.badRequest(`Colección no permitida: ${collection}`);
    }
    if (!documentId) {
      return ctx.badRequest('documentId requerido');
    }

    const body = ctx.request.body ?? {};
    const data = body.data ?? body;

    try {
      // Pre-check UNIQUE: si el body intenta cambiar un campo UNIQUE (ej.
      // `juicio` en causa) a uno que ya pertenece a OTRO documento, rechazamos
      // ANTES de tocar BD con un 409 Conflict. Sin este check, el constraint
      // de Postgres dispara durante el INSERT/UPDATE y Strapi devuelve un
      // error genérico que el form no sabe interpretar.
      const conflict = await findUniqueConflict(strapi, collection, uid, data, documentId);
      if (conflict) {
        return ctx.conflict(
          `Ya existe otra ${collection.replace(/s$/, '')} con ${conflict.field}=${conflict.value}.`
        );
      }

      // Sin Draft & Publish (causa y casacion tienen draftAndPublish:false desde
      // la migración 2026-06-08), documents().update() actualiza directamente
      // la única fila del documento. No hay draft separado ni necesidad de
      // llamar publish() ni unpublish() después.
      //
      // `publishedAt` en el body se ignora a este nivel — el campo persiste en
      // BD por compatibilidad con queries del webapp/MV que filtran por
      // `published_at IS NOT NULL`, pero ya no representa estado de publicación.
      const { publishedAt: _ignored, ...dataClean } = data;

      // Auditoría: sobreescribimos `actualizado_por` con el user actual.
      // `creado_por` no se toca — sigue apuntando al user que creó originalmente.
      const dataFinal =
        AUDIT_COLLECTIONS.has(collection) && ctx.state.user?.id
          ? { ...dataClean, actualizado_por: ctx.state.user.id }
          : dataClean;

      const updated = await strapi.documents(uid).update({
        documentId,
        data: dataFinal,
      });
      if (!updated) return ctx.notFound('Registro no encontrado');
      ctx.body = { data: updated };
    } catch (err: any) {
      strapi.log.error(
        `[admin-panel.updateContent] ${collection}/${documentId} failed: ${err?.message ?? err}`
      );
      return ctx.badRequest(err?.message ?? 'No se pudo actualizar el registro.');
    }
  },

  async deleteContent(ctx: Ctx) {
    const { collection, documentId } = ctx.params;
    const uid = resolveUid(collection);
    if (!uid) {
      return ctx.badRequest(`Colección no permitida: ${collection}`);
    }
    if (!documentId) {
      return ctx.badRequest('documentId requerido');
    }

    try {
      const result = await strapi.documents(uid).delete({ documentId });
      ctx.body = { data: result };
    } catch (err: any) {
      strapi.log.error(
        `[admin-panel.deleteContent] ${collection}/${documentId} failed: ${err?.message ?? err}`
      );
      return ctx.badRequest(err?.message ?? 'No se pudo eliminar el registro.');
    }
  },
});
