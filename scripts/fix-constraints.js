/**
 * Pre-start script: fixes database constraints and schema issues so Strapi's
 * schema sync can run without crashing.
 *
 * 0. Ensures core users-permissions columns exist (provider, confirmed, blocked, etc.)
 * 1. Drops ALL FK constraints in the public schema
 * 2. Deduplicates id columns where needed
 * 3. Restores missing primary keys on content tables
 * 4. Cleans up orphaned references in link tables
 * 5. Resets ID sequences to avoid duplicate key errors
 * 6. Sets superadmin users by email
 */
const { Client } = require('pg');

const SUPERADMIN_EMAILS = [
  'j.arias@censusconsultores.com.ec',
];

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.log('[fix-constraints] No DATABASE_URL found, skipping.');
    process.exit(0);
  }

  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('[fix-constraints] Connected to database.');

    // ── Step 0: Ensure core users-permissions columns exist on up_users ──
    const coreColumns = [
      { name: 'provider', type: 'varchar(255)', defaultVal: "'local'" },
      { name: 'confirmed', type: 'boolean', defaultVal: 'true' },
      { name: 'blocked', type: 'boolean', defaultVal: 'false' },
      { name: 'username', type: 'varchar(255)', defaultVal: null },
      { name: 'email', type: 'varchar(255)', defaultVal: null },
      { name: 'password', type: 'varchar(255)', defaultVal: null },
      { name: 'reset_password_token', type: 'varchar(255)', defaultVal: null },
      { name: 'confirmation_token', type: 'varchar(255)', defaultVal: null },
    ];

    const tableExists = await client.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'up_users' AND n.nspname = 'public' AND c.relkind = 'r'`
    );
    if (tableExists.rows.length > 0) {
      for (const col of coreColumns) {
        const colExists = await client.query(
          `SELECT 1 FROM pg_attribute WHERE attrelid = 'up_users'::regclass AND attname = $1 AND NOT attisdropped`,
          [col.name]
        );
        if (colExists.rows.length === 0) {
          const defClause = col.defaultVal ? ` DEFAULT ${col.defaultVal}` : '';
          await client.query(`ALTER TABLE "public"."up_users" ADD COLUMN "${col.name}" ${col.type}${defClause}`);
          if (col.defaultVal) {
            await client.query(`UPDATE "public"."up_users" SET "${col.name}" = ${col.defaultVal} WHERE "${col.name}" IS NULL`);
          }
          console.log(`[fix-constraints] Added missing column: up_users.${col.name}`);
        }
      }
    }

    // ── Step 1: Drop ALL FK constraints in public schema ──
    const fkRes = await client.query(`
      SELECT con.conname AS constraint_name,
             rel.relname AS table_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f'
        AND nsp.nspname = 'public'
      ORDER BY rel.relname, con.conname;
    `);

    if (fkRes.rows.length === 0) {
      console.log('[fix-constraints] No FK constraints found.');
    } else {
      console.log(`[fix-constraints] Found ${fkRes.rows.length} FK constraints to drop.`);
      for (const row of fkRes.rows) {
        const sql = `ALTER TABLE "public"."${row.table_name}" DROP CONSTRAINT IF EXISTS "${row.constraint_name}";`;
        try {
          await client.query(sql);
        } catch (err) {
          console.log(`  Warning: could not drop ${row.table_name}.${row.constraint_name}: ${err.message}`);
        }
      }
      console.log(`  Dropped ${fkRes.rows.length} FK constraints.`);
    }

    // ── Step 2: Deduplicate id columns and restore missing primary keys ──
    const pkRes = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          WHERE con.conrelid = c.oid AND con.contype = 'p'
        )
      ORDER BY c.relname;
    `);

    if (pkRes.rows.length === 0) {
      console.log('[fix-constraints] All tables have primary keys. OK.');
    } else {
      console.log(`[fix-constraints] Found ${pkRes.rows.length} tables missing primary keys.`);
      for (const row of pkRes.rows) {
        const dupCheck = await client.query(
          `SELECT id, COUNT(*) as cnt FROM "public"."${row.table_name}" GROUP BY id HAVING COUNT(*) > 1 LIMIT 1;`
        );
        if (dupCheck.rows.length > 0) {
          console.log(`  Deduplicating ${row.table_name}...`);
          await client.query(`
            DELETE FROM "public"."${row.table_name}" a
            USING "public"."${row.table_name}" b
            WHERE a.ctid < b.ctid AND a.id = b.id;
          `);
        }
        const pkName = `${row.table_name}_pkey`;
        try {
          await client.query(`ALTER TABLE "public"."${row.table_name}" ADD CONSTRAINT "${pkName}" PRIMARY KEY ("id");`);
          console.log(`  Added PK: ${row.table_name}`);
        } catch (err) {
          console.log(`  Warning: could not add PK to ${row.table_name}: ${err.message}`);
        }
      }
    }

    // ── Step 3: Clean up orphaned references in link tables ──
    const lnkRes = await client.query(`
      SELECT t.relname AS table_name, a.attname AS col_name
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid
      WHERE n.nspname = 'public' AND t.relkind = 'r'
        AND (t.relname LIKE '%_lnk' OR t.relname LIKE '%_cmps' OR t.relname LIKE '%_links')
        AND a.attname LIKE '%_id' AND a.attname != 'id'
        AND NOT a.attisdropped AND a.attnum > 0
      ORDER BY t.relname, a.attname;
    `);
    if (lnkRes.rows.length > 0) {
      console.log(`[fix-constraints] Checking ${lnkRes.rows.length} FK columns for orphaned refs...`);
      for (const row of lnkRes.rows) {
        const col = row.col_name;
        const base = col.replace(/_id$/, '');
        const candidates = [base, base + 's', 'up_' + base + 's', 'admin_' + base + 's', 'strapi_' + base + 's'];
        let parentTable = null;
        for (const c of candidates) {
          const exists = await client.query(
            `SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname = $1`, [c]
          );
          if (exists.rows.length > 0) { parentTable = c; break; }
        }
        if (parentTable) {
          const delRes = await client.query(
            `DELETE FROM "public"."${row.table_name}" WHERE "${col}" IS NOT NULL AND "${col}" NOT IN (SELECT id FROM "public"."${parentTable}")`
          );
          if (delRes.rowCount > 0) {
            console.log(`  Cleaned ${delRes.rowCount} orphans: ${row.table_name}.${col} -> ${parentTable}`);
          }
        }
      }
    }

    // ── Step 4: Reset all ID sequences to max(id) + 1 ──
    const seqRes = await client.query(`
      SELECT t.relname AS table_name, s.relname AS seq_name
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_namespace n ON n.oid = s.relnamespace
      WHERE s.relkind = 'S' AND n.nspname = 'public'
      ORDER BY t.relname;
    `);
    if (seqRes.rows.length > 0) {
      console.log(`[fix-constraints] Resetting ${seqRes.rows.length} ID sequences...`);
      let resetCount = 0;
      for (const row of seqRes.rows) {
        try {
          const maxRes = await client.query(`SELECT COALESCE(MAX(id), 0) as max_id FROM "public"."${row.table_name}";`);
          const maxId = parseInt(maxRes.rows[0].max_id, 10);
          const seqRes2 = await client.query(`SELECT last_value FROM "public"."${row.seq_name}";`);
          const seqVal = parseInt(seqRes2.rows[0].last_value, 10);
          if (seqVal <= maxId) {
            await client.query(`SELECT setval('"public"."${row.seq_name}"', ${maxId + 1}, false);`);
            resetCount++;
          }
        } catch (err) {
          // skip tables without id column or other issues
        }
      }
      console.log(`  Reset ${resetCount} sequences.`);
    }

    // ── Step 5: Set superadmin users by email ──
    const roleColCheck = await client.query(
      `SELECT 1 FROM pg_attribute WHERE attrelid = 'up_users'::regclass AND attname = 'user_role' AND NOT attisdropped`
    );
    if (roleColCheck.rows.length > 0) {
      for (const email of SUPERADMIN_EMAILS) {
        const upd = await client.query(
          `UPDATE up_users SET user_role = 'superadmin' WHERE email = $1 AND (user_role IS NULL OR user_role != 'superadmin')`,
          [email]
        );
        if (upd.rowCount > 0) {
          console.log(`[fix-constraints] Set superadmin: ${email}`);
        }
      }
    }

    console.log('[fix-constraints] Done. Strapi will handle remaining schema sync on startup.');
  } catch (err) {
    console.error('[fix-constraints] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
