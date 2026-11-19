/**
 * Envío de notificaciones push a ANDROID por FCM (HTTP v1).
 *
 * Gemelo de apns.ts. Sin dependencias nuevas: `jose` (ya en package.json)
 * firma el JWT RS256 con la clave de la cuenta de servicio, se canjea por un
 * access token OAuth2 en oauth2.googleapis.com y se llama al endpoint v1 con
 * `fetch`. La API legacy (fcm.googleapis.com/fcm/send, clave de servidor)
 * está apagada desde junio de 2024: no sirve de alternativa.
 *
 * Env requeridas (sin ellas TODO envío a Android es un no-op con warning,
 * igual que APNs sin configurar — el push a iOS no se ve afectado):
 *   FCM_SERVICE_ACCOUNT_B64  — el JSON de la cuenta de servicio de Firebase
 *                              completo, en base64 (una línea) — O BIEN un
 *                              Secret File de Render con el JSON crudo, cuya
 *                              ruta se toma de FCM_SERVICE_ACCOUNT_PATH
 *                              (default /etc/secrets/fcm-service-account.json).
 *                              El secret file es el camino preferido: la clave
 *                              privada nunca pasa por un campo de texto.
 *
 * El project_id sale del propio JSON, así que no hay una env más que cuadrar.
 * El access token se cachea hasta un minuto antes de expirar.
 *
 * OJO: esto es solo la mitad del servidor. Para que un teléfono Android reciba
 * algo hace falta además `android/app/google-services.json` en el binario (se
 * baja de la misma consola de Firebase que emite esta cuenta de servicio).
 */
import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

type Core = { log: { info: Function; warn: Function; error: Function }; db: any };

type CuentaServicio = {
	project_id: string;
	client_email: string;
	private_key: string;
};

let tokenCache: { token: string; expiraEn: number } | null = null;
let cuentaCache: CuentaServicio | null | undefined;

/** El JSON de la cuenta de servicio: env en base64, o Secret File. */
function leerCuenta(): CuentaServicio | null {
	if (cuentaCache !== undefined) return cuentaCache;
	let crudo: string | null = null;
	const b64 = process.env.FCM_SERVICE_ACCOUNT_B64;
	if (b64 && b64.trim()) {
		try {
			crudo = Buffer.from(b64.trim(), 'base64').toString('utf8');
		} catch {
			crudo = null;
		}
	}
	if (!crudo) {
		const ruta = process.env.FCM_SERVICE_ACCOUNT_PATH ?? '/etc/secrets/fcm-service-account.json';
		try {
			crudo = readFileSync(ruta, 'utf8');
		} catch {
			crudo = null;
		}
	}
	if (!crudo) {
		cuentaCache = null;
		return null;
	}
	try {
		const j = JSON.parse(crudo);
		if (!j?.project_id || !j?.client_email || !j?.private_key) {
			cuentaCache = null;
			return null;
		}
		cuentaCache = {
			project_id: String(j.project_id),
			client_email: String(j.client_email),
			// Render y otros paneles guardan el PEM con "\n" literales.
			private_key: String(j.private_key).replace(/\\n/g, '\n')
		};
		return cuentaCache;
	} catch {
		cuentaCache = null;
		return null;
	}
}

export function fcmConfigurado(): boolean {
	return leerCuenta() !== null;
}

/** Access token OAuth2 con el scope de FCM. Cacheado hasta ~1 min antes de expirar. */
async function accessToken(): Promise<string | null> {
	const ahora = Math.floor(Date.now() / 1000);
	if (tokenCache && tokenCache.expiraEn - 60 > ahora) return tokenCache.token;

	const cuenta = leerCuenta();
	if (!cuenta) return null;

	const key = await importPKCS8(cuenta.private_key, 'RS256');
	const assertion = await new SignJWT({
		scope: 'https://www.googleapis.com/auth/firebase.messaging'
	})
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(cuenta.client_email)
		.setSubject(cuenta.client_email)
		.setAudience('https://oauth2.googleapis.com/token')
		.setIssuedAt(ahora)
		.setExpirationTime(ahora + 3600)
		.sign(key);

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion
		}),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) return null;
	const body: any = await res.json().catch(() => null);
	if (!body?.access_token) return null;
	tokenCache = {
		token: String(body.access_token),
		expiraEn: ahora + Number(body.expires_in ?? 3600)
	};
	return tokenCache.token;
}

export type ResultadoFcm = { ok: number; muertos: number[] };

/**
 * Envía un mensaje a una lista de tokens de Android.
 *
 * Devuelve cuántos entregaron y los índices de los tokens que FCM declaró
 * inválidos (UNREGISTERED / INVALID_ARGUMENT), para que quien llama los dé
 * de baja igual que hace apns.ts con un 410.
 */
export async function enviarFcm(
	tokens: string[],
	mensaje: { titulo: string; cuerpo: string; data?: Record<string, string> },
	badgePorToken?: (i: number) => number | undefined
): Promise<ResultadoFcm> {
	const cuenta = leerCuenta();
	const token = await accessToken();
	if (!cuenta || !token) return { ok: 0, muertos: [] };

	const url = `https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`;
	let ok = 0;
	const muertos: number[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const badge = badgePorToken?.(i);
		const cuerpo = {
			message: {
				token: tokens[i],
				notification: { title: mensaje.titulo, body: mensaje.cuerpo },
				// FCM exige que todos los valores de `data` sean strings.
				data: mensaje.data ?? {},
				android: {
					priority: 'HIGH',
					notification: {
						sound: 'default',
						...(typeof badge === 'number' ? { notification_count: badge } : {})
					}
				}
			}
		};
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(cuerpo),
				signal: AbortSignal.timeout(10_000)
			});
			if (res.ok) {
				ok++;
			} else if (res.status === 404 || res.status === 400) {
				// UNREGISTERED (la app se desinstaló) o token mal formado.
				muertos.push(i);
			}
		} catch {
			/* red caída: se reintentará en el próximo envío */
		}
	}
	return { ok, muertos };
}
