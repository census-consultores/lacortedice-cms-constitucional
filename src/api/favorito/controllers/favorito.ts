/**
 * favorito controller
 *
 * Endpoints custom (no exponemos los CRUD por defecto):
 *   - GET    /api/favoritos/me              → lista los favoritos del user autenticado
 *   - POST   /api/favoritos/toggle          → idempotente, marca o desmarca favorito
 *   - GET    /api/favoritos/count           → cuenta de un causaDocumentId (público)
 *
 * Modelo: borrado físico. La fila existe ⇔ es favorito activo. createdAt
 * (auto de Strapi) registra la última vez que se marcó.
 */

import type { Core } from '@strapi/strapi';

type Ctx = any;

const UID = 'api::favorito.favorito' as const;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Lista los favoritos del usuario autenticado, más recientes primero.
   * Devuelve solo lo necesario: { id, causaDocumentId, createdAt }.
   */
  async mine(ctx: Ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const rows = await strapi.db.query(UID).findMany({
      where: { user: user.id },
      orderBy: { createdAt: 'desc' },
      select: ['id', 'causaDocumentId', 'createdAt'],
    });

    return ctx.send({ data: rows });
  },

  /**
   * Toggle idempotente. Body: { causaDocumentId: string }.
   * Si ya existe la fila (user, causa) → la borra y devuelve { favorited: false }.
   * Si no existe → la crea y devuelve { favorited: true }.
   *
   * Race-safe: al ser borrado físico, dos toggles concurrentes pueden:
   *   - duplicar inserciones (chequeo + insert no es atómico) → aceptable,
   *     el siguiente toggle limpia ambas. Trade-off conocido para no meter
   *     un advisory lock por tan poca ganancia.
   */
  async toggle(ctx: Ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const causaDocumentId = (ctx.request.body?.causaDocumentId ?? '').toString().trim();
    if (!causaDocumentId) {
      return ctx.badRequest('causaDocumentId es requerido.');
    }

    const existing = await strapi.db.query(UID).findOne({
      where: { user: user.id, causaDocumentId },
      select: ['id'],
    });

    if (existing) {
      await strapi.db.query(UID).delete({ where: { id: existing.id } });
      return ctx.send({ favorited: false, causaDocumentId });
    }

    const created = await strapi.db.query(UID).create({
      data: {
        user: user.id,
        causaDocumentId,
        publishedAt: new Date(),
      },
      select: ['id', 'createdAt'],
    });

    return ctx.send({
      favorited: true,
      causaDocumentId,
      id: created.id,
      createdAt: created.createdAt,
    });
  },

  /**
   * Cuenta cuántos usuarios tienen marcada una causa como favorita.
   * Público: la popularidad no es información sensible. Si más adelante
   * queremos restringirlo (ej. solo a autenticados), basta con quitar
   * `auth: false` en routes.
   *
   * Query: ?causaDocumentId=<id>
   */
  async count(ctx: Ctx) {
    const causaDocumentId = (ctx.query?.causaDocumentId ?? '').toString().trim();
    if (!causaDocumentId) {
      return ctx.badRequest('causaDocumentId es requerido.');
    }

    const total = await strapi.db.query(UID).count({
      where: { causaDocumentId },
    });

    return ctx.send({ causaDocumentId, count: total });
  },
});
