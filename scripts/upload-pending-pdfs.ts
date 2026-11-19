/**
 * Carga masiva de PDFs huérfanos desde una carpeta local hacia el CMS.
 *
 * Contexto
 * --------
 * Antes de tener Render Disk, los uploads se perdían en cada redeploy. El
 * equipo editorial conserva los PDFs originales en Google Drive organizados en
 * carpetas tipo:
 *   "Sentencias Tribunal <Ciudad> <Año>"      → instancia
 *   "Sentencias Corte Nacional <Ciudad> <Año>" → casación
 *
 * Las causas/casaciones SÍ existen en BD; lo único que falta es el PDF
 * vinculado a `file_pdf`. Este script:
 *   1. Recorre una carpeta source recursivamente.
 *   2. Por cada PDF, extrae el código de juicio del nombre.
 *      Patrón: <TRIBUNAL 4|5 dig><AÑO 4><SECUENCIA 5>_resto.pdf
 *   3. Busca la causa por `juicio` en BD.
 *   4. Si es instancia → vincula al `causa.file_pdf`.
 *      Si es casación → busca la `casacion` vía `casaciones_causa_lnk`
 *      y vincula a `casacion.file_pdf`.
 *   5. Copia el archivo a `/uploads/sentencias_{tipo}/<hash>.pdf`,
 *      inserta el row en `files` y una row en `files_related_mph` por cada
 *      revisión de la entidad (draft + publish).
 *
 * Sin sobrescritura. Si la entidad ya tiene `file_pdf` vinculado, skip y
 * reporta. Si la causa no existe → reporta como huérfano y skip.
 *
 * Cómo correrlo
 * -------------
 * Dry-run en local:
 *   npx tsx scripts/upload-pending-pdfs.ts \
 *     --source="/Users/.../Sentencias Tribunal Cuenca 2021" \
 *     --tipo=instancia \
 *     --uploads-path=./public/uploads \
 *     --db-url='postgres://strapi:strapi@localhost:5433/strapi'
 *
 * Execute (sube y vincula):
 *   añadir --execute
 *
 * Tipo se detecta automáticamente si el path contiene "Tribunal" o
 * "Corte Nacional". `--tipo=` lo fuerza.
 */

import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type Tipo = 'instancia' | 'casacion';

type Status =
  | 'planned'
  | 'uploaded'
  | 'huerfano_causa_no_existe'
  | 'huerfano_casacion_no_existe'
  | 'ya_tenia_pdf'
  | 'nombre_no_parseable'
  | 'failed_copy'
  | 'failed_insert';

type ReportEntry = {
  source_path: string;
  filename: string;
  tipo: Tipo;
  juicio_extraido: string | null;
  causa_document_id: string | null;
  related_ids: number[];
  status: Status;
  hash?: string;
  new_disk_path?: string;
  new_url?: string;
  file_id?: number;
  error?: string;
};

type Args = {
  execute: boolean;
  source: string;
  tipo: Tipo;
  uploadsPath: string;
  dbUrl: string;
  limit: number | null;
  reportPath: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : null;
  };
  const has = (k: string) => argv.includes(`--${k}`);

  const source = get('source');
  if (!source) throw new Error('Falta --source=<ruta a carpeta con PDFs>');

  const uploadsPath = get('uploads-path');
  if (!uploadsPath) throw new Error('Falta --uploads-path=<ruta abs a uploads>');

  const dbUrl = get('db-url') || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('Falta --db-url=<conn string> o env DATABASE_URL');

  // Detectar tipo del nombre de la carpeta si no se pasó explícito.
  const tipoArg = get('tipo') as Tipo | null;
  let tipo: Tipo;
  if (tipoArg) {
    if (tipoArg !== 'instancia' && tipoArg !== 'casacion') {
      throw new Error('--tipo debe ser "instancia" o "casacion"');
    }
    tipo = tipoArg;
  } else {
    const folderName = path.basename(source);
    if (/Tribunal/i.test(folderName)) tipo = 'instancia';
    else if (/Corte\s+Nacional/i.test(folderName)) tipo = 'casacion';
    else
      throw new Error(
        `No pude detectar tipo del nombre de carpeta "${folderName}". Pasalo con --tipo=instancia|casacion`
      );
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultReport = path.join(process.cwd(), 'reports', `upload-${ts}.json`);

  return {
    execute: has('execute'),
    source: path.resolve(source),
    tipo,
    uploadsPath: path.resolve(uploadsPath),
    dbUrl,
    limit: get('limit') ? Number(get('limit')) : null,
    reportPath: get('report') || defaultReport,
  };
}

// Patrón: primer "grupo" antes del primer "_" son 13 (tribunal 4 + año 4 + sec 5)
// o 14 dígitos (tribunal 5 + año 4 + sec 5).
function extractJuicio(filename: string): string | null {
  const m = filename.match(/^(\d{13,14})_/);
  if (!m) return null;
  const d = m[1];
  if (d.length === 14) {
    return `${d.slice(0, 5)}-${d.slice(5, 9)}-${d.slice(9, 14)}`;
  }
  // length === 13
  return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8, 13)}`;
}

// 24 chars lowercase alphanumeric. Strapi 5 usa una librería específica pero
// el formato observado en BD es este; lo único que importa es que sea único.
function generateDocumentId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = crypto.randomBytes(24);
  for (let i = 0; i < 24; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Replica el patrón de Strapi local provider:
//   original "01501...P20.pdf.pdf" → quita doble ext si la hay,
//   luego en el restante "01501...P20.pdf" reemplaza "." por "_",
//   luego "_<10 hex>".
function generateHash(originalName: string): string {
  let base = originalName;
  // Sacar la última extensión .pdf
  if (/\.pdf\.pdf$/i.test(base)) base = base.slice(0, -4);
  else if (/\.pdf$/i.test(base)) base = base.slice(0, -4);
  const sanitized = base.replace(/\./g, '_');
  const suffix = crypto.randomBytes(5).toString('hex');
  return `${sanitized}_${suffix}`;
}

function listPdfsRecursively(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && /\.pdf$/i.test(entry.name)) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

type CausaRow = { id: number; document_id: string };

async function findCausaRows(client: Client, juicio: string): Promise<CausaRow[]> {
  // Strapi 5 draft+publish: pueden haber 1 o 2 rows con mismo document_id.
  const res = await client.query(
    `SELECT id, document_id FROM causas WHERE juicio = $1`,
    [juicio]
  );
  return res.rows;
}

async function findCasacionRowsForCausa(
  client: Client,
  causaIds: number[]
): Promise<CausaRow[]> {
  // Una casación está vinculada a una causa via casaciones_causa_lnk.
  // Si la causa tiene draft+publish, puede haber lnks separados; devolvemos
  // las casaciones únicas por document_id.
  const res = await client.query(
    `SELECT DISTINCT ON (cas.document_id) cas.id, cas.document_id
     FROM casaciones cas
     JOIN casaciones_causa_lnk lnk ON lnk.casacion_id = cas.id
     WHERE lnk.causa_id = ANY($1::int[])`,
    [causaIds]
  );
  // Pero necesitamos TODAS las rows (draft+publish) de cada casación para
  // poder insertar la morph row a ambas. Re-buscamos por document_ids.
  if (res.rows.length === 0) return [];
  const docIds = res.rows.map((r: any) => r.document_id);
  const all = await client.query(
    `SELECT id, document_id FROM casaciones WHERE document_id = ANY($1::text[])`,
    [docIds]
  );
  return all.rows;
}

async function entityHasPdf(
  client: Client,
  relatedType: string,
  relatedIds: number[]
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM files_related_mph
     WHERE field = 'file_pdf' AND related_type = $1 AND related_id = ANY($2::int[])
     LIMIT 1`,
    [relatedType, relatedIds]
  );
  return res.rowCount! > 0;
}

async function insertFileAndRelations(
  client: Client,
  args: {
    originalName: string;
    hash: string;
    ext: string;
    sizeKB: number;
    url: string;
    folderPath: string;
    relatedType: string;
    relatedIds: number[];
  }
): Promise<number> {
  // Transacción: insertar file + N morph rows. Si falla algo, rollback.
  await client.query('BEGIN');
  try {
    const documentId = generateDocumentId();
    const fileRes = await client.query(
      `INSERT INTO files (
        document_id, name, hash, ext, mime, size, url, provider,
        folder_path, created_at, updated_at, published_at
      ) VALUES (
        $1, $2, $3, $4, 'application/pdf', $5, $6, 'local',
        $7, NOW(), NOW(), NOW()
      ) RETURNING id`,
      [
        documentId,
        args.originalName,
        args.hash,
        args.ext,
        args.sizeKB,
        args.url,
        args.folderPath,
      ]
    );
    const fileId = fileRes.rows[0].id;

    for (const relId of args.relatedIds) {
      await client.query(
        `INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
         VALUES ($1, $2, $3, 'file_pdf', 1)`,
        [fileId, relId, args.relatedType]
      );
    }

    await client.query('COMMIT');
    return fileId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function processFile(
  client: Client,
  filePath: string,
  args: Args
): Promise<ReportEntry> {
  const filename = path.basename(filePath);
  const subfolder = `sentencias_${args.tipo}`;

  const entry: ReportEntry = {
    source_path: filePath,
    filename,
    tipo: args.tipo,
    juicio_extraido: null,
    causa_document_id: null,
    related_ids: [],
    status: 'planned',
  };

  const juicio = extractJuicio(filename);
  if (!juicio) {
    entry.status = 'nombre_no_parseable';
    entry.error = `No se pudo extraer juicio del nombre "${filename}"`;
    return entry;
  }
  entry.juicio_extraido = juicio;

  // Buscar causa.
  const causaRows = await findCausaRows(client, juicio);
  if (causaRows.length === 0) {
    entry.status = 'huerfano_causa_no_existe';
    return entry;
  }
  entry.causa_document_id = causaRows[0].document_id;

  // Determinar a qué entidad y rows vincular.
  let relatedType: string;
  let relatedIds: number[];
  if (args.tipo === 'instancia') {
    relatedType = 'api::causa.causa';
    relatedIds = causaRows.map((r) => r.id);
  } else {
    const casacionRows = await findCasacionRowsForCausa(
      client,
      causaRows.map((r) => r.id)
    );
    if (casacionRows.length === 0) {
      entry.status = 'huerfano_casacion_no_existe';
      return entry;
    }
    relatedType = 'api::casacion.casacion';
    relatedIds = casacionRows.map((r) => r.id);
  }
  entry.related_ids = relatedIds;

  // Verificar si ya tiene PDF vinculado.
  if (await entityHasPdf(client, relatedType, relatedIds)) {
    entry.status = 'ya_tenia_pdf';
    return entry;
  }

  // Construir destino físico y URL.
  const hash = generateHash(filename);
  // Extensión final: siempre ".pdf" (lo normalizamos aunque venga ".pdf.pdf").
  const ext = '.pdf';
  const destFilename = `${hash}${ext}`;
  const newDiskPath = path.join(args.uploadsPath, subfolder, destFilename);
  const newUrl = `/uploads/${subfolder}/${destFilename}`;

  entry.hash = hash;
  entry.new_disk_path = newDiskPath;
  entry.new_url = newUrl;

  if (!args.execute) return entry;

  // EXECUTE: copiar archivo y insertar.
  try {
    fs.mkdirSync(path.dirname(newDiskPath), { recursive: true });
    fs.copyFileSync(filePath, newDiskPath);
  } catch (e: any) {
    entry.status = 'failed_copy';
    entry.error = e?.message ?? String(e);
    return entry;
  }

  try {
    const sizeBytes = fs.statSync(filePath).size;
    const sizeKB = Math.round((sizeBytes / 1024) * 100) / 100;
    const fileId = await insertFileAndRelations(client, {
      originalName: filename,
      hash,
      ext,
      sizeKB,
      url: newUrl,
      folderPath: `/${subfolder}`,
      relatedType,
      relatedIds,
    });
    entry.file_id = fileId;
    entry.status = 'uploaded';
  } catch (e: any) {
    // Rollback del filesystem si el INSERT falló.
    try {
      fs.unlinkSync(newDiskPath);
    } catch {}
    entry.status = 'failed_insert';
    entry.error = e?.message ?? String(e);
  }

  return entry;
}

function summarize(entries: ReportEntry[]) {
  const out: Record<Status, number> = {
    planned: 0,
    uploaded: 0,
    huerfano_causa_no_existe: 0,
    huerfano_casacion_no_existe: 0,
    ya_tenia_pdf: 0,
    nombre_no_parseable: 0,
    failed_copy: 0,
    failed_insert: 0,
  };
  for (const e of entries) out[e.status]++;
  return out;
}

async function main() {
  const args = parseArgs();

  if (!fs.existsSync(args.source) || !fs.statSync(args.source).isDirectory()) {
    throw new Error(`--source no es un directorio válido: ${args.source}`);
  }

  console.log('────────────────────────────────────────');
  console.log(' Carga de PDFs pendientes');
  console.log('────────────────────────────────────────');
  console.log(' Modo         :', args.execute ? 'EXECUTE' : 'DRY-RUN');
  console.log(' Source       :', args.source);
  console.log(' Tipo         :', args.tipo);
  console.log(' Uploads path :', args.uploadsPath);
  console.log(' Limit        :', args.limit ?? '(sin límite)');
  console.log(' Reporte      :', args.reportPath);
  console.log('────────────────────────────────────────\n');

  let files = listPdfsRecursively(args.source);
  if (args.limit !== null) files = files.slice(0, args.limit);
  console.log(`PDFs a procesar: ${files.length}\n`);

  const client = new Client({ connectionString: args.dbUrl });
  await client.connect();

  const entries: ReportEntry[] = [];
  try {
    for (const f of files) {
      const e = await processFile(client, f, args);
      entries.push(e);
      const prefix =
        e.status === 'uploaded'
          ? '[OK]'
          : e.status === 'planned'
          ? '[PLAN]'
          : e.status === 'ya_tenia_pdf'
          ? '[SKIP-YA-TENIA]'
          : e.status.startsWith('huerfano')
          ? '[HUERFANO]'
          : e.status === 'nombre_no_parseable'
          ? '[NOMBRE-MAL]'
          : '[FAIL]';
      console.log(
        `${prefix} ${e.filename} → juicio ${e.juicio_extraido ?? '?'} (${e.status})`
      );
    }
  } finally {
    await client.end();
  }

  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  fs.writeFileSync(
    args.reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: args.execute ? 'execute' : 'dry-run',
        source: args.source,
        tipo: args.tipo,
        uploads_path: args.uploadsPath,
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
  for (const k of Object.keys(s)) console.log(` ${k.padEnd(30)}: ${(s as any)[k]}`);
  console.log(`\nReporte: ${args.reportPath}`);
}

main().catch((err) => {
  console.error('[upload-pending-pdfs] error:', err);
  process.exit(1);
});
