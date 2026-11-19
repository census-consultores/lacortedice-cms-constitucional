'use strict';
/**
 * Siembra (idempotente) los catálogos de la materia en este CMS desde
 * data/materia/<materia>.json: decisiones finales (1ª instancia, apelación,
 * casación), tipos de acción (procedimientos), estados del juicio, el
 * catálogo jerárquico de categorías y las judicaturas (tribunales).
 *
 * Uso (con las variables de entorno de la base, como `strapi start`):
 *   node scripts/seed-materia.js laboral
 *
 * Idempotente: busca por `nombre` y solo crea lo que falta; nunca borra.
 * Las categorías se enlazan padre→hijo por nombre (categoria_padre).
 * Las judicaturas vienen de JUDICATURAS en config/materia.py del extractor:
 * copiar los nombres a "tribunales" del JSON (o pasarlos por --tribunales a.json).
 */
const fs = require('fs');
const path = require('path');

async function upsertPorNombre(uid, nombre, extra = {}) {
  const existente = await strapi.documents(uid).findFirst({ filters: { nombre: { $eq: nombre } } });
  if (existente) return existente;
  return strapi.documents(uid).create({ data: { nombre, ...extra }, status: 'published' });
}

async function sembrar(materia, tribunalesExtra) {
  const ruta = path.join(process.cwd(), 'data', 'materia', `${materia}.json`);
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${ruta}`);
  const d = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const resumen = {};
  const cuenta = (k) => (resumen[k] = (resumen[k] || 0) + 1);

  for (const x of d.decisiones_finales) { await upsertPorNombre('api::decision-final.decision-final', x.nombre, { sigla: x.sigla }); cuenta('decision-final'); }
  for (const x of d.decisiones_finales_casacion) { await upsertPorNombre('api::decision-final-casacion.decision-final-casacion', x.nombre, { sigla: x.sigla }); cuenta('decision-final-casacion'); }
  for (const x of d.decisiones_finales_apelacion) { await upsertPorNombre('api::decision-final-apelacion.decision-final-apelacion', x.nombre, { sigla: x.sigla }); cuenta('decision-final-apelacion'); }
  for (const n of d.tipos_de_accion) { await upsertPorNombre('api::tipo-de-accion.tipo-de-accion', n); cuenta('tipo-de-accion'); }
  for (const n of d.estados_del_juicio) { await upsertPorNombre('api::estado-del-juicio.estado-del-juicio', n); cuenta('estado-del-juicio'); }
  for (const n of [...(d.tribunales || []), ...(tribunalesExtra || [])]) { await upsertPorNombre('api::tribunal.tribunal', n); cuenta('tribunal'); }
  // Causales de casación (Art. 268 COGEP): el worker las enlaza por "Causal N" y no las crea.
  for (const n of d.causales_invocadas || []) { await upsertPorNombre('api::causal-invocada.causal-invocada', n); cuenta('causal-invocada'); }

  for (const cat of d.categorias) {
    const padre = await upsertPorNombre('api::categoria.categoria', cat.nombre, { descripcion: `Categoría de primer nivel · ${d.materia}` });
    cuenta('categoria');
    for (const sub of cat.subcategorias) {
      const existente = await strapi.documents('api::categoria.categoria').findFirst({
        filters: { nombre: { $eq: sub }, categoria_padre: { documentId: { $eq: padre.documentId } } },
      });
      if (!existente) {
        await strapi.documents('api::categoria.categoria').create({
          data: { nombre: sub, descripcion: `Subcategoría de "${cat.nombre}" · ${d.materia}`, categoria_padre: padre.documentId },
          status: 'published',
        });
      }
      cuenta('subcategoria');
    }
  }
  console.log(`Catálogos de la materia ${d.materia} sembrados:`, resumen);
  return resumen;
}

async function main() {
  const materia = process.argv[2];
  if (!materia) { console.error('Uso: node scripts/seed-materia.js <laboral|civil> [--tribunales archivo.json]'); process.exit(2); }
  let tribunales = [];
  const i = process.argv.indexOf('--tribunales');
  if (i > 0 && process.argv[i + 1]) {
    const t = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
    tribunales = Array.isArray(t) ? t : Object.values(t);
  }
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  try { await sembrar(materia, tribunales); } finally { await app.destroy(); }
  process.exit(0);
}

module.exports = { sembrar };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
