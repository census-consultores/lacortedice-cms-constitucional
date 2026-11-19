/**
 * Mueve las fotos de eventos de la raíz `uploads/` a `uploads/publicaciones/eventos/`.
 *
 * Contexto
 * --------
 * El script `migrate-wp-events.ts` subió las fotos via endpoint CMS, pero el
 * cambio que hace que `?path=publicaciones/eventos` se respete todavía no
 * está deployado en prod. Resultado: las 13 fotos terminaron en raíz, junto
 * con sus formats (`thumbnail_`, `small_`, `medium_`, `large_`) que Strapi
 * genera automáticamente para cada imagen subida.
 *
 * Este script identifica las fotos vinculadas a eventos cuyo `folder_path`
 * sigue siendo null o '/' y mueve TODOS los archivos físicos (principal +
 * formats) a la subcarpeta. Después actualiza la BD:
 *   - files.url            (URL del archivo principal)
 *   - files.formats        (JSONB con URLs de cada format)
 *   - files.folder_path    (= '/publicaciones/eventos')
 *
 * Idempotente: si `folder_path` ya es '/publicaciones/eventos', skip.
 *
 * Uso (local):
 *   PG_URL='postgres://strapi:strapi@localhost:5433/strapi' \
 *   UPLOADS_PATH=./public/uploads \
 *   npx tsx scripts/move-evento-fotos-to-subfolder.ts --dry-run
 *
 * Uso (prod, desde Render shell):
 *   PG_URL="$DATABASE_URL" \
 *   UPLOADS_PATH=/opt/render/project/src/public/uploads \
 *   npx tsx scripts/move-evento-fotos-to-subfolder.ts --execute
 */

import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const PG_URL = process.env.PG_URL ?? process.env.DATABASE_URL ?? '';
const UPLOADS_PATH = process.env.UPLOADS_PATH ?? './public/uploads';
const TARGET_SUBPATH = 'publicaciones/eventos';
const NEW_FOLDER_PATH = '/' + TARGET_SUBPATH;
const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

if (!PG_URL) {
  console.error('ERROR: falta PG_URL (o DATABASE_URL).');
  process.exit(1);
}
if (!DRY_RUN && !EXECUTE) {
  console.error('ERROR: pasá --dry-run o --execute');
  process.exit(1);
}

interface FormatEntry {
  name: string;
  url: string;
  hash?: string;
  ext?: string;
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  path?: string | null;
  sizeInBytes?: number;
}

interface FileRow {
  id: number;
  name: string;
  hash: string;
  ext: string;
  url: string;
  folder_path: string | null;
  formats: Record<string, FormatEntry> | null;
}

function isAlreadyMigrated(row: FileRow): boolean {
  return row.folder_path === NEW_FOLDER_PATH;
}

/**
 * Reemplaza `/uploads/<filename>` por `/uploads/publicaciones/eventos/<filename>`
 * solo si la URL es del shape esperado (no toca URLs absolutas o ya migradas).
 */
function rewriteUrl(url: string | undefined | null): string | undefined | null {
  if (!url) return url;
  const m = url.match(/^\/uploads\/([^/]+)$/);
  if (!m) return url; // ya migrada o shape distinto, no tocar
  return `/uploads/${TARGET_SUBPATH}/${m[1]}`;
}

async function main() {
  const client = new Client({
    connectionString: PG_URL,
    ssl: /render\.com|amazonaws/i.test(PG_URL) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  console.log('────────────────────────────────────────');
  console.log(' Mover fotos de eventos a subcarpeta');
  console.log('────────────────────────────────────────');
  console.log(' Modo          :', EXECUTE ? 'EXECUTE' : 'DRY-RUN');
  console.log(' UPLOADS_PATH  :', UPLOADS_PATH);
  console.log(' Target subdir :', TARGET_SUBPATH);
  console.log('────────────────────────────────────────\n');

  try {
    // Files vinculados a eventos via files_related_mph (relation polymorphic
    // que Strapi 5 usa para media → cualquier entidad). field = 'foto'.
    const sql = `
      SELECT DISTINCT ON (f.id) f.id, f.name, f.hash, f.ext, f.url, f.folder_path, f.formats
      FROM files f
      JOIN files_related_mph m ON m.file_id = f.id
      WHERE m.related_type = 'api::evento.evento'
        AND m.field = 'foto'
      ORDER BY f.id
    `;
    const res = await client.query<FileRow>(sql);
    console.log(`Files vinculados a eventos: ${res.rows.length}\n`);

    const stats = { moved: 0, skipped_already: 0, skipped_missing: 0, errors: 0 };

    if (EXECUTE) {
      await client.query('BEGIN');
    }

    try {
      for (const row of res.rows) {
        if (isAlreadyMigrated(row)) {
          stats.skipped_already++;
          console.log(`[SKIP] file ${row.id} ya está en ${row.folder_path}`);
          continue;
        }

        // Archivo principal
        const mainFilename = `${row.hash}${row.ext}`;
        const mainOld = path.join(UPLOADS_PATH, mainFilename);
        const mainNew = path.join(UPLOADS_PATH, TARGET_SUBPATH, mainFilename);

        if (!fs.existsSync(mainOld)) {
          stats.skipped_missing++;
          console.warn(`[SKIP-MISSING] file ${row.id}: ${mainOld} no existe`);
          continue;
        }

        // Formats: cada uno tiene su propio archivo en disco con prefijo
        // (small_, medium_, large_, thumbnail_) sobre el name original.
        const formatFiles: { old: string; new: string; format: string }[] = [];
        if (row.formats) {
          for (const [fmt, entry] of Object.entries(row.formats)) {
            // entry.url es `/uploads/<prefix>_<hash>.<ext>` o similar.
            // Tomamos el filename de ahí para mover el archivo físico.
            const url = entry.url ?? '';
            const m = url.match(/^\/uploads\/([^/]+)$/);
            if (!m) continue; // ya migrado o shape distinto
            const filename = m[1];
            formatFiles.push({
              format: fmt,
              old: path.join(UPLOADS_PATH, filename),
              new: path.join(UPLOADS_PATH, TARGET_SUBPATH, filename),
            });
          }
        }

        console.log(
          `[PLAN] file ${row.id} (${row.name}): ${1 + formatFiles.length} archivos a mover`
        );

        if (!EXECUTE) {
          // Solo planear, no mover ni actualizar BD
          continue;
        }

        // 1) Crear subdir si no existe
        fs.mkdirSync(path.dirname(mainNew), { recursive: true });

        // 2) Mover archivo principal
        try {
          fs.renameSync(mainOld, mainNew);
        } catch (e) {
          stats.errors++;
          console.error(`[FAIL-MV-MAIN] file ${row.id}: ${(e as Error).message}`);
          continue;
        }

        // 3) Mover formats (best-effort: si alguno falla, log y seguimos)
        for (const ff of formatFiles) {
          try {
            if (fs.existsSync(ff.old)) {
              fs.renameSync(ff.old, ff.new);
            }
          } catch (e) {
            console.warn(
              `[WARN] file ${row.id} format ${ff.format}: ${(e as Error).message}`
            );
          }
        }

        // 4) Actualizar URLs en formats JSONB
        const newFormats = row.formats ? { ...row.formats } : null;
        if (newFormats) {
          for (const fmt of Object.keys(newFormats)) {
            const entry = newFormats[fmt];
            if (entry?.url) entry.url = rewriteUrl(entry.url)!;
          }
        }

        // 5) UPDATE files SET url, formats, folder_path
        try {
          await client.query(
            `UPDATE files
             SET url = $1, formats = $2::jsonb, folder_path = $3, updated_at = NOW()
             WHERE id = $4`,
            [
              `/uploads/${TARGET_SUBPATH}/${mainFilename}`,
              newFormats ? JSON.stringify(newFormats) : null,
              NEW_FOLDER_PATH,
              row.id,
            ]
          );
          stats.moved++;
          console.log(`[OK] file ${row.id} movido + BD actualizada`);
        } catch (e) {
          stats.errors++;
          console.error(`[FAIL-UPDATE] file ${row.id}: ${(e as Error).message}`);
          // No hacemos rollback del mv aquí porque la transacción global
          // se va a abortar en el catch externo.
          throw e;
        }
      }

      if (EXECUTE) {
        await client.query('COMMIT');
      }
    } catch (e) {
      if (EXECUTE) {
        await client.query('ROLLBACK');
        console.error('\n[ROLLBACK] transacción revertida por error.');
      }
      throw e;
    }

    console.log('\n────────────────────────────────────────');
    console.log(' Resumen');
    console.log('────────────────────────────────────────');
    console.log(' Moved              :', stats.moved);
    console.log(' Skipped (migrated) :', stats.skipped_already);
    console.log(' Skipped (missing)  :', stats.skipped_missing);
    console.log(' Errors             :', stats.errors);
    console.log('────────────────────────────────────────');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[move-evento-fotos] error:', err);
  process.exit(1);
});
