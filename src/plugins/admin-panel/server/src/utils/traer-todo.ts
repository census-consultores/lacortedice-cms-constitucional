/**
 * Traer TODAS las filas de una consulta, por páginas.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * `limit: -1` significa «todas» en el Entity Service y en el Document Service
 * de Strapi, pero NO en `strapi.db.query()`, que es el Query Engine: ahí el
 * número viaja tal cual hasta el SQL y Postgres responde
 *
 *     LIMIT must not be negative
 *
 * y la petición entera se cae con un 500. Es un error silencioso mientras
 * nadie abre esa pantalla: el código compila, la consulta se ve razonable y
 * sólo falla al ejecutarse.
 *
 * Así se cayó la pantalla «Resultados de los correos» la primera vez que se
 * abrió, justo el día del lanzamiento, y así llevaban meses sin limpiarse los
 * favoritos y las jugadas al borrar un usuario —esos dos iban dentro de un
 * try/catch que se tragaba el error y seguía como si nada—.
 *
 * POR QUÉ POR PÁGINAS Y NO UN LÍMITE ENORME
 * -----------------------------------------
 * Un `limit: 1000000` funcionaría hoy y mentiría mañana: el día que la tabla
 * pase de ese número, faltarían filas y nadie se enteraría, porque no hay
 * error, sólo un total más bajo. Pedir de mil en mil hasta que la base
 * devuelva menos de mil no tiene ese techo.
 */
import type { Core } from '@strapi/strapi';

const POR_PAGINA = 1000;

/** Tope de seguridad: 500 páginas son 500.000 filas. Si se llega ahí, algo
 *  raro pasa —una consulta sin `where` sobre una tabla enorme— y es mejor
 *  cortar y dejarlo dicho en el log que tumbar el proceso por memoria. */
const MAX_PAGINAS = 500;

export async function traerTodo<T = any>(
  strapi: Core.Strapi,
  uid: string,
  opciones: Record<string, unknown> = {},
): Promise<T[]> {
  const todas: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const lote = (await strapi.db.query(uid).findMany({
      ...opciones,
      limit: POR_PAGINA,
      offset: pagina * POR_PAGINA,
    })) as T[];
    todas.push(...lote);
    if (lote.length < POR_PAGINA) return todas;
  }
  strapi.log.warn(
    `[traerTodo] ${uid}: se alcanzaron ${MAX_PAGINAS * POR_PAGINA} filas y se cortó ahí`,
  );
  return todas;
}
