/**
 * Revocación del token de "Iniciar sesión con Apple" al borrar una cuenta.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ EXIGE APPLE
 * ─────────────────────────────────────────────────────────────────────
 * Desde 2022, toda app que ofrece Sign in with Apple y permite borrar la
 * cuenta debe llamar al endpoint de revocación de Apple
 * (POST https://appleid.apple.com/auth/revoke). Borrar solo la fila local
 * deja la app enlazada en "Ajustes → Apple ID → Iniciar sesión con Apple"
 * del usuario, y App Review lo verifica.
 *
 * Para revocar hace falta un `refresh_token` de Apple, que solo se obtiene
 * canjeando el `authorizationCode` del login (vive 5 minutos). Por eso el
 * canje ocurre EN EL LOGIN (ver `guardarRefreshTokenApple`) y acá solo se usa
 * lo guardado.
 *
 * Variables de entorno necesarias (las mismas credenciales de la clave de
 * Sign in with Apple, distintas de las de APNs):
 *   APPLE_SIWA_SERVICE_ID  — el "Services ID" / client_id (p. ej. ec.com…​.signin)
 *   APPLE_SIWA_TEAM_ID     — Team ID (8AWPFT5JS2)
 *   APPLE_SIWA_KEY_ID      — Key ID de la clave de Sign in with Apple
 *   APPLE_SIWA_KEY / …_PATH — la clave .p8 (contenido o ruta al Secret File)
 *
 * Si faltan, la revocación se salta con un aviso en el log: el borrado de la
 * cuenta NUNCA se detiene por esto.
 */
import { readFileSync } from 'node:fs';

type Core = any;

const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';

function leerClave(): string | null {
	const directa = process.env.APPLE_SIWA_KEY;
	if (directa && directa.includes('BEGIN')) return directa.replace(/\\n/g, '\n');
	const ruta = process.env.APPLE_SIWA_KEY_PATH || '/etc/secrets/apple-siwa.p8';
	try {
		return readFileSync(ruta, 'utf8');
	} catch {
		return null;
	}
}

/**
 * `client_secret` de Apple: un JWT ES256 firmado con la clave de Sign in with
 * Apple, con el Team ID como emisor y el Services ID como sujeto.
 */
async function clientSecret(): Promise<string | null> {
	const teamId = process.env.APPLE_SIWA_TEAM_ID;
	const keyId = process.env.APPLE_SIWA_KEY_ID;
	const serviceId = process.env.APPLE_SIWA_SERVICE_ID;
	const pem = leerClave();
	if (!teamId || !keyId || !serviceId || !pem) return null;

	const { importPKCS8, SignJWT } = await import('jose');
	const key = await importPKCS8(pem, 'ES256');
	const ahora = Math.floor(Date.now() / 1000);
	return new SignJWT({})
		.setProtectedHeader({ alg: 'ES256', kid: keyId })
		.setIssuer(teamId)
		.setIssuedAt(ahora)
		.setExpirationTime(ahora + 300)
		.setAudience('https://appleid.apple.com')
		.setSubject(serviceId)
		.sign(key);
}

/**
 * En el LOGIN: canjea el authorizationCode por un refresh_token y lo guarda
 * en el usuario, para poder revocar cuando borre su cuenta.
 * Mejor esfuerzo: si falla, el login sigue.
 */
export async function guardarRefreshTokenApple(
	strapi: Core,
	userId: number,
	authorizationCode: string
): Promise<void> {
	try {
		const secret = await clientSecret();
		const serviceId = process.env.APPLE_SIWA_SERVICE_ID;
		if (!secret || !serviceId || !authorizationCode) return;

		const res = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: serviceId,
				client_secret: secret,
				code: authorizationCode,
				grant_type: 'authorization_code'
			})
		});
		if (!res.ok) {
			strapi.log.warn('[apple-siwa] canje del código falló: HTTP ' + res.status);
			return;
		}
		const body: any = await res.json();
		if (!body?.refresh_token) return;
		await strapi.db
			.query('plugin::users-permissions.user')
			.update({ where: { id: userId }, data: { appleRefreshToken: body.refresh_token } });
	} catch (e: any) {
		strapi.log.warn('[apple-siwa] no se pudo guardar el refresh token: ' + (e?.message ?? e));
	}
}

/** Al BORRAR la cuenta: revoca el enlace en los servidores de Apple. */
export async function revocarTokenApple(strapi: Core, usuario: any): Promise<void> {
	const token = usuario?.appleRefreshToken;
	if (!token) {
		strapi.log.info('[apple-siwa] sin refresh token guardado: nada que revocar');
		return;
	}
	const secret = await clientSecret();
	const serviceId = process.env.APPLE_SIWA_SERVICE_ID;
	if (!secret || !serviceId) {
		strapi.log.warn('[apple-siwa] faltan credenciales: no se pudo revocar');
		return;
	}
	const res = await fetch(REVOKE_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: serviceId,
			client_secret: secret,
			token,
			token_type_hint: 'refresh_token'
		})
	});
	if (res.ok) strapi.log.info(`[apple-siwa] token revocado para user ${usuario.id}`);
	else strapi.log.warn('[apple-siwa] revocación devolvió HTTP ' + res.status);
}
