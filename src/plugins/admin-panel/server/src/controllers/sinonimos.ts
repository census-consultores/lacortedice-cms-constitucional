/**
 * CRUD de la tabla `sinonimos` (relaciones entre términos para el buscador).
 *
 * La tabla NO es un content-type de Strapi: se creó por migración SQL cruda
 * (lacortedice-webapp/migrations/003_sinonimos.sql) con una columna `terminos
 * text[]`. Por eso accedemos vía knex (`strapi.db.connection`) en lugar de
 * `strapi.documents()`.
 *
 * Todas las rutas están protegidas por la policy `plugin::admin-panel.isAdmin`
 * (ver routes/content-api.ts), así que asumimos admin/superadmin.
 *
 * El webapp lee esta tabla en modo readonly y cachea el resultado 10 min
 * (src/lib/server/sinonimos.ts); por eso un cambio aquí tarda hasta ~10 min
 * en reflejarse en el buscador, salvo que se invalide el cache.
 */
import type { Core } from '@strapi/strapi';

type Ctx = any;

const TIPOS = ['equivalente', 'relacionado'];

/** Limpia el array de términos: trim, sin vacíos, sin duplicados (case-insensitive). */
function cleanTerminos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of input) {
    if (typeof t !== 'string') continue;
    const v = t.trim();
    if (!v) continue;
    const key = v.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function cleanNota(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  // GET /admin-panel/sinonimos → lista completa (la tabla es chica).
  async list(ctx: Ctx) {
    const knex = strapi.db.connection;
    const rows = await knex('sinonimos').select('*').orderBy('id', 'desc');
    ctx.body = { data: rows };
  },

  // POST /admin-panel/sinonimos  body: { terminos: string[], tipo?, nota? }
  async create(ctx: Ctx) {
    const knex = strapi.db.connection;
    const body = ctx.request.body ?? {};

    const terminos = cleanTerminos(body.terminos);
    if (terminos.length < 2) {
      return ctx.badRequest('Un grupo necesita al menos 2 términos distintos.');
    }
    const tipo = TIPOS.includes(body.tipo) ? body.tipo : 'equivalente';
    const nota = cleanNota(body.nota);

    const [row] = await knex('sinonimos')
      .insert({ terminos, tipo, nota, activo: true })
      .returning('*');
    ctx.body = { data: row };
  },

  // PUT /admin-panel/sinonimos/:id  body: { terminos?, tipo?, activo?, nota? }
  async update(ctx: Ctx) {
    const knex = strapi.db.connection;
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) return ctx.badRequest('id inválido');

    const body = ctx.request.body ?? {};
    const patch: Record<string, unknown> = { updated_at: knex.fn.now() };

    if (body.terminos !== undefined) {
      const terminos = cleanTerminos(body.terminos);
      if (terminos.length < 2) {
        return ctx.badRequest('Un grupo necesita al menos 2 términos distintos.');
      }
      patch.terminos = terminos;
    }
    if (body.tipo !== undefined) {
      if (!TIPOS.includes(body.tipo)) return ctx.badRequest('tipo inválido');
      patch.tipo = body.tipo;
    }
    if (body.activo !== undefined) patch.activo = !!body.activo;
    if (body.nota !== undefined) patch.nota = cleanNota(body.nota);

    const [row] = await knex('sinonimos').where({ id }).update(patch).returning('*');
    if (!row) return ctx.notFound('No existe ese grupo de sinónimos.');
    ctx.body = { data: row };
  },

  // DELETE /admin-panel/sinonimos/:id
  async remove(ctx: Ctx) {
    const knex = strapi.db.connection;
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) return ctx.badRequest('id inválido');

    const n = await knex('sinonimos').where({ id }).del();
    ctx.body = { data: { deleted: n > 0 } };
  },
});
