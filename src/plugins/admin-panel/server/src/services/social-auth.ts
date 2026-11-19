/**
 * Verificación de identidad de Google y Apple.
 *
 * ── Por qué acá y no en la webapp ───────────────────────────────────────────
 *
 * El JWT de sesión lo firma Strapi con `JWT_SECRET`. Ese secreto vive en el
 * CMS y no debe salir de acá. Así que la webapp verifica nada: recibe el token
 * del proveedor, lo reenvía, y este servicio decide si corresponde a una
 * persona real y quién es.
 *
 * ── Lo único que importa de este archivo ────────────────────────────────────
 *
 * Un `id_token` es un JWT firmado por Google o por Apple. Si se acepta sin
 * verificar la firma, CUALQUIERA puede fabricar uno con el correo que quiera y
 * entrar como quien quiera — incluido un superadmin. No es una hipótesis: el
 * token viaja por el cliente, que es territorio hostil por definición.
 *
 * Por eso se verifica, en este orden y sin saltarse ninguno:
 *
 *   1. La FIRMA, contra la clave pública que el proveedor publica en su JWKS
 *      (Google y Apple rotan esas claves, así que se descargan y se cachean
 *      por poco tiempo, nunca se hardcodean).
 *   2. El EMISOR (`iss`) — que lo haya emitido el proveedor y no un tercero.
 *   3. La AUDIENCIA (`aud`) — que sea un token emitido PARA esta app y no para
 *      otra aplicación cualquiera del mismo proveedor. Sin este chequeo, un
 *      token legítimo de otra app sirve para entrar acá.
 *   4. La EXPIRACIÓN (`exp`).
 *   5. Que el correo esté VERIFICADO por el proveedor. Un correo sin verificar
 *      permite registrarse con la dirección de otra persona.
 *
 * `jose` hace 1–4 en una sola llamada (`jwtVerify` con un `createRemoteJWKSet`)
 * y falla cerrado: cualquier discrepancia lanza. El 5 va explícito abajo.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type Proveedor = 'google' | 'apple';

export type IdentidadVerificada = {
  proveedor: Proveedor;
  email: string;
  sub: string;
  /** Nombre de pila (given_name). Google lo trae en el token; Apple no. */
  nombre?: string;
  /** Apellidos (family_name). Van SEPARADOS porque el registro tiene dos
   *  campos distintos y partir un nombre completo por el primer espacio se
   *  equivoca con cualquier nombre compuesto ("Maria Jose Perez Garcia"). */
  apellido?: string;
};

const EMISORES: Record<Proveedor, string[]> = {
  google: ['https://accounts.google.com', 'accounts.google.com'],
  apple: ['https://appleid.apple.com'],
};

const JWKS_URL: Record<Proveedor, string> = {
  google: 'https://www.googleapis.com/oauth2/v3/certs',
  apple: 'https://appleid.apple.com/auth/keys',
};

// `createRemoteJWKSet` cachea las claves y las revalida solo; se crea una vez
// por proveedor para no volver a pedirlas en cada login.
const jwks: Partial<Record<Proveedor, ReturnType<typeof createRemoteJWKSet>>> = {};
function clavesDe(p: Proveedor) {
  if (!jwks[p]) jwks[p] = createRemoteJWKSet(new URL(JWKS_URL[p]));
  return jwks[p]!;
}

/**
 * Audiencias aceptadas por proveedor.
 *
 * Google emite un `aud` distinto por plataforma (iOS, Android, Web), así que
 * se aceptan varias. Se leen del entorno: hardcodearlas obliga a un deploy por
 * cada cliente nuevo y, peor, invita a dejar una de pruebas en producción.
 */
function audienciasDe(p: Proveedor): string[] {
  const crudo =
    p === 'google'
      ? process.env.GOOGLE_CLIENT_IDS ?? ''
      : process.env.APPLE_CLIENT_IDS ?? '';
  return crudo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export class ErrorSocial extends Error {
  constructor(
    public codigo: string,
    mensaje: string
  ) {
    super(mensaje);
  }
}

export async function verificarIdentidad(
  proveedor: Proveedor,
  idToken: string
): Promise<IdentidadVerificada> {
  const audiencias = audienciasDe(proveedor);
  if (audiencias.length === 0) {
    // Falla CERRADO. Sin audiencias configuradas la verificación de `aud` no
    // se puede hacer, y aceptar el token igual convierte esto en una puerta
    // abierta. Antes prefiero que el login social no funcione.
    throw new ErrorSocial(
      'provider_not_configured',
      `Faltan las audiencias de ${proveedor} (${proveedor === 'google' ? 'GOOGLE_CLIENT_IDS' : 'APPLE_CLIENT_IDS'}).`
    );
  }

  let payload: Record<string, unknown>;
  try {
    const r = await jwtVerify(idToken, clavesDe(proveedor), {
      issuer: EMISORES[proveedor],
      audience: audiencias,
      clockTolerance: 30, // segundos, por relojes desfasados
    });
    payload = r.payload as Record<string, unknown>;
  } catch (e) {
    throw new ErrorSocial('invalid_token', `Token de ${proveedor} inválido: ${(e as Error).message}`);
  }

  const email = String(payload.email ?? '')
    .trim()
    .toLowerCase();
  if (!email) throw new ErrorSocial('no_email', 'El proveedor no entregó un correo.');

  // Google manda booleano; Apple manda booleano o la cadena "true".
  const verificado = payload.email_verified === true || payload.email_verified === 'true';
  if (!verificado) {
    throw new ErrorSocial(
      'email_not_verified',
      'El proveedor no confirmó ese correo. Sin eso, cualquiera podría registrarse con la dirección de otra persona.'
    );
  }

  const sub = String(payload.sub ?? '');
  if (!sub) throw new ErrorSocial('no_subject', 'El token no trae identificador de usuario.');

  const texto = (v: unknown): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t || undefined;
  };
  // Antes se devolvía "given family" concatenado y el cliente lo descartaba.
  // Separados, el registro puede rellenar sus dos campos tal cual.
  const nombre = texto(payload.given_name);
  const apellido = texto(payload.family_name);

  return { proveedor, email, sub, nombre, apellido };
}
