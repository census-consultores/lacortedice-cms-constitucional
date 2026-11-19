import { verificarIdentidad, ErrorSocial, type Proveedor } from '../services/social-auth';

type Ctx = any;

/**
 * Login con Google y Apple.
 *
 * POST /api/admin-panel/auth/social   { provider, idToken }
 *
 * Respuestas:
 *   200 { jwt, user }              → sesión iniciada
 *   200 { needsProfile, email, … } → identidad válida, pero no hay cuenta
 *   400 { error }                  → token inválido, correo sin verificar, etc.
 *   403 { error: 'blocked' }       → cuenta desactivada
 *
 * Que «no hay cuenta» sea 200 y no 404 es deliberado: no es un error, es un
 * paso del flujo. La app muestra el formulario de registro con el correo ya
 * puesto y verificado.
 *
 * ── Lo que este endpoint NO hace ────────────────────────────────────────────
 *
 * No crea cuentas. Crear una cuenta requiere los datos obligatorios del
 * registro (nombres, apellidos, fecha de nacimiento, cargo, universidad si es
 * estudiante, teléfono, ciudad, país, intereses, aceptación de términos y de
 * privacidad) y esa validación ya vive en `registration.completar`. Meter una
 * segunda copia acá sería exactamente el problema que venimos evitando en toda
 * la app: dos caminos de alta que se separan con el primer campo que alguien
 * agregue.
 *
 * El alta desde login social se resuelve conectando este `needsProfile` con
 * `registration.completar`, que hoy exige contraseña y correo en lista blanca:
 * ambas condiciones tienen que volverse opcionales cuando el correo viene
 * verificado por el proveedor. Eso está sin hacer.
 */
const controlador = {
  async social(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      provider?: string;
      idToken?: string;
      authorizationCode?: string | null;
    };
    const provider = String(body.provider ?? '').toLowerCase();
    const idToken = String(body.idToken ?? '');
    const authorizationCode = body.authorizationCode ? String(body.authorizationCode) : null;

    if (provider !== 'google' && provider !== 'apple') {
      return ctx.badRequest('provider_invalid');
    }
    if (!idToken) return ctx.badRequest('id_token_required');

    let identidad;
    try {
      identidad = await verificarIdentidad(provider as Proveedor, idToken);
    } catch (e) {
      if (e instanceof ErrorSocial) {
        strapi.log.warn(`[auth/social] ${provider} rechazado: ${e.codigo} — ${e.message}`);
        // `provider_not_configured` es culpa nuestra, no del usuario: 503 para
        // que no se confunda con credenciales malas ni se reintente en bucle.
        if (e.codigo === 'provider_not_configured') {
          return ctx.send({ error: e.codigo }, 503);
        }
        return ctx.badRequest(e.codigo);
      }
      strapi.log.error('[auth/social] fallo inesperado', e);
      return ctx.send({ error: 'unexpected' }, 500);
    }

    const users = await strapi.entityService.findMany('plugin::users-permissions.user', {
      filters: { email: identidad.email },
      limit: 1,
    });
    const user = users?.[0];

    if (!user) {
      strapi.log.info(`[auth/social] ${provider} sin cuenta para ${identidad.email}`);
      return ctx.send({
        needsProfile: true,
        email: identidad.email,
        // Separados: el formulario de registro tiene un campo para cada uno.
        // Con Google vienen del id_token; con Apple suelen venir vacíos porque
        // Apple entrega el nombre una sola vez y por otro canal.
        nombre: identidad.nombre ?? null,
        apellido: identidad.apellido ?? null,
        provider,
      });
    }

    if (user.blocked) {
      strapi.log.warn(`[auth/social] cuenta bloqueada ${identidad.email}`);
      return ctx.send({ error: 'blocked' }, 403);
    }

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });

    // Apple: canjear el código por el refresh token que permitirá REVOCAR el
    // enlace si el usuario borra su cuenta (lo exige App Review). En segundo
    // plano y sin bloquear el login.
    if (provider === 'apple' && authorizationCode) {
      void import('../utils/apple-revocar')
        .then((m) => m.guardarRefreshTokenApple(strapi, user.id, authorizationCode))
        .catch((e) => strapi.log.warn('[auth/social] refresh token de Apple: ' + e?.message));
    }

    strapi.log.info(`[auth/social] ${provider} ok · ${identidad.email}`);

    return ctx.send({
      jwt,
      user: {
        id: user.id,
        documentId: user.documentId,
        username: user.username,
        email: user.email,
        userRole: user.userRole ?? 'user',
        subscriptionTier: user.subscriptionTier ?? 'free',
        isProfileComplete: user.isProfileComplete ?? false,
        mustChangePassword: user.mustChangePassword ?? false,
      },
    });
  },

  /**
   * POST /api/admin-panel/auth/google-escritorio  { code, codeVerifier, redirectUri }
   *
   * Login con Google desde la app de ESCRITORIO. Ahi no sirve ni el dialogo
   * nativo (no hay Capacitor) ni el SDK web de Google (el origen es
   * `lacorte://app`, y Google solo acepta https: devuelve invalid_request).
   *
   * El camino que Google recomienda para apps instaladas: la app abre el
   * navegador del sistema, recibe un `code` en 127.0.0.1 y lo canjea. El canje
   * exige el SECRETO del cliente, y por eso ocurre ACA y no dentro del
   * instalador: un .exe se abre con un descompresor y el secreto quedaria a la
   * vista de cualquiera. PKCE (`codeVerifier`) protege el tramo del loopback,
   * donde otro proceso de la misma maquina podria interceptar el `code`.
   *
   * Una vez obtenido el id_token, se delega en `social`: la verificacion
   * (firma contra el JWKS, emisor, audiencia, expiracion, correo verificado) y
   * la emision del JWT de sesion son exactamente las mismas que en movil y
   * web. Duplicarlas seria abrir un segundo camino de login que se separa del
   * primero con el primer cambio que alguien haga.
   */
  async googleEscritorio(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      code?: string;
      codeVerifier?: string;
      redirectUri?: string;
    };
    const code = String(body.code ?? '');
    const codeVerifier = String(body.codeVerifier ?? '');
    const redirectUri = String(body.redirectUri ?? '');

    if (!code || !codeVerifier || !redirectUri) {
      return ctx.badRequest('code_required');
    }
    // El redirect SIEMPRE es el loopback que abrio la app. Aceptar cualquier
    // URI convertiria este endpoint en un canjeador de codigos ajenos.
    if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(redirectUri)) {
      return ctx.badRequest('redirect_uri_invalid');
    }

    const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      strapi.log.error(
        '[auth/google-escritorio] faltan GOOGLE_DESKTOP_CLIENT_ID / GOOGLE_DESKTOP_CLIENT_SECRET'
      );
      return ctx.send({ error: 'provider_not_configured' }, 503);
    }

    let idToken = '';
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const datos = (await r.json().catch(() => ({}))) as {
        id_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!r.ok || !datos.id_token) {
        // El detalle de Google se registra pero NO se devuelve: describe la
        // configuracion del cliente OAuth, no al usuario.
        strapi.log.warn(
          `[auth/google-escritorio] canje rechazado (${r.status}): ${datos.error ?? ''} ${datos.error_description ?? ''}`
        );
        return ctx.badRequest('code_invalid');
      }
      idToken = datos.id_token;
    } catch (e: any) {
      strapi.log.error('[auth/google-escritorio] no se pudo canjear el codigo: ' + (e?.message ?? e));
      return ctx.send({ error: 'unexpected' }, 500);
    }

    ctx.request.body = { provider: 'google', idToken };
    return controlador.social(ctx);
  },
};

export default controlador;
