/**
 * Migrar PDFs de causa/casación de la raíz de uploads a subcarpetas.
 *
 * Contexto
 * --------
 * Los uploads del CMS están todos en la raíz del disco de Render
 * (/opt/render/project/src/public/uploads). Esto funciona pero es difícil de
 * auditar/limpiar. Queremos moverlos a:
 *   - /uploads/sentencias_instancia/<hash>.pdf  (para causa.file_pdf)
 *   - /uploads/sentencias_casacion/<hash>.pdf   (para casacion.file_pdf)
 *
 * Estrategia
 * ----------
 * La BD ya clasifica cada PDF por tipo via files_related_mph.related_type.
 * No hace falta inspeccionar el contenido. Para cada file vinculado:
 *   1. mv físico de raíz → subcarpeta.
 *   2. UPDATE files SET url, folder_path.
 *   3. Si UPDATE falla → mv reverso (rollback automático).
 *
 * Todo queda registrado en un reporte JSON para auditoría/rollback manual.
 *
 * Cómo correrlo
 * -------------
 * Dry-run en local (no modifica nada):
 *   npx tsx scripts/migrate-files-to-subfolders.ts \
 *     --uploads-path=./public/uploads \
 *     --db-url='postgres://strapi:strapi@localhost:5433/strapi'
 *
 * Piloto con 1 archivo en prod (lo movés y revisás en la web pública):
 *   DATABASE_URL=<render-url> npx tsx scripts/migrate-files-to-subfolders.ts \
 *     --uploads-path=/opt/render/project/src/public/uploads \
 *     --only-id=52 --execute
 *
 * Rollback de ese piloto si algo se ve mal:
 *   DATABASE_URL=<render-url> npx tsx scripts/migrate-files-to-subfolders.ts \
 *     --uploads-path=/opt/render/project/src/public/uploads \
 *     --rollback-from=./reports/migration-<timestamp>.json \
 *     --only-id=52 --execute
 *
 * Migración masiva (después del piloto OK):
 *   DATABASE_URL=<render-url> npx tsx scripts/migrate-files-to-subfolders.ts \
 *     --uploads-path=/opt/render/project/src/public/uploads --execute
 */

import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

type RelatedType = 'api::causa.causa' | 'api::casacion.casacion';

type FileRow = {
  id: number;
  hash: string;
  ext: string;
  url: string;
  folder_path: string | null;
  related_type: RelatedType;
  // Cuando related_type = 'api::causa.causa' apunta a la causa directamente.
  // Cuando es 'api::casacion.casacion' apunta a la causa MADRE (via casaciones_causa_lnk).
  juicio: string | null;
  causa_document_id: string | null;
};

type ReportEntry = {
  file_id: number;
  hash: string;
  ext: string;
  related_type: RelatedType;
  subfolder: 'sentencias_instancia' | 'sentencias_casacion';
  juicio: string | null;
  causa_document_id: string | null;
  old_url: string;
  new_url: string;
  old_folder_path: string | null;
  new_folder_path: string;
  old_disk_path: string;
  new_disk_path: string;
  status:
    | 'planned'
    | 'migrated'
    | 'skipped_file_missing'
    | 'skipped_already_migrated'
    | 'failed_move'
    | 'failed_update'
    | 'rolled_back';
  error?: string;
};

type Args = {
  execute: boolean;
  uploadsPath: string;
  dbUrl: string;
  onlyId: number | null;
  limit: number | null;
  reportPath: string;
  rollbackFrom: string | null;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : null;
  };
  const has = (k: string) => argv.includes(`--${k}`);

  const uploadsPath = get('uploads-path');
  if (!uploadsPath) {
    throw new Error('Falta --uploads-path=<ruta absoluta a la carpeta uploads>');
  }
  const dbUrl = get('db-url') || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('Falta --db-url=<conn string> o env DATABASE_URL');
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultReport = path.join(process.cwd(), 'reports', `migration-${ts}.json`);

  return {
    execute: has('execute'),
    uploadsPath: path.resolve(uploadsPath),
    dbUrl,
    onlyId: get('only-id') ? Number(get('only-id')) : null,
    limit: get('limit') ? Number(get('limit')) : null,
    reportPath: get('report') || defaultReport,
    rollbackFrom: get('rollback-from'),
  };
}

const SUBFOLDER_BY_TYPE: Record<RelatedType, ReportEntry['subfolder']> = {
  'api::causa.causa': 'sentencias_instancia',
  'api::casacion.casacion': 'sentencias_casacion',
};

async function fetchVinculatedFiles(
  client: Client,
  onlyId: number | null,
  limit: number | null
): Promise<FileRow[]> {
  // Un file puede tener varias filas en files_related_mph (draft + publish),
  // todas con el mismo related_type. Tomamos DISTINCT ON (file_id) por seguridad.
  const params: any[] = [];
  let whereOnlyId = '';
  if (onlyId !== null) {
    params.push(onlyId);
    whereOnlyId = `AND f.id = $${params.length}`;
  }
  let limitClause = '';
  if (limit !== null) {
    params.push(limit);
    limitClause = `LIMIT $${params.length}`;
  }

  // Para cada file resolvemos el juicio (código tipo "09501-2021-00026") y el
  // documentId de la causa madre. En instancia es directo. En casación hay que
  // pasar por casaciones_causa_lnk para llegar a la causa origen.
  const sql = `
    SELECT DISTINCT ON (f.id)
      f.id,
      f.hash,
      f.ext,
      f.url,
      f.folder_path,
      m.related_type,
      COALESCE(c_inst.juicio,  c_cas.juicio)        AS juicio,
      COALESCE(c_inst.document_id, c_cas.document_id) AS causa_document_id
    FROM files f
    JOIN files_related_mph m ON m.file_id = f.id
    LEFT JOIN causas c_inst
      ON m.related_type = 'api::causa.causa'
     AND c_inst.id = m.related_id
    LEFT JOIN casaciones_causa_lnk lnk
      ON m.related_type = 'api::casacion.casacion'
     AND lnk.casacion_id = m.related_id
    LEFT JOIN causas c_cas
      ON c_cas.id = lnk.causa_id
    WHERE m.field = 'file_pdf'
      AND m.related_type IN ('api::causa.causa', 'api::casacion.casacion')
      ${whereOnlyId}
    ORDER BY f.id
    ${limitClause}
  `;
  const res = await client.query(sql, params);
  return res.rows as FileRow[];
}

function buildEntry(row: FileRow, uploadsPath: string): ReportEntry {
  const subfolder = SUBFOLDER_BY_TYPE[row.related_type];
  const filename = `${row.hash}${row.ext}`;
  const oldUrl = `/uploads/${filename}`;
  const newUrl = `/uploads/${subfolder}/${filename}`;
  const newFolderPath = `/${subfolder}`;

  return {
    file_id: row.id,
    hash: row.hash,
    ext: row.ext,
    related_type: row.related_type,
    subfolder,
    juicio: row.juicio,
    causa_document_id: row.causa_document_id,
    old_url: row.url,
    new_url: newUrl,
    old_folder_path: row.folder_path,
    new_folder_path: newFolderPath,
    old_disk_path: path.join(uploadsPath, filename),
    new_disk_path: path.join(uploadsPath, subfolder, filename),
    status: 'planned',
  };
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function migrate(args: Args) {
  const client = new Client({ connectionString: args.dbUrl });
  await client.connect();

  try {
    console.log('────────────────────────────────────────');
    console.log(' Migración de PDFs a subcarpetas');
    console.log('────────────────────────────────────────');
    console.log(' Modo         :', args.execute ? 'EXECUTE' : 'DRY-RUN');
    console.log(' Uploads path :', args.uploadsPath);
    console.log(' Only id      :', args.onlyId ?? '(todos)');
    console.log(' Limit        :', args.limit ?? '(sin límite)');
    console.log(' Reporte      :', args.reportPath);
    console.log('────────────────────────────────────────\n');

    const rows = await fetchVinculatedFiles(client, args.onlyId, args.limit);
    console.log(`Files a procesar: ${rows.length}\n`);

    const entries: ReportEntry[] = [];

    for (const row of rows) {
      const entry = buildEntry(row, args.uploadsPath);

      // Identificador legible para humanos: tipo + juicio. Útil para verificar
      // en la web pública después del piloto.
      const human =
        `${entry.subfolder === 'sentencias_instancia' ? 'INSTANCIA' : 'CASACION'} ` +
        `juicio ${row.juicio ?? '(sin juicio resuelto)'}`;

      // Caso: ya migrado (folder_path ya apunta a la subcarpeta correcta).
      if (row.folder_path === entry.new_folder_path) {
        entry.status = 'skipped_already_migrated';
        console.log(`[SKIP-MIGRATED] file ${row.id} (${human}) ya está en ${entry.new_folder_path}`);
        entries.push(entry);
        continue;
      }

      // Caso: el archivo físico no existe en disco. No es un error fatal —
      // hay files en BD cuyo PDF se perdió antes de tener disco persistente.
      // Lo reportamos y seguimos.
      const exists = fs.existsSync(entry.old_disk_path);
      if (!exists) {
        entry.status = 'skipped_file_missing';
        entry.error = `archivo no existe en disco: ${entry.old_disk_path}`;
        console.log(`[SKIP-MISSING] file ${row.id} (${human}): ${entry.old_disk_path}`);
        entries.push(entry);
        continue;
      }

      if (!args.execute) {
        console.log(
          `[PLAN] file ${row.id} → ${human}\n` +
            `       ${entry.old_disk_path}\n   →   ${entry.new_disk_path}`
        );
        entries.push(entry);
        continue;
      }

      // EXECUTE: mv → UPDATE → si UPDATE falla, mv reverso.
      ensureDir(path.dirname(entry.new_disk_path));
      try {
        fs.renameSync(entry.old_disk_path, entry.new_disk_path);
      } catch (e: any) {
        entry.status = 'failed_move';
        entry.error = e?.message ?? String(e);
        console.error(`[FAIL-MOVE] file ${row.id}: ${entry.error}`);
        entries.push(entry);
        continue;
      }

      try {
        await client.query(
          `UPDATE files SET url = $1, folder_path = $2, updated_at = NOW() WHERE id = $3`,
          [entry.new_url, entry.new_folder_path, row.id]
        );
        entry.status = 'migrated';
        console.log(`[OK] file ${row.id} migrado → ${human}`);
      } catch (e: any) {
        // Rollback automático del mv para mantener consistencia.
        try {
          fs.renameSync(entry.new_disk_path, entry.old_disk_path);
        } catch (e2: any) {
          // Si ni el rollback del mv funciona, queda inconsistente; loggear duro.
          console.error(
            `[CRITICAL] file ${row.id}: UPDATE falló y rollback del mv también. ` +
              `Archivo está en ${entry.new_disk_path}, BD apunta a ${entry.old_url}. ` +
              `Hay que arreglarlo a mano.`
          );
        }
        entry.status = 'failed_update';
        entry.error = e?.message ?? String(e);
        console.error(`[FAIL-UPDATE] file ${row.id}: ${entry.error}`);
      }
      entries.push(entry);
    }

    // Escribir reporte.
    ensureDir(path.dirname(args.reportPath));
    fs.writeFileSync(
      args.reportPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          mode: args.execute ? 'execute' : 'dry-run',
          uploads_path: args.uploadsPath,
          only_id: args.onlyId,
          limit: args.limit,
          summary: summarize(entries),
          entries,
        },
        null,
        2
      )
    );

    console.log('\n────────────────────────────────────────');
    console.log(' Resumen');
    console.log('────────────────────────────────────────');
    const s = summarize(entries);
    for (const k of Object.keys(s)) console.log(` ${k.padEnd(25)}: ${(s as any)[k]}`);
    console.log(`\nReporte escrito en: ${args.reportPath}`);
  } finally {
    await client.end();
  }
}

function summarize(entries: ReportEntry[]) {
  const out: Record<ReportEntry['status'], number> = {
    planned: 0,
    migrated: 0,
    skipped_file_missing: 0,
    skipped_already_migrated: 0,
    failed_move: 0,
    failed_update: 0,
    rolled_back: 0,
  };
  for (const e of entries) out[e.status]++;
  return out;
}

async function rollback(args: Args) {
  if (!args.rollbackFrom) throw new Error('Falta --rollback-from=<reporte.json>');
  const report = JSON.parse(fs.readFileSync(args.rollbackFrom, 'utf-8'));
  const all: ReportEntry[] = report.entries;
  const targets = all.filter(
    (e) => e.status === 'migrated' && (args.onlyId === null || e.file_id === args.onlyId)
  );

  console.log('────────────────────────────────────────');
  console.log(' ROLLBACK');
  console.log('────────────────────────────────────────');
  console.log(' Reporte fuente :', args.rollbackFrom);
  console.log(' Modo           :', args.execute ? 'EXECUTE' : 'DRY-RUN');
  console.log(' Only id        :', args.onlyId ?? '(todos los migrated)');
  console.log(' A revertir     :', targets.length);
  console.log('────────────────────────────────────────\n');

  const client = new Client({ connectionString: args.dbUrl });
  await client.connect();

  try {
    for (const e of targets) {
      if (!args.execute) {
        console.log(`[PLAN-ROLLBACK] file ${e.file_id}: ${e.new_disk_path} → ${e.old_disk_path}`);
        continue;
      }

      try {
        if (!fs.existsSync(e.new_disk_path)) {
          console.warn(
            `[WARN] file ${e.file_id}: ${e.new_disk_path} no existe. ¿Ya revertido? Solo arreglo BD.`
          );
        } else {
          fs.renameSync(e.new_disk_path, e.old_disk_path);
        }
        await client.query(
          `UPDATE files SET url = $1, folder_path = $2, updated_at = NOW() WHERE id = $3`,
          [e.old_url, e.old_folder_path, e.file_id]
        );
        e.status = 'rolled_back';
        console.log(`[OK-ROLLBACK] file ${e.file_id} revertido`);
      } catch (err: any) {
        console.error(`[FAIL-ROLLBACK] file ${e.file_id}: ${err?.message ?? err}`);
      }
    }

    if (args.execute) {
      // Reescribir el reporte para reflejar los rolled_back.
      fs.writeFileSync(args.rollbackFrom, JSON.stringify(report, null, 2));
      console.log(`\nReporte actualizado: ${args.rollbackFrom}`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs();
  if (args.rollbackFrom) {
    await rollback(args);
  } else {
    await migrate(args);
  }
}

main().catch((err) => {
  console.error('[migrate-files-to-subfolders] error:', err);
  process.exit(1);
});
