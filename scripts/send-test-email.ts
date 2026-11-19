/**
 * Sprint 12 · Script de prueba de envío SMTP
 *
 * Propósito
 * ---------
 * Validar, FUERA del servidor Strapi, que las variables SMTP_* configuradas
 * efectivamente permiten enviar un correo real. Útil para:
 *   1. Comprobar el App Password de Google antes de subirlo a Render.
 *   2. Hacer una prueba puntual ("¿llega el correo de recuperación?").
 *   3. Debuggear errores de autenticación sin levantar todo Strapi.
 *
 * Cómo correrlo
 * -------------
 * Proveedor: Titan Mail (smtp.titan.email). Desde la raíz de `cms/`:
 *
 *   SMTP_HOST=smtp.titan.email \
 *   SMTP_PORT=465 \
 *   SMTP_SECURE=true \
 *   SMTP_USER=info@lacortedicetributaria.com \
 *   SMTP_PASS='<<< contraseña Titan >>>' \
 *   SMTP_FROM_EMAIL=info@lacortedicetributaria.com \
 *   SMTP_FROM_NAME='La Corte Dice Tributaria' \
 *   npx tsx scripts/send-test-email.ts j.arias@censusconsultores.com.ec
 *
 * Argumento posicional: destinatario. Si se omite, usa info@lacortedicetributaria.com.
 *
 * Modos
 * -----
 *   --welcome       (default) envía el template de bienvenida
 *   --relaunch      envía el template de relanzamiento
 *   --recovery      envía el template de recuperación con password de prueba
 *   --plain         envía un correo de texto simple (no usa templates)
 *
 * Salida
 * ------
 * El script imprime { sent, dryRun, messageId?, error? } y termina con exit 0
 * si el envío fue exitoso o si quedó en DRY-RUN (por credenciales faltantes);
 * con exit 1 si hubo un error real del servidor SMTP.
 */

import {
  isConfigured,
  sendMail,
  sendWelcomeEmail,
  sendRelaunchEmail,
  sendPasswordResetEmail,
  type MailResult,
} from '../src/plugins/admin-panel/server/src/services/mailer';

async function main() {
  const args = process.argv.slice(2);
  const to = args.find((a) => !a.startsWith('--')) || 'info@lacortedicetributaria.com';

  const mode =
    (args.includes('--relaunch') && 'relaunch') ||
    (args.includes('--recovery') && 'recovery') ||
    (args.includes('--plain')    && 'plain')    ||
    'welcome';

  console.log('────────────────────────────────────────────────');
  console.log(' La Corte Dice Tributaria · test SMTP');
  console.log('────────────────────────────────────────────────');
  console.log(' Destinatario :', to);
  console.log(' Modo         :', mode);
  console.log(' Configurado  :', isConfigured() ? 'SÍ (se enviará de verdad)' : 'NO (DRY-RUN)');
  console.log(' From         :', process.env.SMTP_FROM_EMAIL ?? '(usará default)');
  console.log(' Host         :', process.env.SMTP_HOST ?? '(no set)');
  console.log(' Puerto       :', process.env.SMTP_PORT ?? '587');
  console.log(' Secure       :', process.env.SMTP_SECURE ?? 'false');
  console.log('────────────────────────────────────────────────');

  let result: MailResult;

  switch (mode) {
    case 'relaunch':
      result = await sendRelaunchEmail({
        to,
        nombre: 'John (prueba)',
      });
      break;

    case 'recovery':
      result = await sendPasswordResetEmail({
        to,
        nombre: 'John (prueba)',
        email: to,
        passwordTemporal: 'Hx7-pQm!4aB',
        loginUrl: 'https://lacortedicetributaria.com/login',
      });
      break;

    case 'plain':
      result = await sendMail({
        to,
        subject: '[TEST] La Corte Dice Tributaria — prueba de SMTP',
        html:
          '<p>Hola,</p>' +
          '<p>Este es un correo de prueba del servicio SMTP de La Corte Dice Tributaria. ' +
          'Si lo estás leyendo, la configuración está correcta.</p>' +
          '<p>— El equipo</p>',
      });
      break;

    case 'welcome':
    default:
      result = await sendWelcomeEmail({
        to,
        nombre: 'John (prueba)',
        email: to,
        passwordTemporal: 'Hx7-pQm!4aB',
      });
      break;
  }

  console.log('\nResultado:', JSON.stringify(result, null, 2));

  if (result.sent) {
    console.log('\n✅ Correo enviado. Revisa la bandeja de entrada de', to);
    process.exit(0);
  }

  if (result.dryRun) {
    console.log('\n⚠️  DRY-RUN: faltaron credenciales SMTP. No se envió nada. Configura');
    console.log('   SMTP_HOST / SMTP_USER / SMTP_PASS y vuelve a correr el script.');
    process.exit(0);
  }

  console.error('\n❌ Fallo al enviar:', result.error);
  process.exit(1);
}

main().catch((err) => {
  console.error('[send-test-email] error no controlado:', err);
  process.exit(1);
});
