/**
 * Sprint 12 · Script de reset de contraseña (uso operativo)
 *
 * Propósito
 * ---------
 * Reinicia la contraseña de un usuario directamente en DB, para casos de
 * emergencia en que el flujo de recuperación vía correo no está disponible
 * (p.ej. credenciales SMTP rotas, Titan bloqueado, etc.).
 *
 * Este script NO requiere Strapi corriendo: se conecta directo a Postgres
 * usando DATABASE_URL (o las variables DATABASE_HOST/USER/NAME/PASSWORD).
 *
 * Cómo correrlo en la Render Shell
 * --------------------------------
 *   cd /opt/render/project/src/cms
 *   node scripts/reset-user-password.js <email> <nuevaContraseña> [--no-force-change]
 *
 * Por defecto setea mustChangePassword=true para forzar al usuario a cambiar
 * su contraseña al primer login. Con --no-force-change se deja en false.
 *
 * Ejemplo:
 *   node scripts/reset-user-password.js j.arias@censusconsultores.com.ec 'MiTempSegura!2026'
 */

/* eslint-disable no-console */
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function main() {
  const args = process.argv.slice(2).filter((a) => !!a);
  const noForce = args.includes('--no-force-change');
  const positional = args.filter((a) => !a.startsWith('--'));

  if (positional.length < 2) {
    console.error('Uso: node scripts/reset-user-password.js <email> <nuevaContraseña> [--no-force-change]');
    process.exit(1);
  }

  const email = positional[0];
  const newPassword = positional[1];

  if (newPassword.length < 8) {
    console.error('La nueva contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  const clientConfig = connectionString
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DATABASE_HOST,
        port: parseInt(process.env.DATABASE_PORT || '5432', 10),
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      };

  const client = new Client(clientConfig);
  await client.connect();

  try {
    const found = await client.query(
      'SELECT id, email, username FROM up_users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (found.rowCount === 0) {
      console.error(`No se encontró un usuario con email ${email}`);
      process.exit(2);
    }

    const user = found.rows[0];
    console.log(`Usuario encontrado: id=${user.id}, email=${user.email}, username=${user.username}`);

    const hash = await bcrypt.hash(newPassword, 10);

    const updateResult = await client.query(
      'UPDATE up_users SET password = $1, "mustChangePassword" = $2, "passwordChangedAt" = NOW() WHERE id = $3 RETURNING id, email',
      [hash, noForce ? false : true, user.id]
    );

    console.log('Password actualizada correctamente.');
    console.log('  id:', updateResult.rows[0].id);
    console.log('  email:', updateResult.rows[0].email);
    console.log('  mustChangePassword:', !noForce);
    console.log('');
    console.log('Nueva contraseña (temporal):', newPassword);
    console.log('Borra este log cuando termines para no dejar la contraseña en el historial.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[reset-user-password] error:', err.message);
  process.exit(1);
});
