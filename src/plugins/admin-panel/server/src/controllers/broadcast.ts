import type { Core } from '@strapi/strapi';
import {
  sendRelaunchEmail,
  renderInvitacionProfesional,
  ASUNTO_INVITACION_PROFESIONAL,
  CAMPANA_LANZAMIENTO,
  CAMPANA_LANZAMIENTO_INVITADOS,
  CAMPANA_DIRECTORIO_CORREO,
  CAMPANA_RANKING_CORREO,
  saludoRanking,
  type AudienciaApp,
} from '../services/mailer';
import {
  CAMPANAS,
  ORDEN_POR_DEFECTO,
  pendientesDe,
  destinatariosAppLaunch,
  destinatariosProfesionales,
  destinatariosRanking,
  type Destinatario,
} from '../services/envio-masivo';
import { DIRECTORIO_PROFESIONALES } from '../data/directorio-profesionales';
import { ABOGADOS_RANKING, NIVELES_QUE_SE_ENVIAN } from '../data/ranking-legal';

type Ctx = any;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * GET /admin-panel/broadcast/relaunch/preview
   * Admin-only. Returns the count of users that would receive the relaunch push
   * plus a small sample, so the admin can confirm before shooting.
   */
  async preview(ctx: Ctx) {
    const users = await strapi.db
      .query('plugin::users-permissions.user')
      .findMany({
        where: { blocked: false, confirmed: true },
        select: ['id', 'email', 'username', 'userRole'],
      });

    const valid = (users as Array<{ id: number; email?: string; username?: string; userRole?: string }>).filter(
      (u) => typeof u.email === 'string' && /@/.test(u.email),
    );

    ctx.body = {
      totalUsers: users.length,
      validRecipients: valid.length,
      sampleEmails: valid.slice(0, 5).map((u) => u.email),
    };
  },

  /**
   * POST /admin-panel/broadcast/relaunch
   * Admin-only. Sends the "Estrenamos casa" relaunch email to every active user.
   * Body: { dryRun?: boolean }
   *
   * Batches of 25 with 2s sleep between batches to stay polite with Titan SMTP.
   */
  async sendRelaunch(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as { dryRun?: boolean };
    const dryRun = Boolean(body.dryRun);

    const users = await strapi.db
      .query('plugin::users-permissions.user')
      .findMany({
        where: { blocked: false, confirmed: true },
        select: ['id', 'email', 'username'],
      });

    const recipients = (users as Array<{ id: number; email?: string; username?: string }>).filter(
      (u) => typeof u.email === 'string' && /@/.test(u.email),
    );

    if (dryRun) {
      ctx.body = {
        dryRun: true,
        wouldSend: recipients.length,
        sample: recipients.slice(0, 5).map((u) => ({ email: u.email, nombre: u.username })),
      };
      return;
    }

    const BATCH = 25;
    const SLEEP_MS = 2000;
    const sent: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];

    for (let i = 0; i < recipients.length; i += BATCH) {
      const slice = recipients.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (u) => {
          try {
            const res = await sendRelaunchEmail({
              to: u.email as string,
              nombre: u.username || 'Estimado/a',
            });
            if (res.sent) {
              sent.push(u.email as string);
            } else {
              failed.push({
                email: u.email as string,
                error: res.error ?? (res.dryRun ? 'dry-run' : 'unknown'),
              });
            }
          } catch (err: any) {
            failed.push({
              email: u.email as string,
              error: err?.message ?? String(err),
            });
          }
        }),
      );
      if (i + BATCH < recipients.length) {
        await new Promise((r) => setTimeout(r, SLEEP_MS));
      }
    }

    strapi.log.info(
      `[admin-panel.broadcast] relaunch: ${sent.length} sent, ${failed.length} failed of ${recipients.length} attempted`,
    );

    ctx.body = {
      dryRun: false,
      attempted: recipients.length,
      sent: sent.length,
      failed: failed.length,
      failedSample: failed.slice(0, 10),
    };
  },

  // ==========================================================================
  // Campañas masivas (lanzamiento de la app · invitación a profesionales)
  // ==========================================================================
  //
  // Las dos campañas ya NO salen de un botón que suelta todo de golpe. El
  // botón enciende la campaña; a partir de ahí el cron manda una tanda cada 15
  // minutos hasta que no queda nadie, y entonces se apaga sola. El porqué está
  // explicado en services/envio-masivo.ts: Titan tiene un tope por hora, y
  // pasarse no retrasa los correos, los rebota.
  //
  // El botón de prueba sí envía en el acto, porque son dos o tres direcciones
  // propias y lo que se quiere es verlo ya.

  /**
   * GET /admin-panel/broadcast/estado
   * Estado de las dos campañas: cuántos faltan, cuántos salieron, cuántas
   * bajas, si está encendida y a qué ritmo.
   */
  async estadoCampanas(ctx: Ctx) {
    const claves = Object.keys(CAMPANAS);
    const filas = (await strapi.db.query('api::campana-correo.campana-correo').findMany({
      select: ['clave', 'activa', 'porTanda', 'orden'],
    })) as Array<{ clave?: string; activa?: boolean; porTanda?: number; orden?: number }>;
    const porClave = new Map(filas.map((f) => [String(f.clave), f]));

    const campanas = [];
    for (const clave of claves) {
      const { pendientes, total, enviados, bajas } = await pendientesDe(strapi, clave);
      const fila = porClave.get(clave);
      const porTanda = Number(fila?.porTanda) || 11;
      campanas.push({
        clave,
        titulo: CAMPANAS[clave].titulo,
        total,
        enviados,
        pendientes: pendientes.length,
        bajas,
        activa: Boolean(fila?.activa),
        porTanda,
        orden: Number(fila?.orden) || ORDEN_POR_DEFECTO[clave] || 100,
        // Con una tanda cada 15 minutos.
        horasRestantes: pendientes.length > 0 ? Math.ceil(pendientes.length / porTanda) / 4 : 0,
        enTurno: false,
      });
    }

    /*
     * Quién está mandando AHORA. Solo puede haber una: las encendidas hacen
     * cola por `orden` y las demás esperan (ver envio-masivo.tanda). Marcarlo
     * acá evita la lectura equivocada de «encendida = está saliendo».
     */
    campanas.sort((a, b) => a.orden - b.orden);
    const turno = campanas.find((c) => c.activa && c.pendientes > 0);
    if (turno) turno.enTurno = true;

    ctx.body = { campanas };
  },

  /**
   * POST /admin-panel/broadcast/campana
   * Body: { clave, activa?: boolean, porTanda?: number }
   * Enciende, apaga o cambia el ritmo de una campaña.
   */
  async configurarCampana(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as {
      clave?: string;
      activa?: boolean;
      porTanda?: number;
      orden?: number;
    };
    const clave = String(body.clave ?? '');
    if (!CAMPANAS[clave]) {
      ctx.badRequest('Campaña desconocida.');
      return;
    }

    const datos: Record<string, unknown> = {};
    if (typeof body.activa === 'boolean') datos.activa = body.activa;
    if (body.porTanda !== undefined) {
      // 100 por tanda = 400 por hora: por debajo del plan más alto de Titan.
      datos.porTanda = Math.max(1, Math.min(100, Number(body.porTanda) || 11));
    }
    if (body.orden !== undefined) {
      datos.orden = Math.max(1, Math.min(999, Number(body.orden) || 100));
    }

    const existente = await strapi.db
      .query('api::campana-correo.campana-correo')
      .findOne({ where: { clave }, select: ['id'] });

    if (existente) {
      await strapi.db
        .query('api::campana-correo.campana-correo')
        .update({ where: { clave }, data: datos });
    } else {
      await strapi.db.query('api::campana-correo.campana-correo').create({
        data: {
          clave,
          activa: Boolean(datos.activa),
          porTanda: Number(datos.porTanda) || 11,
          orden: Number(datos.orden) || ORDEN_POR_DEFECTO[clave] || 100,
        },
      });
    }

    strapi.log.info(
      `[admin-panel.broadcast] campaña ${clave}: ${JSON.stringify(datos)}`,
    );
    ctx.body = { ok: true, clave, ...datos };
  },

  /**
   * POST /admin-panel/broadcast/tanda
   * Body: { clave }
   * Dispara una tanda ahora mismo sin esperar al cron. Sirve para ver salir la
   * primera y comprobar que llega, en vez de esperar un cuarto de hora.
   */
  async tandaAhora(ctx: Ctx) {
    const clave = String((ctx.request.body ?? {}).clave ?? '');
    if (!CAMPANAS[clave]) {
      ctx.badRequest('Campaña desconocida.');
      return;
    }
    const servicio = strapi.plugin('admin-panel').service('envioMasivo');
    ctx.body = { resultados: await servicio.tanda(clave) };
  },

  /**
   * GET /admin-panel/broadcast/app-lanzamiento/preview
   * Cuántos correos saldrían, separados por audiencia, con una muestra.
   */
  async previewAppLaunch(ctx: Ctx) {
    const { activos, invitados } = await destinatariosAppLaunch(strapi);
    const [act, inv] = await Promise.all([
      pendientesDe(strapi, CAMPANA_LANZAMIENTO),
      pendientesDe(strapi, CAMPANA_LANZAMIENTO_INVITADOS),
    ]);
    ctx.body = {
      cuentaActiva: activos.length,
      usuarioEnviado: invitados.length,
      total: activos.length + invitados.length,
      // Dos campañas distintas, cada una con su propio avance.
      activos: { pendientes: act.pendientes.length, yaEnviados: act.enviados, bajas: act.bajas },
      invitados: { pendientes: inv.pendientes.length, yaEnviados: inv.enviados, bajas: inv.bajas },
      muestraCuentaActiva: activos.slice(0, 5).map((d) => d.correo),
      muestraUsuarioEnviado: invitados.slice(0, 5).map((d) => d.correo),
    };
  },

  /**
   * POST /admin-panel/broadcast/app-lanzamiento
   * Body: { dryRun?: boolean, soloA?: string[] }
   *
   * `soloA` es el modo prueba y envía en el acto. Sin `soloA` ya no manda
   * nada: el envío completo se enciende con /broadcast/campana.
   */
  async sendAppLaunch(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as { dryRun?: boolean; soloA?: string[] };

    if (Array.isArray(body.soloA) && body.soloA.length) {
      const { activos, invitados } = await destinatariosAppLaunch(strapi);
      const porCorreo = new Map(
        [...activos, ...invitados].map((d) => [d.correo.toLowerCase(), d]),
      );
      const destinos = body.soloA
        .map((e) => String(e).trim())
        .filter((e) => e.includes('@'))
        .map(
          (correo) =>
            porCorreo.get(correo.toLowerCase()) ?? {
              correo,
              nombre: 'Estimado/a',
              audiencia: 'cuenta_activa' as AudienciaApp,
            },
        );
      if (!destinos.length) {
        ctx.badRequest('Ninguna dirección de prueba es válida.');
        return;
      }
      ctx.body = await enviarPrueba(strapi, CAMPANA_LANZAMIENTO, destinos);
      return;
    }

    if (body.dryRun) {
      const [act, inv] = await Promise.all([
        pendientesDe(strapi, CAMPANA_LANZAMIENTO),
        pendientesDe(strapi, CAMPANA_LANZAMIENTO_INVITADOS),
      ]);
      ctx.body = {
        dryRun: true,
        wouldSend: act.pendientes.length + inv.pendientes.length,
        activos: act.pendientes.length,
        invitados: inv.pendientes.length,
      };
      return;
    }

    ctx.badRequest(
      'El envío completo ya no sale de aquí: enciende la campaña en /broadcast/campana y el cron la manda a cuentagotas.',
    );
  },

  /**
   * GET /admin-panel/broadcast/profesionales/preview
   */
  async previewProfesionales(ctx: Ctx) {
    const { destinatarios, excluidos } = await destinatariosProfesionales(strapi);
    const { pendientes, enviados, bajas } = await pendientesDe(strapi, CAMPANA_DIRECTORIO_CORREO);
    ctx.body = {
      total: DIRECTORIO_PROFESIONALES.length,
      aEnviar: destinatarios.length,
      excluidos: excluidos.length,
      pendientes: pendientes.length,
      yaEnviados: enviados,
      bajas,
      conNombre: destinatarios.filter((d) => d.saludo !== 'Estimado/a').length,
      sinNombre: destinatarios.filter((d) => d.saludo === 'Estimado/a').length,
      muestraExcluidos: excluidos.slice(0, 10),
      muestra: destinatarios.slice(0, 5).map((d) => ({ correo: d.correo, saludo: d.saludo })),
    };
  },

  /**
   * GET /admin-panel/broadcast/profesionales/vista
   * HTML ya renderizado de un destinatario, para revisarlo antes de enviar.
   */
  async vistaProfesionales(ctx: Ctx) {
    const pedido = Number(ctx.query?.id);
    const persona =
      DIRECTORIO_PROFESIONALES.find((p) => p.id === pedido) ?? DIRECTORIO_PROFESIONALES[0];
    ctx.body = {
      id: persona.id,
      correo: persona.correo,
      saludo: persona.saludo,
      asunto: ASUNTO_INVITACION_PROFESIONAL,
      html: renderInvitacionProfesional({
        saludo: persona.saludo,
        destinatarioId: persona.id,
        correo: persona.correo,
      }),
    };
  },

  /**
   * POST /admin-panel/broadcast/profesionales
   * Body: { dryRun?: boolean, soloA?: string[] }  — igual que el de arriba.
   */
  async sendProfesionales(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as { dryRun?: boolean; soloA?: string[] };
    const { pendientes } = await pendientesDe(strapi, CAMPANA_DIRECTORIO_CORREO);

    if (Array.isArray(body.soloA) && body.soloA.length) {
      const porCorreo = new Map(
        DIRECTORIO_PROFESIONALES.map((p) => [p.correo.toLowerCase(), p]),
      );
      const destinos = body.soloA
        .map((e) => String(e).trim())
        .filter((e) => e.includes('@'))
        .map((correo) => {
          const p = porCorreo.get(correo.toLowerCase());
          return p
            ? { correo: p.correo, saludo: p.saludo, destinatarioId: p.id }
            : { correo, saludo: 'Estimado/a' };
        });
      if (!destinos.length) {
        ctx.badRequest('Ninguna dirección de prueba es válida.');
        return;
      }
      ctx.body = await enviarPrueba(strapi, CAMPANA_DIRECTORIO_CORREO, destinos);
      return;
    }

    if (body.dryRun) {
      ctx.body = { dryRun: true, wouldSend: pendientes.length };
      return;
    }

    ctx.badRequest(
      'El envío completo ya no sale de aquí: enciende la campaña en /broadcast/campana y el cron la manda a cuentagotas.',
    );
  },

  /**
   * GET /admin-panel/broadcast/ranking/preview
   * Alcance de la campaña al Ranking Legal, con el desglose por nivel — que
   * es lo que hay que mirar antes de ampliar el envío más allá del nivel A.
   */
  async previewRanking(ctx: Ctx) {
    const { destinatarios, excluidos, fueraDeNivel } = await destinatariosRanking(strapi);
    const { pendientes, enviados, bajas } = await pendientesDe(strapi, CAMPANA_RANKING_CORREO);

    const porNivel = { A: 0, B: 0, C: 0 } as Record<string, number>;
    for (const a of ABOGADOS_RANKING) porNivel[a.nivel] = (porNivel[a.nivel] ?? 0) + 1;

    ctx.body = {
      total: ABOGADOS_RANKING.length,
      porNivel,
      nivelesQueSeEnvian: NIVELES_QUE_SE_ENVIAN,
      fueraDeNivel,
      aEnviar: destinatarios.length,
      excluidos: excluidos.length,
      pendientes: pendientes.length,
      yaEnviados: enviados,
      bajas,
      muestraExcluidos: excluidos.slice(0, 10),
      muestra: destinatarios.slice(0, 5).map((d) => ({
        correo: d.correo,
        saludo: saludoRanking(d.nombre ?? ''),
      })),
    };
  },

  /**
   * POST /admin-panel/broadcast/ranking
   * Body: { dryRun?: boolean, soloA?: string[] } — igual que las otras dos.
   */
  async sendRanking(ctx: Ctx) {
    const body = (ctx.request.body ?? {}) as { dryRun?: boolean; soloA?: string[] };
    const { pendientes } = await pendientesDe(strapi, CAMPANA_RANKING_CORREO);

    if (Array.isArray(body.soloA) && body.soloA.length) {
      const porCorreo = new Map(ABOGADOS_RANKING.map((a) => [a.correo.toLowerCase(), a]));
      const destinos = body.soloA
        .map((e) => String(e).trim())
        .filter((e) => e.includes('@'))
        .map((correo) => {
          const a = porCorreo.get(correo.toLowerCase());
          return a
            ? { correo: a.correo, nombre: a.nombre, destinatarioId: a.id }
            : { correo, nombre: '' };
        });
      if (!destinos.length) {
        ctx.badRequest('Ninguna dirección de prueba es válida.');
        return;
      }
      ctx.body = await enviarPrueba(strapi, CAMPANA_RANKING_CORREO, destinos);
      return;
    }

    if (body.dryRun) {
      ctx.body = { dryRun: true, wouldSend: pendientes.length };
      return;
    }

    ctx.badRequest(
      'El envío completo ya no sale de aquí: enciende la campaña en /broadcast/campana y el cron la manda a cuentagotas.',
    );
  },
});

// ---------------------------------------------------------------------------

/**
 * Envío de prueba: sale en el acto y NO se anota como enviado.
 *
 * Lo segundo importa: si la prueba quedara registrada, la dirección propia con
 * la que se probó quedaría excluida del envío de verdad, y la persona que
 * revisó el correo nunca recibiría el que reciben los demás.
 */
async function enviarPrueba(
  strapi: Core.Strapi,
  clave: string,
  destinos: Destinatario[],
): Promise<{
  prueba: true;
  attempted: number;
  sent: number;
  failed: number;
  failedSample: Array<{ email: string; error: string }>;
}> {
  const fallidos: Array<{ email: string; error: string }> = [];
  let enviados = 0;

  for (const d of destinos) {
    try {
      const res = await CAMPANAS[clave].enviar(d);
      if (res.sent) enviados += 1;
      else
        fallidos.push({
          email: d.correo,
          error: res.error ?? (res.dryRun ? 'dry-run (SMTP sin configurar)' : 'desconocido'),
        });
    } catch (err: any) {
      fallidos.push({ email: d.correo, error: err?.message ?? String(err) });
    }
  }

  strapi.log.info(
    `[admin-panel.broadcast] prueba ${clave}: ${enviados} enviados, ${fallidos.length} fallidos`,
  );
  return {
    prueba: true,
    attempted: destinos.length,
    sent: enviados,
    failed: fallidos.length,
    failedSample: fallidos.slice(0, 10),
  };
}
