import type { Core } from '@strapi/strapi';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Estadísticas del Consejo de la Judicatura para el Observatorio Jurimétrico.
 *
 * `cj_estadisticas` replica, fila por fila, el subconjunto CONTENCIOSO
 * TRIBUTARIO de los microdatos que la Dirección Nacional de Estudios
 * Jurimétricos y Estadística Judicial (DNEJEJ) publica cada mes en
 * fsweb.funcionjudicial.gob.ec (serie 2016 en adelante). Las agregaciones
 * se hacen en consulta — la tabla guarda el dato fiel a la fuente.
 *
 * Carga inicial: data/cj-causas-tributario.json.gz (corte empaquetado en el
 * repo). Actualización: el actualizador revisa una vez por semana si el
 * archivo del Consejo cambió (por tamaño) y, si cambió, lo descarga,
 * lo desempaqueta (node-unrar-js, con extracción a disco para no cargar
 * 118 MB en memoria), filtra la materia tributaria y recarga la tabla.
 * El corte vigente y el tamaño del archivo quedan en el core store.
 */

const URL_RAR = 'https://fsweb.funcionjudicial.gob.ec/estadisticas/Causas%20Cogep.rar';
const NOMBRE_CSV = /CAUSAS_COGEP_SATJE.*\.csv$/i;
const REVISION_MS = 7 * 24 * 60 * 60 * 1000; // semanal
const TICK_MS = 24 * 60 * 60 * 1000; // el tick corre a diario y decide

type FilaCJ = {
  anio: number; judicatura: string; provincia: string; tipo_accion: string;
  submateria: string; actividad: string; ingreso: number; resuelta: number;
  tramite: number; tramite_acum: number; corte: string;
};

function store(strapi: Core.Strapi) {
  return strapi.store({ type: 'plugin', name: 'admin-panel', key: 'cj-estadisticas' });
}

export async function ensureCjEstadisticas(strapi: Core.Strapi): Promise<void> {
  const conn = strapi.db.connection;
  await conn.raw(`
    CREATE TABLE IF NOT EXISTS cj_estadisticas (
      id serial PRIMARY KEY,
      anio int NOT NULL,
      judicatura text NOT NULL,
      provincia text,
      tipo_accion text,
      submateria text,
      actividad text,
      ingreso int NOT NULL DEFAULT 0,
      resuelta int NOT NULL DEFAULT 0,
      tramite int NOT NULL DEFAULT 0,
      tramite_acum int NOT NULL DEFAULT 0,
      corte text
    )`);
  await conn.raw(`
    CREATE INDEX IF NOT EXISTS cj_estadisticas_anio_jud
    ON cj_estadisticas (anio, judicatura)`);

  const vacia = await conn.raw('SELECT count(*)::int AS n FROM cj_estadisticas');
  const n = vacia?.rows?.[0]?.n ?? 0;
  if (n > 0) return;

  // Carga inicial desde el corte empaquetado en el repo.
  const seed = path.join(process.cwd(), 'data', 'cj-causas-tributario.json.gz');
  if (!fs.existsSync(seed)) {
    strapi.log.warn('[cj-estadisticas] sin datos y sin seed en ' + seed);
    return;
  }
  const filas: FilaCJ[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(seed)).toString('utf-8'));
  await insertarFilas(strapi, filas);
  await store(strapi).set({ value: { corte: filas[0]?.corte ?? null, bytes: null, cargadoEn: new Date().toISOString(), origen: 'seed' } });
  strapi.log.info(`[cj-estadisticas] carga inicial: ${filas.length} filas (corte ${filas[0]?.corte})`);
}

async function insertarFilas(strapi: Core.Strapi, filas: FilaCJ[]): Promise<void> {
  const conn = strapi.db.connection;
  await conn.raw('DELETE FROM cj_estadisticas');
  const LOTE = 500;
  for (let i = 0; i < filas.length; i += LOTE) {
    await conn('cj_estadisticas').insert(filas.slice(i, i + LOTE));
  }
}

/**
 * Revisa si el Consejo publicó un corte nuevo (comparando el tamaño del
 * archivo) y, si cambió, descarga, desempaqueta, filtra y recarga.
 */
export async function actualizarDesdeConsejo(strapi: Core.Strapi): Promise<void> {
  const estado = ((await store(strapi).get()) as any) ?? {};
  const ultima = estado.revisadoEn ? new Date(estado.revisadoEn).getTime() : 0;
  if (Date.now() - ultima < REVISION_MS) return;

  let bytesRemoto: number | null = null;
  try {
    const head = await fetch(URL_RAR, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    if (head.ok) bytesRemoto = Number(head.headers.get('content-length')) || null;
  } catch (e: any) {
    strapi.log.warn('[cj-estadisticas] HEAD al Consejo falló: ' + e.message);
    return;
  }
  await store(strapi).set({ value: { ...estado, revisadoEn: new Date().toISOString() } });
  if (!bytesRemoto || bytesRemoto === estado.bytes) return; // sin cambios

  strapi.log.info(`[cj-estadisticas] corte nuevo detectado (${bytesRemoto} bytes) — descargando…`);
  const tmpRar = path.join('/tmp', 'cj-causas-cogep.rar');
  const tmpDir = path.join('/tmp', 'cj-causas-extract');
  try {
    const res = await fetch(URL_RAR, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fs.writeFileSync(tmpRar, Buffer.from(await res.arrayBuffer()));

    // node-unrar-js vive en el package.json RAÍZ del CMS y se resuelve en
    // runtime; @vite-ignore evita que el bundler del plugin intente
    // empaquetarlo (el WASM no es bundleable).
    const paquete = 'node-unrar-js';
    const unrar: any = await import(/* @vite-ignore */ paquete);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const extractor = await unrar.createExtractorFromFile({ filepath: tmpRar, targetPath: tmpDir });
    // Materializar la extracción (el iterador es perezoso).
    [...extractor.extract().files];

    const csv = buscarCsv(tmpDir);
    if (!csv) throw new Error('CSV no encontrado dentro del RAR');

    const filas = filtrarTributario(fs.readFileSync(csv, 'latin1'));
    if (filas.length < 1000) throw new Error(`solo ${filas.length} filas tributarias — formato inesperado, no se recarga`);

    await insertarFilas(strapi, filas);
    await store(strapi).set({
      value: {
        corte: filas[0]?.corte ?? null,
        bytes: bytesRemoto,
        cargadoEn: new Date().toISOString(),
        revisadoEn: new Date().toISOString(),
        origen: 'consejo'
      }
    });
    strapi.log.info(`[cj-estadisticas] recargado: ${filas.length} filas (corte ${filas[0]?.corte})`);
  } catch (e: any) {
    strapi.log.error('[cj-estadisticas] actualización falló (la tabla vigente se conserva): ' + e.message);
  } finally {
    fs.rmSync(tmpRar, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buscarCsv(dir: string): string | null {
  for (const entrada of fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' })) {
    if (NOMBRE_CSV.test(entrada)) return path.join(dir, entrada);
  }
  return null;
}

/** Parser CSV mínimo para el formato del Consejo (sin comillas anidadas). */
function filtrarTributario(texto: string): FilaCJ[] {
  const lineas = texto.split(/\r?\n/);
  const cab = lineas[0].split(',').map((c) => c.trim());
  const col = (nombre: string) => cab.findIndex((c) => c.toLowerCase().startsWith(nombre));
  const iAnio = col('a'); // "Año" llega con codificación variable — primera columna
  const iProv = col('provincia');
  const iJud = col('judicatura');
  const iMat = col('materia');
  const iTipo = col('tipoaccion');
  const iDel = col('delito');
  const iInst = col('instancia');
  const iAct = col('actividad');
  const iIng = col('ingreso');
  const iTraAcum = cab.findIndex((c) => c.toLowerCase().startsWith('tramite_acum'));
  const iTra = cab.findIndex((c, ix) => c.toLowerCase().startsWith('tramite') && ix !== iTraAcum);
  const iRes = col('resuelta');
  const iCorte = col('corte');
  void iInst;

  const filas: FilaCJ[] = [];
  for (let i = 1; i < lineas.length; i++) {
    if (!lineas[i]) continue;
    const c = lineas[i].split(',');
    if ((c[iMat] ?? '').trim() !== 'CONTENCIOSO TRIBUTARIO') continue;
    filas.push({
      anio: Number(c[iAnio]) || 0,
      judicatura: (c[iJud] ?? '').trim(),
      provincia: (c[iProv] ?? '').trim(),
      tipo_accion: (c[iTipo] ?? '').trim(),
      submateria: (c[iDel] ?? '').trim(),
      actividad: (c[iAct] ?? '').trim(),
      ingreso: Number(c[iIng]) || 0,
      resuelta: Number(c[iRes]) || 0,
      tramite: Number(c[iTra]) || 0,
      tramite_acum: Number(c[iTraAcum]) || 0,
      corte: (c[iCorte] ?? '').trim()
    });
  }
  return filas;
}

/** Arranque desde el bootstrap del plugin: carga inicial + reloj de revisión. */
export function iniciarCjEstadisticas(strapi: Core.Strapi): void {
  const correr = () =>
    ensureCjEstadisticas(strapi)
      .then(() => actualizarDesdeConsejo(strapi))
      .catch((e: any) => strapi.log.warn('[cj-estadisticas] ciclo falló: ' + e.message));
  setTimeout(correr, 45_000); // fuera del boot crítico
  const timer = setInterval(correr, TICK_MS);
  (timer as any).unref?.();
}
