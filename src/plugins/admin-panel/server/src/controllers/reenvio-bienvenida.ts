/**
 * Endpoints de admin para los envíos de correo programados:
 *
 *   GET  /admin-panel/reenvio-bienvenida
 *        → estado + destinatarios de ambos tipos (bienvenida y reactivación)
 *   POST /admin-panel/reenvio-bienvenida/programar
 *        → { enviarEn: ISO-8601 UTC, tipo?: 'bienvenida' | 'reactivacion' }
 *   POST /admin-panel/reenvio-bienvenida/cancelar
 *        → { tipo?: 'bienvenida' | 'reactivacion' }
 *
 * Policy: isAdmin. La lógica vive en services/reenvio-bienvenida.ts.
 */

function tipoDe(body: any): 'bienvenida' | 'reactivacion' {
  return body?.tipo === 'reactivacion' ? 'reactivacion' : 'bienvenida';
}

export default ({ strapi }) => ({
  async estado(ctx) {
    const svc = strapi.plugin('admin-panel').service('reenvioBienvenida');
    const [progBienvenida, progReactivacion, destBienvenida, destReactivacion] = await Promise.all([
      svc.leer('bienvenida'),
      svc.leer('reactivacion'),
      svc.destinatarios('bienvenida'),
      svc.destinatarios('reactivacion'),
    ]);
    ctx.body = {
      // Compatibilidad con la forma original (solo bienvenida)
      programacion: progBienvenida,
      destinatarios: destBienvenida.map((d) => d.email),
      total: destBienvenida.length,
      reactivacion: {
        programacion: progReactivacion,
        destinatarios: destReactivacion.map((d) => d.email),
        total: destReactivacion.length,
      },
    };
  },

  async programar(ctx) {
    const tipo = tipoDe(ctx.request.body);
    const enviarEn = String(ctx.request.body?.enviarEn ?? '');
    try {
      const svc = strapi.plugin('admin-panel').service('reenvioBienvenida');
      const programacion = await svc.programar(enviarEn, tipo);
      const destinatarios = await svc.destinatarios(tipo);
      ctx.body = {
        tipo,
        programacion,
        total: destinatarios.length,
        destinatarios: destinatarios.map((d) => d.email),
      };
    } catch (err: any) {
      return ctx.badRequest(err?.message ?? 'No se pudo programar');
    }
  },

  async cancelar(ctx) {
    const tipo = tipoDe(ctx.request.body);
    const svc = strapi.plugin('admin-panel').service('reenvioBienvenida');
    ctx.body = { tipo, programacion: await svc.cancelar(tipo) };
  },
});
