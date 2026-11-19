/**
 * Comprueba las VENTANAS DE ENVÍO sin arrancar Strapi.
 *
 *   node scripts/comprobar-ventanas.mjs
 *
 * Congela el reloj en doce instantes distintos —dentro, justo antes, justo
 * después, de madrugada, un domingo sin franja— y verifica que la puerta se
 * abra sólo cuando toca. Comprueba además los dos casos de borde que más
 * caro salen: sin ventanas se envía siempre, y una lista ilegible NO abre la
 * puerta (si abriera, un error de dedo mandaría correos a las tres de la
 * mañana, que es justo lo que esto viene a evitar).
 *
 * Lee la lógica del propio envio-masivo.ts, así que no puede quedar
 * desincronizado con lo que corre en producción.
 *
 * Al cambiar el calendario —VENTANAS_POR_DEFECTO o ENVIO_VENTANAS— hay que
 * actualizar los casos de abajo: son fechas concretas, no genéricas.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/work/lacortedice-cms/package.json');
const esbuild = require('esbuild');

const src = fs.readFileSync('src/plugins/admin-panel/server/src/services/envio-masivo.ts','utf8');
const ini = src.indexOf('type Ventana =');
const fin = src.indexOf('/** Quiénes faltan por recibir esta campaña');
const ts = src.slice(ini, fin);
const js = esbuild.transformSync(ts, { loader: 'ts', format: 'esm' }).code;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const casos = [
  ['2026-09-18T23:30:00Z', true,  'vie 18:30 EC · dentro'],
  ['2026-09-18T22:59:00Z', false, 'vie 17:59 EC · antes de abrir'],
  ['2026-09-19T02:01:00Z', false, 'vie 21:01 EC · ya cerro'],
  ['2026-09-19T06:00:00Z', false, 'sab 01:00 EC · madrugada'],
  ['2026-09-19T18:00:00Z', true,  'sab 13:00 EC · dentro'],
  ['2026-09-19T23:30:00Z', false, 'sab 18:30 EC · cerrado'],
  ['2026-09-20T22:00:00Z', false, 'dom 17:00 EC · sin franja'],
  ['2026-09-21T21:00:00Z', true,  'lun 16:00 EC · dentro'],
  ['2026-09-22T19:59:00Z', false, 'mar 14:59 EC · falta 1 min'],
  ['2026-09-22T20:00:00Z', true,  'mar 15:00 EC · justo abre'],
  ['2026-09-23T02:00:00Z', false, 'mar 21:00 EC · justo cierra'],
  ['2026-09-24T20:00:00Z', false, 'mie · no quedan franjas'],
];
const Real = Date;
let fallos = 0;
for (const [iso, esperado, etiqueta] of casos) {
  const fijo = new Real(iso);
  globalThis.Date = class extends Real {
    constructor(...a){ super(...(a.length ? a : [fijo.getTime()])); }
    static now(){ return fijo.getTime(); }
  };
  const r = mod.ventanaActiva();
  globalThis.Date = Real;
  const ok = r.abierta === esperado;
  if (!ok) fallos++;
  console.log(`${ok?'OK ':'MAL'}  ${etiqueta.padEnd(30)} abierta=${String(r.abierta).padEnd(5)} ${r.motivo}`);
}

// Sin ventanas -> se envia siempre.  Lista basura -> NO se envia.
process.env.ENVIO_VENTANAS = '';
console.log('\nENVIO_VENTANAS vacia  ->', JSON.stringify(mod.ventanaActiva()));
process.env.ENVIO_VENTANAS = 'cualquier cosa';
const basura = mod.ventanaActiva();
console.log('ENVIO_VENTANAS basura ->', JSON.stringify(basura));
if (basura.abierta) { console.log('MAL: una lista ilegible no puede abrir la puerta'); fallos++; }

console.log(fallos ? `\n${fallos} FALLOS` : `\n${casos.length}/${casos.length} correctos + los dos bordes`);
process.exit(fallos ? 1 : 0);
