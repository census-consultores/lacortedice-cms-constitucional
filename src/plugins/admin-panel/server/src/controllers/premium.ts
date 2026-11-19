/**
 * Premium por compra In-App (Apple) + créditos de Jurimetría IA.
 *
 * ── Compra ──────────────────────────────────────────────────────────────────
 * El binario iOS compra la suscripción `premium_mensual` con StoreKit 2 y nos
 * manda el `jwsRepresentation` (la transacción FIRMADA POR APPLE). Acá se
 * verifica la firma contra los certificados raíz de Apple (offline, con la
 * librería oficial @apple/app-store-server-library), se comprueba bundle,
 * producto y vigencia, y recién entonces el usuario pasa a `premium` con
 * `premiumHasta = expiresDate`. Nunca se confía en el cliente.
 *
 * «Restaurar compras» usa el mismo endpoint: el teléfono reenvía el JWS de su
 * entitlement vigente.
 *
 * ── Expiración ──────────────────────────────────────────────────────────────
 * Un usuario premium por IAP (tiene iapOriginalTransactionId) vuelve a free
 * cuando `premiumHasta` queda en el pasado. Eso se aplica de forma perezosa en
 * `saldo`/`consumir` y puede reforzarse con un cron. Los premium activados a
 * mano por el equipo (sin transactionId) NO se tocan.
 *
 * ── Créditos ────────────────────────────────────────────────────────────────
 * El plan incluye 20 consultas de Jurimetría IA por mes calendario; el resto
 * de la plataforma es ilimitado. El BFF consume 1 crédito por análisis con
 * `consumir`; repetir el MISMO análisis (mismo hash) dentro de 15 minutos no
 * vuelve a cobrar (recargas de página). Admin/superadmin: sin límite.
 */

import type { Core } from '@strapi/strapi';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type Ctx = any;

const BUNDLE_ID = 'ec.com.lacortedicetributaria.app';
const PRODUCTO_PREMIUM = 'premium_mensual';
const CREDITOS_MES = 20;
const HASH_GRACIA_MS = 15 * 60 * 1000;

function mesActual(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function creditosStore(strapi: Core.Strapi) {
  return strapi.store({ type: 'plugin', name: 'admin-panel' });
}
const creditosKey = (userId: number) => `jm-creditos:${userId}:${mesActual()}`;

type CreditosEntry = { usadas: number; ultimoHash?: string; ultimoTs?: number };

function esAdmin(user: any): boolean {
  return user?.userRole === 'admin' || user?.userRole === 'superadmin';
}

/** Certificados raíz de Apple empaquetados con el plugin (DER públicos). */
function certificadosApple(): Buffer[] {
  // El compilado del plugin puede correr desde src/ o desde dist/: se prueba
  // en ambos niveles y, como red final, desde la raíz del proyecto.
  const candidatos = [
    path.resolve(__dirname, '..', '..', 'certs'),
    path.resolve(__dirname, '..', '..', '..', 'certs'),
    path.resolve(process.cwd(), 'src', 'plugins', 'admin-panel', 'server', 'certs'),
  ];
  const dir = candidatos.find((c) => fs.existsSync(c));
  if (!dir) throw new Error('certs de Apple no encontrados');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.cer'))
    .map((f) => fs.readFileSync(path.join(dir, f)));
}

/**
 * Verifica el JWS contra producción y, si falla, contra sandbox (así la
 * misma build sirve para TestFlight y App Store). Devuelve el payload
 * decodificado o lanza.
 */
async function verificarJws(signedTransaction: string) {
  const { SignedDataVerifier, Environment } = await import('@apple/app-store-server-library');
  const certs = certificadosApple();
  const appAppleId = Number(process.env.IAP_APPLE_APP_ID || 0) || undefined;

  const errores: string[] = [];
  for (const env of [Environment.PRODUCTION, Environment.SANDBOX]) {
    try {
      const verifier = new SignedDataVerifier(certs, false, env, BUNDLE_ID, appAppleId);
      return await verifier.verifyAndDecodeTransaction(signedTransaction);
    } catch (e) {
      errores.push(`${env}: ${(e as Error).message}`);
    }
  }
  throw new Error(errores.join(' · '));
}

/** Premium por IAP vencido → de vuelta a free (perezoso, en cada consulta). */
async function aplicarExpiracion(strapi: Core.Strapi, user: any): Promise<any> {
  if (
    user?.subscriptionTier === 'premium' &&
    user?.iapOriginalTransactionId &&
    user?.premiumHasta &&
    new Date(user.premiumHasta).getTime() < Date.now()
  ) {
    strapi.log.info(`[premium] suscripción vencida — ${user.email} vuelve a free`);
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { subscriptionTier: 'free' },
    });
    return { ...user, subscriptionTier: 'free' };
  }
  return user;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * POST /premium/iap/activar  { jws }
   * Compra nueva o restauración. Responde { ok, subscriptionTier, premiumHasta }.
   */
  async iapActivar(ctx: Ctx) {
    const user = ctx.state.user;
    if (!user?.id) return ctx.unauthorized();

    const jws = String(ctx.request.body?.jws ?? '');
    if (!jws || jws.split('.').length !== 3) return ctx.badRequest('jws_required');

    let tx;
    try {
      tx = await verificarJws(jws);
    } catch (e) {
      strapi.log.warn(`[premium] JWS inválido para ${user.email}: ${(e as Error).message}`);
      return ctx.badRequest('jws_invalid');
    }

    if (tx.bundleId !== BUNDLE_ID) return ctx.badRequest('bundle_mismatch');
    if (tx.productId !== PRODUCTO_PREMIUM) return ctx.badRequest('product_unknown');

    const expira = tx.expiresDate ? new Date(tx.expiresDate) : null;
    if (!expira || expira.getTime() < Date.now()) {
      return ctx.badRequest('subscription_expired');
    }
    if (tx.revocationDate) return ctx.badRequest('subscription_revoked');

    // Una suscripción de Apple pertenece a UNA cuenta de La Corte Dice: si el
    // mismo originalTransactionId ya activó a otro usuario, no se duplica.
    const original = String(tx.originalTransactionId ?? tx.transactionId ?? '');
    if (original) {
      const dueno = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { iapOriginalTransactionId: original },
        select: ['id', 'email'],
      });
      if (dueno && dueno.id !== user.id) {
        strapi.log.warn(
          `[premium] transacción ${original} ya pertenece a ${dueno.email}; la pidió ${user.email}`
        );
        return ctx.send({ ok: false, error: 'subscription_in_use' }, 409);
      }
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        subscriptionTier: 'premium',
        premiumHasta: expira,
        iapOriginalTransactionId: original || null,
      },
    });

    strapi.log.info(
      `[premium] IAP activada para ${user.email} hasta ${expira.toISOString()} (${tx.environment ?? '?'})`
    );
    return ctx.send({
      ok: true,
      subscriptionTier: 'premium',
      premiumHasta: expira.toISOString(),
      creditosJurimetria: CREDITOS_MES,
    });
  },

  /** GET /premium/jurimetria/saldo → { limite, usadas, restantes, ilimitado } */
  async jurimetriaSaldo(ctx: Ctx) {
    let user = ctx.state.user;
    if (!user?.id) return ctx.unauthorized();
    if (esAdmin(user)) return ctx.send({ ok: true, ilimitado: true, limite: null, usadas: 0, restantes: null });

    user = await aplicarExpiracion(strapi, user);
    if (user.subscriptionTier !== 'premium') {
      return ctx.send({ ok: false, error: 'premium_required' }, 402);
    }
    const entry = ((await creditosStore(strapi).get({ key: creditosKey(user.id) })) ?? {
      usadas: 0,
    }) as CreditosEntry;
    return ctx.send({
      ok: true,
      ilimitado: false,
      limite: CREDITOS_MES,
      usadas: entry.usadas,
      restantes: Math.max(0, CREDITOS_MES - entry.usadas),
    });
  },

  /**
   * POST /premium/jurimetria/consumir  { hash }
   * Cobra 1 crédito del mes (idempotente por hash 15 min). Responde saldo.
   */
  async jurimetriaConsumir(ctx: Ctx) {
    let user = ctx.state.user;
    if (!user?.id) return ctx.unauthorized();
    if (esAdmin(user)) return ctx.send({ ok: true, ilimitado: true, restantes: null });

    user = await aplicarExpiracion(strapi, user);
    if (user.subscriptionTier !== 'premium') {
      return ctx.send({ ok: false, error: 'premium_required' }, 402);
    }

    const hashCrudo = String(ctx.request.body?.hash ?? '');
    const hash = hashCrudo ? crypto.createHash('sha256').update(hashCrudo).digest('hex') : '';

    const store = creditosStore(strapi);
    const key = creditosKey(user.id);
    const entry = ((await store.get({ key })) ?? { usadas: 0 }) as CreditosEntry;

    // Mismo análisis hace un momento (recarga, volver atrás): no se cobra.
    if (
      hash &&
      entry.ultimoHash === hash &&
      entry.ultimoTs &&
      Date.now() - entry.ultimoTs < HASH_GRACIA_MS
    ) {
      return ctx.send({
        ok: true,
        ilimitado: false,
        limite: CREDITOS_MES,
        usadas: entry.usadas,
        restantes: Math.max(0, CREDITOS_MES - entry.usadas),
        repetida: true,
      });
    }

    if (entry.usadas >= CREDITOS_MES) {
      return ctx.send(
        { ok: false, error: 'sin_creditos', limite: CREDITOS_MES, usadas: entry.usadas, restantes: 0 },
        402
      );
    }

    const nuevo: CreditosEntry = {
      usadas: entry.usadas + 1,
      ultimoHash: hash || entry.ultimoHash,
      ultimoTs: Date.now(),
    };
    await store.set({ key, value: nuevo });

    return ctx.send({
      ok: true,
      ilimitado: false,
      limite: CREDITOS_MES,
      usadas: nuevo.usadas,
      restantes: Math.max(0, CREDITOS_MES - nuevo.usadas),
    });
  },
});
