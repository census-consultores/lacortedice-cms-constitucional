/**
 * Envío de notificaciones push por APNs (HTTP/2 + token JWT ES256).
 *
 * Sin dependencias nuevas: usa `node:http2` y `jose` (ya en package.json)
 * para firmar el token de proveedor con la clave .p8 de Apple.
 *
 * Env requeridas (sin ellas TODO envío es un no-op silencioso con warning):
 *   APNS_KEY_B64  — la clave .p8 completa en base64 (una línea) — O BIEN un
 *                   Secret File de Render con el .p8 crudo, cuya ruta se toma
 *                   de APNS_KEY_PATH (default /etc/secrets/apns-key.p8). El
 *                   secret file es el camino preferido: la clave nunca pasa
 *                   por un campo de texto.
 *   APNS_KEY_ID   — Key ID de la clave (10 caracteres).
 *   APNS_TEAM_ID  — Team ID de Apple Developer.
 *   APNS_TOPIC    — bundle id de la app (p. ej. com.lacortedice.tributaria).
 *   APNS_ENV      — 'production' (default) o 'sandbox' (builds de desarrollo
 *                   instaladas por Xcode usan el entorno sandbox).
 *
 * El token de proveedor se cachea ~45 min (Apple exige entre 20 y 60).
 * Un 410 (Unregistered) marca el dispositivo activo=false.
 */
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

type Core = { log: { info: Function; warn: Function; error: Function }; db: any };

export type PushMensaje = {
	titulo: string;
	cuerpo: string;
	/** Datos extra que viajan con la notificación (p. ej. { url: '/tribuna/x' }). */
	data?: Record<string, string>;
	/** Agrupa notificaciones en el centro de notificaciones de iOS. */
	threadId?: string;
};

let tokenCache: { token: string; en: number } | null = null;

/** El PEM de la clave: env APNS_KEY_B64, o el Secret File (APNS_KEY_PATH). */
function leerPem(): string | null {
	if (process.env.APNS_KEY_B64) {
		return Buffer.from(process.env.APNS_KEY_B64, 'base64').toString('utf8');
	}
	try {
		const ruta = process.env.APNS_KEY_PATH || '/etc/secrets/apns-key.p8';
		return readFileSync(ruta, 'utf8');
	} catch {
		return null;
	}
}

function configurado(): boolean {
	return Boolean(
		leerPem() && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_TOPIC
	);
}

async function providerToken(): Promise<string> {
	if (tokenCache && Date.now() - tokenCache.en < 45 * 60_000) return tokenCache.token;
	const pem = leerPem()!;
	const key = await importPKCS8(pem, 'ES256');
	const token = await new SignJWT({})
		.setProtectedHeader({ alg: 'ES256', kid: process.env.APNS_KEY_ID! })
		.setIssuer(process.env.APNS_TEAM_ID!)
		.setIssuedAt()
		.sign(key);
	tokenCache = { token, en: Date.now() };
	return token;
}

function host(): string {
	return process.env.APNS_ENV === 'sandbox'
		? 'https://api.sandbox.push.apple.com'
		: 'https://api.push.apple.com';
}

/** Envía UNA notificación a UN token. Resuelve el status HTTP de APNs. */
function enviarUno(
	session: http2.ClientHttp2Session,
	jwt: string,
	token: string,
	payload: string
): Promise<number> {
	return new Promise((resolve) => {
		const req = session.request({
			':method': 'POST',
			':path': `/3/device/${token}`,
			authorization: `bearer ${jwt}`,
			'apns-topic': process.env.APNS_TOPIC!,
			'apns-push-type': 'alert',
			'apns-priority': '10',
			'content-type': 'application/json'
		});
		let status = 0;
		req.on('response', (h) => {
			status = Number(h[':status'] ?? 0);
		});
		req.setTimeout(10_000, () => {
			req.close();
			resolve(0);
		});
		req.on('close', () => resolve(status));
		req.on('error', () => resolve(0));
		req.end(payload);
	});
}

/**
 * Envía `mensaje` a todos los dispositivos ACTIVOS de los usuarios dados.
 * Fire-and-forget amigable: nunca lanza; loguea el resumen.
 */
export async function enviarPush(
	strapi: Core,
	userIds: number[],
	mensaje: PushMensaje,
	/** Globo del icono por usuario (sus notificaciones no leídas). */
	badgePorUsuario?: Map<number, number>
): Promise<void> {
	if (userIds.length === 0) return;
	// Android va por FCM, en paralelo y sin bloquear el envío a iOS. Si una de
	// las dos plataformas no está configurada, la otra sigue funcionando.
	void enviarAndroid(strapi, userIds, mensaje, badgePorUsuario);
	if (!configurado()) {
		strapi.log.warn('[apns] sin configurar (APNS_KEY_B64/KEY_ID/TEAM_ID/TOPIC): push omitido');
		return;
	}
	try {
		const dispositivos: Array<{ id: number; token: string; user?: { id: number } | null }> =
			await strapi.db.query('api::push-dispositivo.push-dispositivo').findMany({
				where: { activo: true, plataforma: 'ios', user: { id: { $in: userIds } } },
				select: ['id', 'token'],
				populate: { user: { select: ['id'] } },
				limit: 5000
			});
		if (dispositivos.length === 0) return;

		const jwt = await providerToken();
		const armarPayload = (badge?: number) =>
			JSON.stringify({
				aps: {
					alert: { title: mensaje.titulo, body: mensaje.cuerpo },
					sound: 'default',
					...(typeof badge === 'number' ? { badge } : {}),
					'thread-id': mensaje.threadId ?? 'lacortedice'
				},
				...(mensaje.data ?? {})
			});
		const payloadBase = armarPayload();

		const session = http2.connect(host());
		session.on('error', () => {});
		let ok = 0;
		let muertos = 0;
		for (const d of dispositivos) {
			const badge = d.user?.id != null ? badgePorUsuario?.get(d.user.id) : undefined;
			const payload = typeof badge === 'number' ? armarPayload(badge) : payloadBase;
			const status = await enviarUno(session, jwt, d.token, payload);
			if (status === 200) ok++;
			else if (status === 410 || status === 400) {
				// Unregistered / BadDeviceToken: no volver a intentar con este token.
				muertos++;
				await strapi.db
					.query('api::push-dispositivo.push-dispositivo')
					.update({ where: { id: d.id }, data: { activo: false } })
					.catch(() => {});
			}
		}
		session.close();
		strapi.log.info(
			`[apns] "${mensaje.titulo}" → ${ok}/${dispositivos.length} entregadas` +
				(muertos ? `, ${muertos} tokens dados de baja` : '')
		);
	} catch (e: any) {
		strapi.log.error('[apns] fallo enviando push: ' + (e?.message ?? e));
	}
}

/**
 * Gemelo de `enviarPush` para los dispositivos Android (FCM HTTP v1).
 *
 * Vive aquí y no en fcm.ts a propósito: fcm.ts es el transporte puro (tokens
 * dentro, resultado fuera) y esta función es la que sabe de la base —
 * a qué dispositivos toca escribir y cuáles dar de baja. Así el emisor
 * (`enviarPush`) sigue siendo la única puerta que usan los llamadores.
 *
 * Nunca lanza: un fallo de Android no puede tumbar el envío a iOS.
 */
async function enviarAndroid(
	strapi: Core,
	userIds: number[],
	mensaje: PushMensaje,
	badgePorUsuario?: Map<number, number>
): Promise<void> {
	try {
		const { fcmConfigurado, enviarFcm } = await import('./fcm');
		if (!fcmConfigurado()) return; // sin cuenta de servicio: silencio, no ruido.

		const dispositivos: Array<{ id: number; token: string; user?: { id: number } | null }> =
			await strapi.db.query('api::push-dispositivo.push-dispositivo').findMany({
				where: { activo: true, plataforma: 'android', user: { id: { $in: userIds } } },
				select: ['id', 'token'],
				populate: { user: { select: ['id'] } },
				limit: 5000
			});
		if (dispositivos.length === 0) return;

		const { ok, muertos } = await enviarFcm(
			dispositivos.map((d) => d.token),
			{
				titulo: mensaje.titulo,
				cuerpo: mensaje.cuerpo,
				// FCM exige strings en `data`; `mensaje.data` ya lo es.
				data: mensaje.data ?? {}
			},
			(i) => {
				const uid = dispositivos[i]?.user?.id;
				return uid != null ? badgePorUsuario?.get(uid) : undefined;
			}
		);

		for (const i of muertos) {
			const d = dispositivos[i];
			if (!d) continue;
			await strapi.db
				.query('api::push-dispositivo.push-dispositivo')
				.update({ where: { id: d.id }, data: { activo: false } })
				.catch(() => {});
		}
		strapi.log.info(
			`[fcm] "${mensaje.titulo}" → ${ok}/${dispositivos.length} entregadas` +
				(muertos.length ? `, ${muertos.length} tokens dados de baja` : '')
		);
	} catch (e: any) {
		strapi.log.error('[fcm] fallo enviando push a Android: ' + (e?.message ?? e));
	}
}

/**
 * Preferencias efectivas de un usuario: lo guardado en `pushPrefs` sobre los
 * DEFAULTS del producto. Exportada para que los emisores filtren audiencias.
 */
export const PREFS_DEFAULT = {
	sentencias: true,
	debates: true,
	temasNuevos: true,
	favoritos: true,
	juegoDiario: null as string | null
};

export function prefsDe(user: { pushPrefs?: unknown } | null | undefined) {
	const crudas = (user?.pushPrefs ?? {}) as Record<string, unknown>;
	return { ...PREFS_DEFAULT, ...(typeof crudas === 'object' && crudas ? crudas : {}) };
}
