/**
 * Sprint 12 · Mailer — servicio de correo transaccional
 *
 * Usa nodemailer con SMTP configurado por variables de entorno.
 * Proveedor actual: Titan Mail (smtp.titan.email, 465 SSL).
 *
 *   SMTP_HOST         — smtp.titan.email
 *   SMTP_PORT         — 465 (SSL) o 587 (STARTTLS)
 *   SMTP_USER         — info@lacortedicetributaria.com (email completo)
 *   SMTP_PASS         — contraseña del buzón Titan
 *   SMTP_FROM_EMAIL   — info@lacortedicetributaria.com
 *   SMTP_FROM_NAME    — "La Corte Dice Tributaria"
 *   SMTP_SECURE       — "true" para puerto 465, "false" para 587
 *
 * Si faltan credenciales, el mailer queda en modo DRY-RUN:
 *   - NO envía
 *   - Loguea el correo renderizado a stdout
 *   - Retorna { sent: false, dryRun: true }
 *
 * Esto permite probar todo el flujo (crear usuarios, bulk, relanzamiento)
 * SIN haber configurado SMTP todavía.
 */

import { personalizeStoreLinks } from './acquisition';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import juice from 'juice';

export interface MailResult {
  sent: boolean;
  dryRun: boolean;
  messageId?: string;
  error?: string;
}

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Cabeceras extra. Las usa el envio masivo para List-Unsubscribe. */
  headers?: Record<string, string>;
}

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter | null {
  // Override explícito para desarrollo: MAIL_DRY_RUN=true fuerza el modo
  // simulación aunque haya credenciales SMTP configuradas. Útil cuando
  // querés probar el flujo sin mandar correos reales y sin tener que
  // comentar / descomentar credenciales cada vez (que además quedaban
  // atrapadas en `cachedTransport` y requerían reiniciar el proceso).
  if (process.env.MAIL_DRY_RUN === 'true') return null;

  if (cachedTransport) return cachedTransport;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  cachedTransport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
    auth: { user, pass },
  });
  return cachedTransport;
}

export function isConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(opts: SendOptions): Promise<MailResult> {
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'info@lacortedicetributaria.com';
  const fromName  = process.env.SMTP_FROM_NAME  || 'La Corte Dice Tributaria';
  const from = `"${fromName}" <${fromEmail}>`;

  const transport = getTransport();
  if (!transport) {
    // DRY RUN — logs y sigue
    console.log('[mailer] DRY-RUN (SMTP no configurado)');
    console.log('  to      :', opts.to);
    console.log('  subject :', opts.subject);
    console.log('  from    :', from);
    console.log('  html len:', opts.html.length, 'chars');
    return { sent: false, dryRun: true };
  }

  try {
    // Prepare per-recipient links immediately before sending; previews never create tracking rows.
    if (/\/ir\/(app-store|play-store|microsoft-store)/.test(opts.html)) {
      const db = (global as any).strapi?.db?.connection;
      if (!db) throw new Error('Tracking database unavailable; marketing email not sent');
      const linked = await personalizeStoreLinks(db, opts.html, opts.text, opts.to,
        process.env.APP_PUBLIC_URL || 'https://app.lacortedicetributaria.com');
      opts = {...opts, ...linked};
    }
    const info = await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? stripHtml(opts.html),
      replyTo: opts.replyTo ?? fromEmail,
      headers: opts.headers,
    });
    return { sent: true, dryRun: false, messageId: info.messageId };
  } catch (err: any) {
    console.error('[mailer] send failed:', err?.message ?? err);
    return { sent: false, dryRun: false, error: err?.message ?? String(err) };
  }
}

/**
 * Versión de texto plano del correo (parte `text/plain`). Los filtros de
 * spam desconfían de un HTML sin alternativa de texto o con una alternativa
 * que no se parece al HTML; ésta conserva los saltos de párrafo, los
 * enlaces y omite el texto oculto de vista previa.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // texto de vista previa (oculto en el HTML): no va en el texto plano
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
    // enlaces: "texto (url)", salvo mailto y anclas de imagen
    .replace(/<a[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const t = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return t ? `${t} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Templating ----------------------------------------------------------
// Lee los archivos HTML de <project_root>/email-templates/ y aplica
// sustitución simple de {{variables}}. No soporta lógica (if/loops)
// — intencional: los correos transaccionales de Sprint 12 no lo requieren.
//
// Usamos process.cwd() (raíz del proyecto Strapi) en lugar de __dirname
// para evitar que el bundler del SDK del plugin rompa la resolución tras
// `npx @strapi/sdk-plugin build`.

function resolveTemplateDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'email-templates'),
    // fallback si alguien corre el script desde un subdir raro
    path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'email-templates'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return candidates[0];
}

/**
 * Base pública de las imágenes de los correos (logotipos en
 * `public/email/`). Los clientes de correo no muestran SVG ni data-URIs
 * (Gmail las bloquea), así que van como PNG alojados en el CMS y se
 * referencian por URL absoluta. `PUBLIC_URL` es la misma variable que usa
 * Strapi para `server.url`.
 */
function assetsUrl(): string {
  // Por defecto, el dominio de la aplicación: el mismo de la organización
  // que firma el correo (mejor reputación que un subdominio de onrender).
  // `EMAIL_ASSETS_URL` permite apuntar a otro sitio sin tocar código.
  const base = process.env.EMAIL_ASSETS_URL || 'https://app.lacortedicetributaria.com/images/email';
  return base.replace(/\/$/, '');
}

/**
 * EL CSS SE INCRUSTA EN CADA ETIQUETA ANTES DE ENVIAR
 * ---------------------------------------------------
 * Las plantillas se escriben con un bloque <style> porque así se pueden leer
 * y mantener. Pero eso no es lo que puede salir por correo: hay clientes que
 * borran el <style> entero al mostrar el mensaje, y entonces el correo llega
 * como texto pelado —sin la franja de gratuidad, sin botones, sin colores—.
 * Se comprobó en una prueba real: llegó el contenido completo y ni un solo
 * estilo.
 *
 * `juice` copia cada regla del <style> al atributo `style=` del elemento que
 * le toca, que es lo único que ningún cliente puede quitar. El <style> se
 * conserva además (`preserveMediaQueries`) porque las @media —lo que adapta
 * el correo al móvil— NO se pueden incrustar en un atributo y solo funcionan
 * ahí; quien respete el <style> las aprovecha, y quien lo borre se queda con
 * el diseño de escritorio, que sigue siendo legible.
 *
 * Se hace al renderizar y no a mano sobre el archivo: una plantilla con 122
 * atributos `style` escritos a mano es una plantilla que nadie vuelve a tocar.
 */
export function renderTemplate(name: string, vars: Record<string, string>): string {
  const dir = resolveTemplateDir();
  const file = path.join(dir, `${name}.html`);
  const raw = fs.readFileSync(file, 'utf8');
  const all: Record<string, string> = { assets_url: assetsUrl(), ...vars };
  const html = raw.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_, key) => {
    return all[key] ?? '';
  });

  try {
    return juice(html, {
      preserveMediaQueries: true,
      preserveImportant: true,
      removeStyleTags: false,
      xmlMode: false,
    });
  } catch (err: any) {
    // Si el incrustado falla, sale el HTML tal cual: peor es no mandar nada.
    // Queda como error y no como aviso porque el correo saldrá sin estilos en
    // una parte de los buzones y eso hay que verlo en el registro.
    console.error(`[mailer] no se pudo incrustar el CSS de ${name}: ${err?.message ?? err}`);
    return html;
  }
}

// ---- Templates de alto nivel ---------------------------------------------

export async function sendWelcomeEmail(params: {
  to: string;
  nombre: string;
  email: string;
  passwordTemporal: string;
}): Promise<MailResult> {
  const html = renderTemplate('welcome', {
    nombre: params.nombre,
    email: params.email,
    password_temporal: params.passwordTemporal,
  });
  return sendMail({
    to: params.to,
    subject: 'Bienvenido a La Corte Dice Tributaria — tu acceso',
    html,
  });
}

export async function sendRelaunchEmail(params: {
  to: string;
  nombre: string;
}): Promise<MailResult> {
  const html = renderTemplate('relaunch', {
    nombre: params.nombre,
  });
  return sendMail({
    to: params.to,
    subject: 'Estrenamos casa — y un juego. Vuelve a ver La Corte Dice Tributaria',
    html,
  });
}

/**
 * Lanzamiento de la app nativa (iOS + Android).
 *
 * Un solo HTML para dos audiencias, que se diferencian en el bloque final:
 *   · `cuenta_activa` — quien ya entra normalmente a la plataforma.
 *   · `usuario_enviado` — a quien se le creó un usuario y todavía no lo
 *     estrena (o no terminó de verificarlo).
 *
 * Las URLs de tienda viven acá y no en el HTML para poder cambiarlas sin
 * volver a tocar la plantilla.
 */
export const URL_APP_STORE =
  'https://apps.apple.com/us/app/la-corte-dice-tributaria/id6808291300?l=es-MX';
export const URL_GOOGLE_PLAY =
  'https://play.google.com/store/apps/details?id=ec.com.lacortedicetributaria.app';

/**
 * Los botones del correo NO apuntan directo a la tienda.
 *
 * Yendo directo, saber si el correo sirvió dependía de que la tienda lo
 * contara: Google lo hace si el enlace trae `referrer`; Apple solo cuenta
 * campañas con el token de proveedor de App Store Connect. El puente
 * `/ir/...` de la web deja el clic registrado en nuestra trazabilidad y
 * después redirige a la tienda con esas mismas etiquetas puestas. Así el
 * número existe aunque la tienda no lo reporte.
 *
 * `u` es el id numérico de la cuenta, cuando la hay: permite cruzar «hizo
 * clic desde el correo» con «terminó instalando la app». Nunca viaja el
 * correo de la persona en el enlace.
 */
// OJO CON EL HOST. El puente /ir/... vive en la aplicación SvelteKit, que se
// sirve en app.lacortedicetributaria.com. En lacortedicetributaria.com —el
// sitio institucional— esa ruta NO existe: responde 200 con otra página, así
// que el botón del correo llevaba al lugar equivocado en vez de a la tienda.
// Se detectó probando el enlace a mano antes de enviar; habría afectado a los
// 672 destinatarios del correo de lanzamiento.
//
// Por eso NO se usa PUBLIC_URL: apunta al sitio institucional. Va el host de
// la aplicación, el mismo que ya usa EMAIL_ASSETS_URL.
const URL_APP = process.env.APP_PUBLIC_URL || 'https://app.lacortedicetributaria.com';
export const CAMPANA_LANZAMIENTO = 'correo-lanzamiento';

/*
 * El lanzamiento son DOS campañas, no una con dos versiones del texto.
 *
 * Son dos públicos que no se parecen en nada de lo que importa para un envío
 * masivo. Quien ya usa la plataforma abre, hace clic y casi nunca se queja:
 * ese tráfico es el que le enseña a Gmail que este remitente se quiere
 * recibir. Quien recibió un usuario y nunca lo estrenó hace meses es, a
 * efectos del filtro, un desconocido. Mezclarlos entierra la señal buena en
 * la mala y obliga a mandarlos a la vez, cuando lo que conviene es lo
 * contrario: los activos primero, para que su reputación sostenga el resto.
 */
export const CAMPANA_LANZAMIENTO_INVITADOS = 'correo-lanzamiento-invitados';

function enlaceTienda(
  destino: 'app-store' | 'play-store' | 'microsoft-store',
  userId?: number | null,
  campana: string = CAMPANA_LANZAMIENTO,
): string {
  const q = new URLSearchParams({ c: campana });
  if (userId) q.set('u', String(userId));
  return `${URL_APP}/ir/${destino}?${q.toString()}`;
}

/**
 * ¿Windows ya está publicado?
 *
 * La app de Microsoft Store llega semanas después que las otras dos: hay que
 * esperar la verificación de la empresa, reservar el nombre, empaquetar en
 * MSIX y pasar la certificación. El correo NO puede quedarse esperando a
 * eso —Apple aprueba antes— y tampoco puede prometer una tienda donde
 * todavía no hay nada.
 *
 * Por eso Windows es un interruptor y no una fecha: con `URL_MICROSOFT_STORE`
 * cargada, el correo trae su botón y su mención; sin ella, el mismo correo
 * sale hablando sólo de lo que existe. No hay que tocar la plantilla ni
 * volver a desplegar cuando llegue el día: se carga la variable y listo.
 *
 * El mismo valor va en la webapp, que es quien resuelve /ir/microsoft-store.
 */
function windowsPublicado(): boolean {
  return Boolean((process.env.URL_MICROSOFT_STORE ?? '').trim());
}

/** Lista de plataformas para el cuerpo del correo, según lo que exista hoy. */
function listaPlataformas(): string {
  return windowsPublicado()
    ? 'iPhone, iPad, Android, Mac y Windows'
    : 'iPhone, iPad, Android y Mac';
}

/**
 * Tercer botón de tienda. Va vacío mientras Windows no esté publicado: un
 * botón que lleva a una ficha inexistente cuesta más que no tenerlo.
 *
 * Mismo marcado que los otros dos en la plantilla —celda con borde, insignia
 * oficial a la izquierda y texto a la derecha, cada cual con su propio <a>
 * porque envolver una <table> en un enlace se rompe en Outlook—. Se arma acá
 * y no en la plantilla porque es condicional.
 *
 * `{{assets_url}}` NO sirve dentro de este texto: renderTemplate sustituye
 * las variables en UNA pasada sobre la plantilla, así que lo que se inserta
 * ya no se vuelve a recorrer. Por eso se llama a assetsUrl() directamente.
 *
 * LA INSIGNIA: `insignia-microsoft.png` en static/images/email/ de la webapp,
 * junto a las otras dos. Tiene que ser la OFICIAL, en español, generada en
 * <https://apps.microsoft.com/badge> con la ficha ya publicada, y exportada a
 * 378×80 px para que se vea a 189×40 en retina — mismo criterio de 2x que las
 * de Apple y Google. Sólo escalada, nunca redibujada ni recortada: es lo que
 * exigen las condiciones de uso de marca.
 *
 * ORDEN AL ENCENDER WINDOWS: primero la insignia en la webapp, después la
 * variable URL_MICROSOFT_STORE. Al revés, el correo sale con un hueco donde
 * debería ir la imagen.
 */
function bloqueWindows(userId?: number | null, campana: string = CAMPANA_LANZAMIENTO): string {
  if (!windowsPublicado()) return '';
  const url = enlaceTienda('microsoft-store', userId, campana);
  const insignia = `${assetsUrl()}/insignia-microsoft.png`;
  return `
    <tr><td style="height:10px;line-height:10px;font-size:0">&nbsp;</td></tr>
    <tr>
      <td class="tiendacell store-win">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
          <tr>
            <td style="padding-right:16px;vertical-align:middle">
              <a href="${url}"><img src="${insignia}" width="189" height="40" alt="Consíguelo en Microsoft Store" style="display:block;border:0;width:189px;height:40px" /></a>
            </td>
            <td style="vertical-align:middle;text-align:left">
              <a href="${url}" style="text-decoration:none">
                <span class="store-kick" style="color:#8a7530">Gratis · Para Windows 10 y 11</span>
                <span class="store-name" style="color:#0A0A0A">Descargar en Microsoft Store</span>
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/**
 * El recuadro de la computadora. Con Windows publicado habla de las dos;
 * sin Windows, sólo del Mac, que es lo único cierto en ese momento.
 */
function notaEscritorio(): string {
  if (windowsPublicado()) {
    return `
      <p class="macnote-t">¿Trabajas en computadora?</p>
      <p class="macnote-s">
        No hace falta el teléfono. En <strong>Windows 10 y 11</strong> se instala
        desde Microsoft Store, y en un <strong>Mac con chip de Apple</strong> el
        mismo botón de App Store abre la Mac App Store. En los dos casos queda
        como un programa más: ventana que se agranda, texto a tamaño de
        computadora y el repositorio completo a la vista.
      </p>`;
  }
  return `
      <p class="macnote-t">¿Trabajas en un Mac?</p>
      <p class="macnote-s">
        Si tu Mac tiene chip de Apple (M1 o posterior), ese mismo botón abre la
        <strong>Mac App Store</strong> y la app se instala como un programa más:
        ventana que se agranda, texto a tamaño de computadora y el repositorio
        completo a la vista. No hay que comprar nada aparte.
      </p>`;
}

export type AudienciaApp = 'cuenta_activa' | 'usuario_enviado';

const BLOQUE_ACCESO: Record<AudienciaApp, string> = {
  cuenta_activa: `
    <p><strong>Tu cuenta es la misma.</strong> Entra en la app con el correo de
    siempre — o con Google o Apple, que ahora ya no piden crear contraseña. Tus
    favoritos y tu historial te esperan adentro.</p>
    <p style="margin-top:10px">¿Olvidaste la clave?
    <a href="https://lacortedicetributaria.com/recuperar">Recupérala aquí</a>.</p>`,
  usuario_enviado: `
    <p><strong>Ya tienes un usuario creado.</strong> Se te envió con tu correo a
    esta misma dirección: sirve igual en la app que en la web. Si no lo
    encuentras o nunca lo estrenaste,
    <a href="https://lacortedicetributaria.com/recuperar">crea tu clave aquí</a>
    y entras en un minuto.</p>`,
};

export async function sendAppLaunchEmail(params: {
  to: string;
  nombre: string;
  audiencia?: AudienciaApp;
  userId?: number | null;
}): Promise<MailResult> {
  const audiencia = params.audiencia ?? 'cuenta_activa';
  // Cada audiencia lleva su propia campaña: separa la medición y hace que la
  // baja de una no arrastre a la otra.
  const campana =
    audiencia === 'cuenta_activa' ? CAMPANA_LANZAMIENTO : CAMPANA_LANZAMIENTO_INVITADOS;
  const html = renderTemplate('app-lanzamiento', {
    nombre: params.nombre,
    bloque_acceso: BLOQUE_ACCESO[audiencia],
    plataformas: listaPlataformas(),
    bloque_windows: bloqueWindows(params.userId, campana),
    nota_escritorio: notaEscritorio(),
    url_ios: enlaceTienda('app-store', params.userId, campana),
    url_android: enlaceTienda('play-store', params.userId, campana),
    url_baja: urlBaja(params.to, campana),
  });
  return sendMailMasivo({
    to: params.to,
    campana,
    subject: 'La app ya está en las tiendas — gratis, con todo el repositorio',
    html,
  });
}

export async function sendInvitationVerificationEmail(params: {
  to: string;
  nombre: string;
  email: string;
  university: string;
  verifyUrl: string;
  expiresAt?: Date;
}): Promise<MailResult> {
  let expiresLabel = 'en 24 horas';
  if (params.expiresAt) {
    try {
      expiresLabel = params.expiresAt.toLocaleString('es-EC', {
        timeZone: 'America/Guayaquil',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
      });
    } catch { /* ignore */ }
  }

  const html = renderTemplate('registration-verify', {
    nombre: params.nombre,
    email: params.email,
    university: params.university,
    verify_url: params.verifyUrl,
    expires_label: expiresLabel,
  });
  return sendMail({
    to: params.to,
    subject: 'Confirma tu cuenta — La Corte Dice Tributaria',
    html,
  });
}

/**
 * Cuenta creada — segundo correo del flow de auto-registro.
 *
 * Se envía cuando el usuario completó el formulario de /registro: la
 * cuenta ya quedó activa (confirmed=true) y este correo solo confirma la
 * creación + invita a iniciar sesión.
 *
 * Reemplaza al antiguo `sendInvitationVerificationEmail` (que mandaba el
 * magic link). El magic link se retiró porque la app permite login con
 * email+password sin necesidad de verificar correo aparte.
 */
/**
 * Código de verificación de 6 dígitos para el registro (OTP por correo).
 * El código viaja en claro por el correo (es su propósito); en la base solo
 * vive su hash. Vence en 10 minutos — el copy del template lo dice.
 */
export async function sendVerificationCodeEmail(params: {
  to: string;
  email: string;
  codigo: string;
}): Promise<MailResult> {
  const html = renderTemplate('registration-code', {
    email: params.email,
    codigo: params.codigo,
  });
  return sendMail({
    to: params.to,
    subject: `${params.codigo} es tu código de La Corte Dice Tributaria`,
    html,
  });
}

export async function sendAccountCreatedEmail(params: {
  to: string;
  nombre: string;
  email: string;
  loginUrl: string;
}): Promise<MailResult> {
  const html = renderTemplate('account-created', {
    nombre: params.nombre,
    email: params.email,
    login_url: params.loginUrl,
  });
  return sendMail({
    to: params.to,
    subject: 'Tu cuenta en La Corte Dice Tributaria ha sido creada',
    html,
  });
}

/**
 * Bienvenida a un correo recién agregado a la whitelist (status `invited`).
 * Lo manda el flujo bulk/manual ANTES de que el estudiante use /registro,
 * para que sepa que fue habilitado y vea la guía paso a paso.
 *
 * Distinto de `sendAccountCreatedEmail` (ese es el correo de confirmación
 * post-formulario). Aquí no hay tokens — solo invita a iniciar el wizard.
 */
export async function sendInvitationWelcomeEmail(params: {
  to: string;
  email: string;
  university?: string | null;
  registroUrl: string;
}): Promise<MailResult> {
  // Universidad opcional: si viene vacía, ocultamos el bloque entero en el
  // template (en vez de mostrar "Universidad: —" feo).
  const universityBlock = params.university
    ? `<p class="cred-label" style="margin-top:16px">Universidad</p>
       <p class="cred-value">${escapeHtml(params.university)}</p>`
    : '';

  const html = renderTemplate('invitation-welcome', {
    email: params.email,
    university_block: universityBlock,
    registro_url: params.registroUrl,
  });
  return sendMail({
    to: params.to,
    subject: 'Has sido invitado/a a La Corte Dice Tributaria',
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPasswordResetEmail(params: {
  to: string;
  nombre: string;
  email: string;
  resetUrl: string;
  expiresAt?: Date;
}): Promise<MailResult> {
  // Formateamos la expiración en hora de Guayaquil (UTC-5) para mostrar
  // al usuario hasta cuándo es válido el link.
  let expiresLabel = 'en 1 hora';
  if (params.expiresAt) {
    try {
      expiresLabel = params.expiresAt.toLocaleString('es-EC', {
        timeZone: 'America/Guayaquil',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
      });
    } catch { /* ignore */ }
  }

  const html = renderTemplate('password-reset', {
    nombre: params.nombre,
    email: params.email,
    reset_url: params.resetUrl,
    expires_label: expiresLabel,
  });
  return sendMail({
    to: params.to,
    subject: 'Restablece tu contraseña — La Corte Dice Tributaria',
    html,
  });
}

// ---------------------------------------------------------------------------
// Invitación a profesionales del derecho tributario (directorio externo)
// ---------------------------------------------------------------------------
//
// Campaña distinta de la del lanzamiento: va a un directorio de abogados y
// asesores que NO tienen cuenta en la plataforma. Por eso el correo no habla
// de «tu cuenta» ni de recuperar clave — presenta el repositorio y explica la
// ficha técnica, que es el argumento central.
//
// El saludo NO se arma acá. Viene escrito uno por uno en la lista
// (`data/directorio-profesionales.ts`): «Estimado Dr. Fulano» donde se conoce
// a la persona, «Estimado/a» donde no. Deducir el género del nombre es
// exactamente el error que este diseño evita.
//
// En el enlace de la tienda viaja `d=<id de la lista>` en vez de `u=<id de
// usuario>`: estas personas todavía no son usuarios. El correo nunca viaja
// en la URL.

export const CAMPANA_DIRECTORIO_CORREO = 'directorio-2026-09';

function enlaceTiendaDirectorio(
  destino: 'app-store' | 'play-store',
  destinatarioId?: number | null,
): string {
  const q = new URLSearchParams({ c: CAMPANA_DIRECTORIO_CORREO });
  if (destinatarioId) q.set('d', String(destinatarioId));
  return `${URL_APP}/ir/${destino}?${q.toString()}`;
}

/*
 * El asunto lleva la gratuidad, pero DESPUÉS del beneficio.
 *
 * Al revés no funciona con este público: un asunto que empieza por «Gratis»
 * se lee como publicidad y se archiva sin abrir. Primero lo que la persona
 * gana —leer una sentencia en minutos, que es lo que hace la ficha técnica—
 * y después el precio, que es lo que retira la objeción.
 *
 * Y va corto a propósito: el anterior tenía 76 caracteres y el móvil corta
 * cerca de los 60, así que «en minutos» no llegaba a verse en el teléfono,
 * que es donde se lee casi todo.
 */
export const ASUNTO_INVITACION_PROFESIONAL =
  'Lea una sentencia tributaria en minutos — gratis, desde su teléfono';

export function renderInvitacionProfesional(params: {
  saludo: string;
  destinatarioId?: number | null;
  /** Correo del destinatario: hace falta para firmar su enlace de baja. */
  correo?: string;
}): string {
  return renderTemplate('invitacion-profesionales', {
    saludo: params.saludo,
    url_ios: enlaceTiendaDirectorio('app-store', params.destinatarioId),
    url_android: enlaceTiendaDirectorio('play-store', params.destinatarioId),
    url_baja: params.correo ? urlBaja(params.correo, CAMPANA_DIRECTORIO_CORREO) : '#',
  });
}

export async function sendInvitacionProfesional(params: {
  to: string;
  saludo: string;
  destinatarioId?: number | null;
}): Promise<MailResult> {
  return sendMailMasivo({
    to: params.to,
    campana: CAMPANA_DIRECTORIO_CORREO,
    subject: ASUNTO_INVITACION_PROFESIONAL,
    html: renderInvitacionProfesional({
      saludo: params.saludo,
      destinatarioId: params.destinatarioId,
      correo: params.to,
    }),
  });
}

// ---------------------------------------------------------------------------
// Baja del correo masivo (List-Unsubscribe)
// ---------------------------------------------------------------------------
//
// POR QUE ESTO ES LO MAS IMPORTANTE DE TODO EL ENVIO
// --------------------------------------------------
// Quien no encuentra como darse de baja no se resigna: pulsa «marcar como
// spam», que es la peor senal posible. Gmail corta la entrega de un remitente
// que pasa del 0,3 % de quejas, y Titan suspende la cuenta a las 5 quejas —la
// misma cuenta que manda las claves y los codigos de verificacion de la app—.
// El enlace de baja no es cortesia: es lo que evita que una campana tumbe el
// correo transaccional.
//
// Van las dos formas que reconoce el correo moderno:
//   · `List-Unsubscribe` con una URL y un mailto. Gmail y Outlook lo leen y
//     pintan su propio boton «Cancelar suscripcion» junto al remitente.
//   · `List-Unsubscribe-Post` (RFC 8058), que convierte ese boton en baja de
//     un clic: el proveedor hace un POST a la URL y da de baja sin abrir nada.
// Ademas del enlace visible en el pie, que es para la persona.
//
// El token es un HMAC del correo: la URL no se puede fabricar para dar de baja
// a un tercero, y no hace falta guardar nada para poder validarla. Se reutiliza
// un secreto que ya existe en el entorno para no obligar a configurar una
// variable nueva en el servidor.


function secretoBaja(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.ADMIN_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.APP_KEYS ||
    'lacortedice-baja'
  );
}

export function tokenBaja(correo: string): string {
  return crypto
    .createHmac('sha256', secretoBaja())
    .update(correo.trim().toLowerCase())
    .digest('base64url')
    .slice(0, 32);
}

export function tokenBajaValido(correo: string, token: string): boolean {
  const esperado = tokenBaja(correo);
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(token ?? ''));
  // Comparacion en tiempo constante: `timingSafeEqual` revienta si los
  // buffers miden distinto, asi que la longitud se comprueba antes.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function urlBaja(correo: string, campana: string): string {
  const q = new URLSearchParams({ e: correo, t: tokenBaja(correo), c: campana });
  return `${URL_APP}/baja?${q.toString()}`;
}

/** Cabeceras de baja para un envio masivo. Nunca en un correo transaccional. */
function cabecerasBaja(correo: string, campana: string): Record<string, string> {
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'info@lacortedicetributaria.com';
  return {
    'List-Unsubscribe': `<${urlBaja(correo, campana)}>, <mailto:${fromEmail}?subject=Baja%20${encodeURIComponent(campana)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    // Evita que las respuestas automaticas de vacaciones vuelvan al buzon y
    // marca el correo como envio de lista, que es lo que realmente es.
    Precedence: 'bulk',
  };
}

export async function sendMailMasivo(
  opts: SendOptions & { campana: string },
): Promise<MailResult> {
  return sendMail({ ...opts, headers: cabecerasBaja(opts.to, opts.campana) });
}

// ---------------------------------------------------------------------------
// Invitación a los abogados del Ranking Legal Ecuador
// ---------------------------------------------------------------------------
//
// Misma plantilla que la invitación a profesionales: el contenido sirve igual
// —presenta el repositorio y explica la ficha técnica— y mantener una sola
// plantilla evita que las dos se vayan separando con el tiempo.
//
// Lo que cambia es la campaña, y no es un detalle cosmético: separa la
// medición (qué lista responde mejor), permite mandarlas una después de otra
// en vez de las dos a la vez, y si una empieza a recibir quejas se apaga sin
// tocar la otra.
//
// El saludo va SIN tratamiento de género. En la lista hay 467 nombres y no
// hay dato de género; deducirlo del nombre de pila es exactamente el error
// que ya costó corregir a mano en el directorio anterior —Alexis, Yael y
// Adri no se dejan adivinar—. «Estimado/a» con el nombre completo es
// personal y no se equivoca.

export const CAMPANA_RANKING_CORREO = 'ranking-legal-2026-09';

export function saludoRanking(nombre: string): string {
  const limpio = (nombre ?? '').trim();
  return limpio ? `Estimado/a ${limpio}` : 'Estimado/a';
}

function enlaceTiendaRanking(
  destino: 'app-store' | 'play-store',
  destinatarioId?: number | null,
): string {
  const q = new URLSearchParams({ c: CAMPANA_RANKING_CORREO });
  if (destinatarioId) q.set('d', String(destinatarioId));
  return `${URL_APP}/ir/${destino}?${q.toString()}`;
}

export async function sendInvitacionRanking(params: {
  to: string;
  nombre: string;
  destinatarioId?: number | null;
}): Promise<MailResult> {
  const html = renderTemplate('invitacion-profesionales', {
    saludo: saludoRanking(params.nombre),
    url_ios: enlaceTiendaRanking('app-store', params.destinatarioId),
    url_android: enlaceTiendaRanking('play-store', params.destinatarioId),
    url_baja: urlBaja(params.to, CAMPANA_RANKING_CORREO),
  });
  return sendMailMasivo({
    to: params.to,
    campana: CAMPANA_RANKING_CORREO,
    subject: ASUNTO_INVITACION_PROFESIONAL,
    html,
  });
}
