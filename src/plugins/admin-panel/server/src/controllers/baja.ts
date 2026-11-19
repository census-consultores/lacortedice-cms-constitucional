import type { Core } from '@strapi/strapi';
import { tokenBajaValido } from '../services/mailer';

type Ctx = any;

/**
 * Baja de los correos masivos.
 *
 * Endpoint PÚBLICO a propósito (`auth: false` en las rutas): quien se da de
 * baja normalmente no tiene cuenta, y exigirle iniciar sesión para dejar de
 * recibir correos es la forma más rápida de que pulse «marcar como spam» en
 * lugar de darse de baja. Gmail corta la entrega de un remitente que pasa del
 * 0,3 % de quejas y Titan suspende la cuenta a las cinco —la misma cuenta que
 * manda las claves de la app—, así que el camino fácil tiene que ser este.
 *
 * Que sea público no lo deja abierto: sin el HMAC del correo no se da de baja
 * a nadie, de modo que no se puede sacar a un tercero de la lista escribiendo
 * su dirección en la URL.
 *
 * Lo llama /baja de la aplicación, que es la URL que viaja en la cabecera
 * `List-Unsubscribe` y en el enlace del pie.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async registrar(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      correo?: string;
      token?: string;
      campana?: string;
      motivo?: string;
    };

    const correo = String(body.correo ?? '').trim().toLowerCase();
    const token = String(body.token ?? '').trim();

    if (!correo || !correo.includes('@') || !token) {
      ctx.badRequest('Faltan datos para procesar la baja.');
      return;
    }
    if (!tokenBajaValido(correo, token)) {
      // 403 y no 400: la dirección puede ser perfectamente válida; lo que no
      // cuadra es la firma. Se distingue para poder verlo en el registro.
      strapi.log.warn(`[admin-panel.baja] token inválido para ${correo}`);
      ctx.forbidden('Enlace de baja no válido.');
      return;
    }

    const motivo = ['un_clic', 'enlace', 'manual'].includes(String(body.motivo))
      ? (body.motivo as string)
      : 'enlace';
    const campana = String(body.campana ?? '').slice(0, 120) || null;

    try {
      const yaEsta = await strapi.db
        .query('api::correo-baja.correo-baja')
        .findOne({ where: { correo }, select: ['id'] });

      // Repetir la baja no es un error: Gmail puede reintentar el POST, y la
      // persona puede pulsar el enlace dos veces. Se responde que sí igual.
      if (!yaEsta) {
        await strapi.db
          .query('api::correo-baja.correo-baja')
          .create({ data: { correo, motivo, campana } });
        strapi.log.info(`[admin-panel.baja] baja registrada (${motivo}) campaña=${campana}`);
      }

      ctx.body = { ok: true };
    } catch (err: any) {
      strapi.log.error(`[admin-panel.baja] no se pudo registrar: ${err?.message ?? err}`);
      ctx.throw(500, 'No se pudo registrar la baja.');
    }
  },
});
