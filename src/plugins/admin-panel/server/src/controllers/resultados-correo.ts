import type { Core } from '@strapi/strapi';
import { CAMPANAS } from '../services/envio-masivo';
import {
  CAMPANA_DIRECTORIO_CORREO,
  CAMPANA_RANKING_CORREO,
  CAMPANA_LANZAMIENTO,
  CAMPANA_LANZAMIENTO_INVITADOS,
} from '../services/mailer';
import { DIRECTORIO_PROFESIONALES } from '../data/directorio-profesionales';
import { ABOGADOS_RANKING } from '../data/ranking-legal';
import { traerTodo } from '../utils/traer-todo';

type Ctx = any;

/**
 * Resultados de las campañas de correo.
 *
 * QUÉ CRUZA Y POR QUÉ HACEN FALTA LAS TRES FUENTES
 * ------------------------------------------------
 *  · `correo_envios`  — a quién le salió el correo y a quién le falló.
 *  · `analytics.events` (`store_click`) — quién pulsó el botón de la tienda.
 *    Es el puente `/ir/...` el que lo registra: los enlaces del correo no van
 *    directos a la tienda precisamente para que este número exista sin
 *    depender de que Apple o Google quieran contarlo.
 *  · `up_users` — quién terminó creando cuenta. Sin esto el panel diría
 *    «hubo clics» y no «sirvió»: un clic es una intención, una cuenta es el
 *    resultado.
 *
 * QUIÉN ES CADA CLIC
 * ------------------
 * En el enlace nunca viaja el correo de nadie. Va `d=<id>` —la fila en la
 * lista de destinatarios— o `u=<id>` cuando la persona ya tiene cuenta. El
 * nombre se resuelve acá, contra las listas que ya viven en el servidor, y
 * sale sólo para el panel.
 *
 * Las cuentas creadas sólo se miran en las listas frías (directorio y Ranking):
 * en las campañas a la base de la plataforma la gente ya tenía cuenta antes,
 * así que ahí ese número no significaría nada.
 */
const LISTAS_FRIAS: Record<string, Array<{ id: number; correo: string; nombre: string }>> = {
  [CAMPANA_DIRECTORIO_CORREO]: DIRECTORIO_PROFESIONALES.map((p) => ({
    id: p.id,
    correo: p.correo,
    nombre: p.nombre || '',
  })),
  [CAMPANA_RANKING_CORREO]: ABOGADOS_RANKING.map((a) => ({
    id: a.id,
    correo: a.correo,
    nombre: a.nombre,
  })),
};

const norm = (c: string) => (c ?? '').trim().toLowerCase();

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * GET /admin-panel/broadcast/resultados
   * Embudo por campaña más una muestra de quién hizo clic.
   */
  async resultados(ctx: Ctx) {
    const claves = Object.keys(CAMPANAS);

    // --- Envíos y fallos, por campaña -------------------------------------
    const envios = (await traerTodo(strapi, 'api::correo-envio.correo-envio', {
      select: ['correo', 'campana', 'estado', 'destinatarioId', 'createdAt'],
    })) as Array<{
      correo?: string;
      campana?: string;
      estado?: string;
      destinatarioId?: number;
      createdAt?: string;
    }>;

    const bajas = (await traerTodo(strapi, 'api::correo-baja.correo-baja', {
      select: ['correo', 'campana', 'motivo'],
    })) as Array<{ correo?: string; campana?: string; motivo?: string }>;

    // --- Clics en la tienda ------------------------------------------------
    // Consulta cruda: `analytics.events` vive fuera de los content-types de
    // Strapi. Se agrupa por campaña y destino, y se cuenta también por
    // PERSONA: un mismo destinatario que pulsa tres veces es un interesado,
    // no tres.
    let clicsFilas: Array<{
      campana: string;
      destino: string;
      clics: number;
      personas: number;
    }> = [];
    let ultimosClics: Array<{
      campana: string;
      destino: string;
      destinatario: string | null;
      user_id: string | null;
      event_timestamp: string;
    }> = [];

    try {
      const r1 = await strapi.db.connection.raw(`
        SELECT payload->>'campana'                                   AS campana,
               payload->>'destino'                                   AS destino,
               COUNT(*)::int                                         AS clics,
               /*
                * user_id::text NO es cosmetico. Sin el cast, Postgres corta
                * la consulta entera con «COALESCE types text and integer
                * cannot be matched»: payload->>'destinatario' es texto y
                * user_id es entero, y COALESCE exige un solo tipo.
                *
                * Esa excepcion se tragaba el try/catch de abajo y la pantalla
                * decia «no se pudo leer la trazabilidad» con los clics en
                * cero. Los clics estaban guardados todo el tiempo; lo que
                * fallaba era contarlos.
                */
               COUNT(DISTINCT COALESCE(
                 NULLIF(payload->>'destinatario', ''), user_id::text
               ))::int                                               AS personas
          FROM analytics.events
         WHERE event_name = 'store_click'
           AND payload->>'campana' IS NOT NULL
         GROUP BY 1, 2
      `);
      clicsFilas = r1?.rows ?? [];

      const r2 = await strapi.db.connection.raw(`
        SELECT payload->>'campana'      AS campana,
               payload->>'destino'      AS destino,
               payload->>'destinatario' AS destinatario,
               user_id,
               event_timestamp
          FROM analytics.events
         WHERE event_name = 'store_click'
           AND payload->>'campana' IS NOT NULL
         ORDER BY event_timestamp DESC
         LIMIT 300
      `);
      ultimosClics = r2?.rows ?? [];
    } catch (err: any) {
      // La trazabilidad puede estar apagada. El resto del panel sirve igual;
      // lo que no puede es mentir diciendo «0 clics» cuando no pudo mirar.
      /*
       * Se registra el error COMPLETO, no solo `.message`. La primera vez que
       * esto fallo el log decia «no se pudo leer los clics:» y nada mas: el
       * error de Postgres traia el detalle en otros campos y el mensaje venia
       * vacio. Un aviso sin causa obliga a reproducir el fallo para saber que
       * paso, que es exactamente lo que un log existe para evitar.
       */
      strapi.log.warn(
        `[resultados-correo] no se pudo leer los clics: ${
          err?.message || err?.detail || err?.code || ''
        } :: ${JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})).slice(0, 600)}`,
      );
      clicsFilas = [];
      ultimosClics = [];
    }
    const trazabilidadOk = clicsFilas.length > 0 || ultimosClics.length > 0;

    // --- Cuentas creadas por las listas frías -------------------------------
    const cuentasPorCampana: Record<string, number> = {};
    for (const [clave, lista] of Object.entries(LISTAS_FRIAS)) {
      try {
        const correos = lista.map((p) => p.correo);
        const usuarios = (await traerTodo(strapi, 'plugin::users-permissions.user', {
          where: { email: { $in: correos } },
          select: ['id'],
        })) as Array<{ id: number }>;
        cuentasPorCampana[clave] = usuarios.length;
      } catch (err: any) {
        strapi.log.warn(`[resultados-correo] cuentas de ${clave}: ${err?.message ?? err}`);
      }
    }

    // --- Resolver quién es cada clic ---------------------------------------
    const usuariosPorId = new Map<string, { correo: string; nombre: string }>();
    const idsUsuario = [
      ...new Set(ultimosClics.map((c) => Number(c.user_id)).filter((n) => Number.isInteger(n) && n > 0)),
    ];
    if (idsUsuario.length) {
      try {
        const us = (await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: idsUsuario } },
          select: ['id', 'email', 'username'],
        })) as Array<{ id: number; email?: string; username?: string }>;
        for (const u of us) {
          usuariosPorId.set(String(u.id), { correo: u.email ?? '', nombre: u.username ?? '' });
        }
      } catch { /* si falla, el clic se muestra sin nombre */ }
    }

    function quien(fila: (typeof ultimosClics)[number]): { nombre: string; correo: string } {
      const lista = LISTAS_FRIAS[fila.campana];
      if (lista && fila.destinatario) {
        const p = lista.find((x) => x.id === Number(fila.destinatario));
        if (p) return { nombre: p.nombre, correo: p.correo };
      }
      if (fila.user_id) {
        const u = usuariosPorId.get(String(fila.user_id));
        if (u) return { nombre: u.nombre, correo: u.correo };
      }
      return { nombre: '', correo: '' };
    }

    // --- Armado por campaña -------------------------------------------------
    const campanas = claves.map((clave) => {
      const míos = envios.filter((e) => e.campana === clave);
      const enviados = míos.filter((e) => e.estado === 'enviado').length;
      const fallidos = míos.filter((e) => e.estado === 'fallido').length;
      const fechas = míos.map((e) => e.createdAt).filter(Boolean).sort();

      const clicsIos = clicsFilas.find((c) => c.campana === clave && c.destino === 'app-store');
      const clicsAndroid = clicsFilas.find((c) => c.campana === clave && c.destino === 'play-store');
      const clics = (clicsIos?.clics ?? 0) + (clicsAndroid?.clics ?? 0);

      // Personas únicas del total: se recalcula sobre la muestra cruda para no
      // sumar dos veces a quien pulsó en iPhone y en Android.
      const personas = new Set(
        ultimosClics
          .filter((c) => c.campana === clave)
          // String() en los dos: del lado SQL el id viaja como texto y del
          // lado JS user_id llega como numero. Sin normalizar, 42 y "42"
          // contarian como dos personas distintas.
          .map((c) => String(c.destinatario || c.user_id || '')),
      );
      personas.delete('');

      const bajasDe = bajas.filter((b) => b.campana === clave).length;
      const esFria = Boolean(LISTAS_FRIAS[clave]);

      const muestra = ultimosClics
        .filter((c) => c.campana === clave)
        .slice(0, 25)
        .map((c) => ({
          ...quien(c),
          destino: c.destino === 'app-store' ? 'iPhone' : 'Android',
          cuando: c.event_timestamp,
        }));

      return {
        clave,
        titulo: CAMPANAS[clave].titulo,
        enviados,
        fallidos,
        bajas: bajasDe,
        clics,
        personas: personas.size,
        ios: clicsIos?.clics ?? 0,
        android: clicsAndroid?.clics ?? 0,
        cuentas: esFria ? (cuentasPorCampana[clave] ?? null) : null,
        esFria,
        primerEnvio: fechas[0] ?? null,
        ultimoEnvio: fechas[fechas.length - 1] ?? null,
        muestra,
      };
    });

    ctx.body = {
      campanas,
      trazabilidadOk,
      // Total de bajas sin campaña asociada (llegaron por el mailto, por
      // ejemplo). No pertenecen a ninguna columna pero hay que verlas.
      bajasSinCampana: bajas.filter((b) => !b.campana).length,
      bajasPorMotivo: bajas.reduce<Record<string, number>>((acc, b) => {
        const m = b.motivo ?? 'otro';
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      }, {}),
    };
  },
});
