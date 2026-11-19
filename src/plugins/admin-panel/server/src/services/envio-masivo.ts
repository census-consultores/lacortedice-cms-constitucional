/**
 * Envío masivo a cuentagotas.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * El envío anterior soltaba toda la base —más de ochocientos correos— en un
 * minuto, en tandas de 25 con dos segundos de pausa. Eso no se puede hacer
 * desde Titan por dos razones distintas, y las dos terminan igual de mal:
 *
 *   · Titan tiene un tope por hora que va de 50 a 500 según el plan. Todo lo
 *     que pase de ahí rebota. No es que llegue tarde: no llega, y cada rebote
 *     empeora la reputación del dominio.
 *   · Aunque el tope lo aguantara, un dominio que nunca ha enviado volumen y
 *     de golpe suelta ochocientos correos en un minuto es el patrón exacto que
 *     los filtros usan para clasificar spam.
 *
 * Y el final es peor que un correo en la carpeta de spam: info@ es también el
 * buzón que manda las claves y los códigos de verificación de la app. Si Titan
 * lo suspende —lo hace a las cinco quejas—, no se cae la campaña, se cae el
 * ingreso a la plataforma.
 *
 * CÓMO FUNCIONA
 * -------------
 * Cada correo enviado deja una fila en `correo-envio`. Una campaña «pendiente»
 * es su audiencia menos lo ya enviado menos la lista de bajas, recalculado en
 * cada tanda. Eso permite repartir un envío a lo largo de horas o días sin que
 * nadie lo reciba dos veces, reanudarlo si el servidor se reinicia a la mitad,
 * y detenerlo en seco apagando el interruptor de `campana-correo`.
 *
 * El cron llama a `tanda()` cada 15 minutos y manda `porTanda` correos. Con el
 * valor por defecto de 11 salen 44 por hora, por debajo del tope más bajo de
 * Titan. Quien tenga un plan mayor sube el número desde el panel.
 */
import type { Core } from '@strapi/strapi';
import {
  sendAppLaunchEmail,
  sendInvitacionProfesional,
  sendInvitacionRanking,
  CAMPANA_LANZAMIENTO,
  CAMPANA_LANZAMIENTO_INVITADOS,
  CAMPANA_DIRECTORIO_CORREO,
  CAMPANA_RANKING_CORREO,
  type AudienciaApp,
  type MailResult,
} from './mailer';
import { DIRECTORIO_PROFESIONALES } from '../data/directorio-profesionales';
import { ABOGADOS_RANKING, NIVELES_QUE_SE_ENVIAN } from '../data/ranking-legal';

export type Destinatario = {
  correo: string;
  nombre?: string;
  saludo?: string;
  audiencia?: AudienciaApp;
  userId?: number | null;
  destinatarioId?: number | null;
};

const norm = (c: string) => c.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Audiencias
// ---------------------------------------------------------------------------

/**
 * Las dos listas del lanzamiento de la app, ya deduplicadas entre sí. Un
 * correo que existe como usuario nunca aparece también como invitado.
 */
export async function destinatariosAppLaunch(strapi: Core.Strapi): Promise<{
  activos: Destinatario[];
  invitados: Destinatario[];
}> {
  const usuarios = (await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { blocked: false, confirmed: true },
    select: ['id', 'email', 'username'],
  })) as Array<{ id?: number; email?: string; username?: string }>;

  const vistos = new Set<string>();
  const activos: Destinatario[] = [];
  for (const u of usuarios) {
    const email = typeof u.email === 'string' ? u.email.trim() : '';
    if (!email || !/@/.test(email)) continue;
    if (vistos.has(norm(email))) continue;
    vistos.add(norm(email));
    activos.push({
      correo: email,
      nombre: u.username || 'Estimado/a',
      audiencia: 'cuenta_activa',
      userId: typeof u.id === 'number' ? u.id : null,
    });
  }

  // Correos a los que se les mandó un usuario y todavía no hay cuenta activa.
  // `revoked` y `expired` quedan fuera a propósito.
  let filasInvitadas: Array<{ email?: string }> = [];
  try {
    filasInvitadas = (await strapi.db.query('api::invited-email.invited-email').findMany({
      where: { status: { $in: ['invited', 'form_started', 'pending_verification'] } },
      select: ['email'],
    })) as typeof filasInvitadas;
  } catch (err: any) {
    strapi.log.warn(`[envio-masivo] no se pudo leer invited-email: ${err?.message ?? err}`);
  }

  const invitados: Destinatario[] = [];
  for (const f of filasInvitadas) {
    const email = typeof f.email === 'string' ? f.email.trim() : '';
    if (!email || !/@/.test(email)) continue;
    if (vistos.has(norm(email))) continue;
    vistos.add(norm(email));
    invitados.push({ correo: email, nombre: 'Estimado/a', audiencia: 'usuario_enviado' });
  }

  return { activos, invitados };
}

/**
 * Directorio de profesionales, quitando a quien ya entra en la audiencia del
 * correo de lanzamiento: nadie recibe los dos. Se recalcula en cada llamada,
 * así que alguien del directorio que se registre a mitad de campaña deja de
 * recibir ésta y pasa a la otra.
 */
export async function destinatariosProfesionales(strapi: Core.Strapi): Promise<{
  destinatarios: Destinatario[];
  excluidos: string[];
}> {
  const { activos, invitados } = await destinatariosAppLaunch(strapi);
  const yaReciben = new Set([...activos, ...invitados].map((d) => norm(d.correo)));

  const destinatarios: Destinatario[] = [];
  const excluidos: string[] = [];
  for (const p of DIRECTORIO_PROFESIONALES) {
    if (yaReciben.has(norm(p.correo))) excluidos.push(p.correo);
    else
      destinatarios.push({
        correo: p.correo,
        nombre: p.nombre,
        saludo: p.saludo,
        destinatarioId: p.id,
      });
  }
  return { destinatarios, excluidos };
}

/**
 * Abogados del Ranking Legal, quitando:
 *   · los niveles que no se envían (por defecto sólo va el A — ver el
 *     comentario de `data/ranking-legal.ts`: mandar a direcciones deducidas
 *     genera rebotes, y una tasa alta de rebotes castiga al dominio entero);
 *   · a quien ya entra en la audiencia del correo de lanzamiento;
 *   · a quien ya está en el directorio de profesionales.
 *
 * Nadie recibe dos invitaciones por estar en dos listas.
 */
export async function destinatariosRanking(strapi: Core.Strapi): Promise<{
  destinatarios: Destinatario[];
  excluidos: string[];
  fueraDeNivel: number;
}> {
  const { activos, invitados } = await destinatariosAppLaunch(strapi);
  const yaReciben = new Set([
    ...[...activos, ...invitados].map((d) => norm(d.correo)),
    ...DIRECTORIO_PROFESIONALES.map((p) => norm(p.correo)),
  ]);

  const niveles = new Set(NIVELES_QUE_SE_ENVIAN);
  const destinatarios: Destinatario[] = [];
  const excluidos: string[] = [];
  let fueraDeNivel = 0;

  for (const a of ABOGADOS_RANKING) {
    if (!niveles.has(a.nivel)) {
      fueraDeNivel += 1;
      continue;
    }
    if (yaReciben.has(norm(a.correo))) excluidos.push(a.correo);
    else
      destinatarios.push({
        correo: a.correo,
        nombre: a.nombre,
        destinatarioId: a.id,
      });
  }
  return { destinatarios, excluidos, fueraDeNivel };
}

// ---------------------------------------------------------------------------
// Registro de bajas y de envíos
// ---------------------------------------------------------------------------

/** Lista de supresión completa, en minúsculas. Vale para todas las campañas. */
export async function correosSuprimidos(strapi: Core.Strapi): Promise<Set<string>> {
  try {
    const filas = (await strapi.db
      .query('api::correo-baja.correo-baja')
      .findMany({ select: ['correo'] })) as Array<{ correo?: string }>;
    return new Set(filas.map((f) => norm(String(f.correo ?? ''))).filter(Boolean));
  } catch (err: any) {
    /*
     * Si la tabla no se puede leer, se DEVUELVE VACÍA y el envío continúa.
     * Es deliberado y es la decisión incómoda: fallar cerrado (no enviar
     * nada) deja la campaña muerta sin que nadie se entere. Pero significa
     * que un fallo acá puede mandarle correo a alguien que se dio de baja,
     * así que queda en el registro como error, no como aviso.
     */
    strapi.log.error(`[envio-masivo] no se pudo leer la lista de bajas: ${err?.message ?? err}`);
    return new Set();
  }
}

/** Correos a los que esta campaña ya salió (con éxito o no). */
export async function correosYaEnviados(
  strapi: Core.Strapi,
  campana: string,
): Promise<Set<string>> {
  try {
    const filas = (await strapi.db
      .query('api::correo-envio.correo-envio')
      .findMany({ where: { campana }, select: ['correo'] })) as Array<{ correo?: string }>;
    return new Set(filas.map((f) => norm(String(f.correo ?? ''))).filter(Boolean));
  } catch (err: any) {
    strapi.log.error(`[envio-masivo] no se pudo leer los envíos: ${err?.message ?? err}`);
    return new Set();
  }
}

async function registrarEnvio(
  strapi: Core.Strapi,
  datos: {
    correo: string;
    campana: string;
    estado: 'enviado' | 'fallido';
    destinatarioId?: number | null;
    error?: string;
  },
): Promise<void> {
  try {
    await strapi.db.query('api::correo-envio.correo-envio').create({
      data: {
        correo: norm(datos.correo),
        campana: datos.campana,
        estado: datos.estado,
        destinatarioId: datos.destinatarioId ?? null,
        error: datos.error ? String(datos.error).slice(0, 500) : null,
      },
    });
  } catch (err: any) {
    // Si no se pudo anotar, el correo YA salió. Se registra fuerte porque el
    // riesgo concreto es que la próxima tanda se lo mande otra vez.
    strapi.log.error(
      `[envio-masivo] correo enviado pero NO anotado (${datos.campana}): ${err?.message ?? err}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Campañas
// ---------------------------------------------------------------------------

type Campana = {
  clave: string;
  titulo: string;
  audiencia: (strapi: Core.Strapi) => Promise<Destinatario[]>;
  enviar: (d: Destinatario) => Promise<MailResult>;
};

/**
 * Orden de la cola cuando una campaña se enciende por primera vez.
 *
 * El criterio lo fijó el cliente: primero el directorio de profesionales,
 * después los abogados del Ranking Legal, y al final la base de la
 * plataforma. Se puede cambiar desde el panel.
 */
export const ORDEN_POR_DEFECTO: Record<string, number> = {
  // Los que ya usan la plataforma van primero: abren, hacen clic y casi nunca
  // se quejan, y esa reputación es la que sostiene los envíos fríos que vienen
  // detrás. Después las dos listas externas, y al final los invitados que
  // nunca estrenaron su usuario, que a efectos del filtro son desconocidos.
  [CAMPANA_LANZAMIENTO]: 1,
  [CAMPANA_DIRECTORIO_CORREO]: 2,
  [CAMPANA_RANKING_CORREO]: 3,
  [CAMPANA_LANZAMIENTO_INVITADOS]: 4,
};

export const CAMPANAS: Record<string, Campana> = {
  [CAMPANA_LANZAMIENTO]: {
    clave: CAMPANA_LANZAMIENTO,
    titulo: 'Usuarios con cuenta activa',
    audiencia: async (strapi) => (await destinatariosAppLaunch(strapi)).activos,
    enviar: (d) =>
      sendAppLaunchEmail({
        to: d.correo,
        nombre: d.nombre ?? 'Estimado/a',
        audiencia: 'cuenta_activa',
        userId: d.userId ?? null,
      }),
  },
  [CAMPANA_LANZAMIENTO_INVITADOS]: {
    clave: CAMPANA_LANZAMIENTO_INVITADOS,
    titulo: 'Invitados que no estrenaron su usuario',
    audiencia: async (strapi) => (await destinatariosAppLaunch(strapi)).invitados,
    enviar: (d) =>
      sendAppLaunchEmail({
        to: d.correo,
        nombre: d.nombre ?? 'Estimado/a',
        audiencia: 'usuario_enviado',
        userId: null,
      }),
  },
  [CAMPANA_DIRECTORIO_CORREO]: {
    clave: CAMPANA_DIRECTORIO_CORREO,
    titulo: 'Invitación a profesionales',
    audiencia: async (strapi) => (await destinatariosProfesionales(strapi)).destinatarios,
    enviar: (d) =>
      sendInvitacionProfesional({
        to: d.correo,
        saludo: d.saludo ?? 'Estimado/a',
        destinatarioId: d.destinatarioId ?? null,
      }),
  },
  [CAMPANA_RANKING_CORREO]: {
    clave: CAMPANA_RANKING_CORREO,
    titulo: 'Abogados del Ranking Legal',
    audiencia: async (strapi) => (await destinatariosRanking(strapi)).destinatarios,
    enviar: (d) =>
      sendInvitacionRanking({
        to: d.correo,
        nombre: d.nombre ?? '',
        destinatarioId: d.destinatarioId ?? null,
      }),
  },
};

/* ==========================================================================
 * VENTANAS DE ENVÍO
 * ==========================================================================
 *
 * EL PROBLEMA
 * El cron corre cada quince minutos las veinticuatro horas. Sin más, una
 * campaña encendida un viernes por la tarde sigue mandando correos a las
 * tres de la mañana del sábado. Titan no protesta —su tope es por hora, no
 * por horario— pero un correo que llega de madrugada se abre menos y se
 * marca como spam más, y esa señal sí se paga después.
 *
 * LA SOLUCIÓN
 * Una lista de franjas horarias. Fuera de ellas la tanda no sale y la
 * campaña NO se apaga: sigue encendida, con su cola intacta, y reanuda sola
 * cuando entra la siguiente franja. Apagar sería peor: habría que acordarse
 * de volver a encenderla.
 *
 * DÓNDE SE CONFIGURA
 * `ENVIO_VENTANAS` en el entorno manda si existe; si no, rige la lista de
 * abajo. Así se puede cambiar el horario desde Render sin desplegar código,
 * pero funciona sin configurar nada.
 *
 * FORMATO  `AAAA-MM-DD HH:MM-HH:MM`, separadas por `;` o salto de línea.
 * Las horas son de ECUADOR (America/Guayaquil), no del servidor, que corre
 * en UTC. La conversión la hace Intl y no una resta de cinco horas a mano:
 * es la zona quien sabe si algún día hay cambio de hora, no nosotros.
 *
 * SIN VENTANAS SE ENVÍA SIEMPRE. Una lista vacía, mal escrita o ya vencida
 * no puede significar «manda a cualquier hora» —sería justo el error que
 * esto viene a evitar—, así que una lista con franjas pero todas pasadas
 * detiene el envío y lo dice en el log.
 */
type Ventana = { desde: number; hasta: number };

/**
 * El calendario que pidió John para el lanzamiento de septiembre de 2026.
 * Hora de Ecuador.
 */
const VENTANAS_POR_DEFECTO = [
  '2026-09-18 18:00-21:00', // viernes, desde que se enciende
  '2026-09-19 12:00-18:00', // sábado
  '2026-09-21 15:00-21:00', // lunes
  '2026-09-22 15:00-21:00', // martes
].join('; ');

/** Minutos absolutos desde el año 0 — sirve para comparar, no para mostrar. */
function aMinutos(aaaa: number, mm: number, dd: number, hh: number, mi: number): number {
  return Date.UTC(aaaa, mm - 1, dd, hh, mi) / 60000;
}

function parsearVentanas(texto: string): Ventana[] {
  const out: Ventana[] = [];
  for (const trozo of texto.split(/[;\n]/)) {
    const t = trozo.trim();
    if (!t) continue;
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const [, y, mo, d, h1, mi1, h2, mi2] = m;
    const desde = aMinutos(+y, +mo, +d, +h1, +mi1);
    const hasta = aMinutos(+y, +mo, +d, +h2, +mi2);
    if (hasta > desde) out.push({ desde, hasta });
  }
  return out;
}

/** Ahora mismo, en minutos, medido con el reloj de Ecuador. */
function ahoraEnEcuador(): number {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const g = (k: string) => Number(f.find((p) => p.type === k)?.value ?? 0);
  return aMinutos(g('year'), g('month'), g('day'), g('hour') % 24, g('minute'));
}

/**
 * ¿Toca enviar ahora? Devuelve además el motivo, para que el log diga por qué
 * una campaña encendida no está mandando nada —es la primera pregunta que se
 * hace quien mira y no ve correos salir—.
 */
export function ventanaActiva(): { abierta: boolean; motivo: string } {
  const texto = (process.env.ENVIO_VENTANAS ?? VENTANAS_POR_DEFECTO).trim();
  if (!texto) return { abierta: true, motivo: 'sin ventanas configuradas: se envía a cualquier hora' };

  const ventanas = parsearVentanas(texto);
  if (!ventanas.length) {
    return { abierta: false, motivo: `ENVIO_VENTANAS no se pudo leer: ${texto.slice(0, 120)}` };
  }

  const ahora = ahoraEnEcuador();
  if (ventanas.some((v) => ahora >= v.desde && ahora < v.hasta)) {
    return { abierta: true, motivo: 'dentro de la ventana' };
  }

  const proxima = ventanas.filter((v) => v.desde > ahora).sort((a, b) => a.desde - b.desde)[0];
  return {
    abierta: false,
    motivo: proxima
      ? `fuera de ventana; faltan ${Math.round((proxima.desde - ahora) / 6) / 10} h para la siguiente`
      : 'fuera de ventana; no quedan franjas por delante',
  };
}

/** Quiénes faltan por recibir esta campaña, en orden. */
export async function pendientesDe(
  strapi: Core.Strapi,
  clave: string,
): Promise<{ pendientes: Destinatario[]; total: number; enviados: number; bajas: number }> {
  const campana = CAMPANAS[clave];
  if (!campana) throw new Error(`Campaña desconocida: ${clave}`);

  const [audiencia, yaEnviados, suprimidos] = await Promise.all([
    campana.audiencia(strapi),
    correosYaEnviados(strapi, clave),
    correosSuprimidos(strapi),
  ]);

  let bajas = 0;
  const pendientes = audiencia.filter((d) => {
    const c = norm(d.correo);
    if (yaEnviados.has(c)) return false;
    if (suprimidos.has(c)) {
      bajas += 1;
      return false;
    }
    return true;
  });

  return { pendientes, total: audiencia.length, enviados: yaEnviados.size, bajas };
}

/*
 * CERROJO: una sola tanda a la vez.
 *
 * El 18 de septiembre de 2026 el cron estaba registrado por duplicado y cada
 * tarea corria dos veces en el mismo instante. Las dos ejecuciones leian la
 * misma lista de pendientes con milisegundos de diferencia -ninguna habia
 * registrado todavia su envio- y las dos mandaban a las mismas once personas.
 * 88 destinatarios recibieron el correo dos veces.
 *
 * La causa se arreglo en src/index.ts, quitando el registro manual. Esto es
 * la segunda linea de defensa: aunque algo vuelva a disparar dos tandas a la
 * vez, la segunda se encuentra el cerrojo puesto y se va sin mandar nada.
 *
 * Un booleano en memoria basta porque el servicio corre en UN proceso: Render
 * no escala servicios con disco, y este lo tiene. El dia que haya dos
 * instancias esto ya no alcanza y hara falta un cerrojo en la base.
 */
let tandaEnCurso = false;

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Manda la siguiente tanda de cada campaña encendida. La llama el cron cada
   * 15 minutos; también sirve para disparar una tanda a mano desde el panel.
   *
   * Nunca lanza: un fallo acá no puede tumbar el proceso del cron.
   */
  async tanda(soloClave?: string) {
    const resultados: Array<{
      campana: string;
      enviados: number;
      fallidos: number;
      pendientes: number;
      apagada?: boolean;
    }> = [];

    if (tandaEnCurso) {
      strapi.log.warn('[envio-masivo.tanda] ya hay una tanda en curso; esta se descarta');
      return resultados;
    }
    tandaEnCurso = true;
    try {

    /*
     * La ventana horaria se mira ANTES de tocar la base. `soloClave` —la tanda
     * manual del panel— se la salta a propósito: si alguien pulsa el botón a
     * medianoche es porque quiere mandar a medianoche.
     */
    if (!soloClave) {
      const { abierta, motivo } = ventanaActiva();
      if (!abierta) {
        strapi.log.info(`[envio-masivo.tanda] en pausa — ${motivo}`);
        return resultados;
      }
    }

    let activas: Array<{ clave?: string; porTanda?: number; orden?: number }> = [];
    try {
      activas = (await strapi.db.query('api::campana-correo.campana-correo').findMany({
        where: { activa: true },
        select: ['clave', 'porTanda', 'orden'],
      })) as typeof activas;
    } catch (err: any) {
      strapi.log.error(`[envio-masivo.tanda] no se pudo leer las campañas: ${err?.message ?? err}`);
      return resultados;
    }

    /*
     * LAS CAMPAÑAS ENCENDIDAS SON UNA COLA, NO UN CORO.
     *
     * Solo sale la de menor `orden`; las demás esperan aunque estén
     * encendidas, y entran solas cuando la de delante termina y se apaga.
     *
     * Esto respeta la prioridad de cada lista, pero sobre todo evita un
     * error que no se vería venir: si dos campañas encendidas mandaran su
     * tanda en el mismo cuarto de hora, sus ritmos se sumarían. Dos a 44 por
     * hora son 88, y el tope de Titan en los planes básicos es 50. El envío
     * se vería «configurado despacio» y estaría rebotando igual.
     *
     * `soloClave` —la tanda manual del panel— se salta la cola a propósito:
     * es un disparo puntual y deliberado, no el ritmo automático.
     */
    const enTurno = activas
      .filter((f) => CAMPANAS[String(f.clave ?? '')])
      .sort((a, b) => (Number(a.orden) || 100) - (Number(b.orden) || 100));
    const cola = soloClave
      ? enTurno.filter((f) => String(f.clave) === soloClave)
      : enTurno.slice(0, 1);

    if (!soloClave && enTurno.length > 1) {
      strapi.log.info(
        `[envio-masivo.tanda] en turno ${String(enTurno[0].clave)}; esperando: ${enTurno
          .slice(1)
          .map((f) => f.clave)
          .join(', ')}`,
      );
    }

    for (const fila of cola) {
      const clave = String(fila.clave ?? '');

      // Tope duro por si alguien escribe un número enorme en el panel: 100 por
      // tanda son 400 por hora, todavía por debajo del plan más alto de Titan.
      const porTanda = Math.max(1, Math.min(100, Number(fila.porTanda) || 11));

      try {
        const { pendientes } = await pendientesDe(strapi, clave);
        const lote = pendientes.slice(0, porTanda);

        if (!lote.length) {
          // Campaña terminada: se apaga sola para no volver a consultarla cada
          // cuarto de hora para siempre.
          await strapi.db
            .query('api::campana-correo.campana-correo')
            .update({ where: { clave }, data: { activa: false } });
          strapi.log.info(`[envio-masivo.tanda] ${clave}: terminada, campaña apagada`);
          resultados.push({ campana: clave, enviados: 0, fallidos: 0, pendientes: 0, apagada: true });
          continue;
        }

        let enviados = 0;
        let fallidos = 0;
        /*
         * De uno en uno y no en paralelo, a propósito. Titan cuenta por hora,
         * pero abrir veinte conexiones SMTP a la vez desde una cuenta de buzón
         * es en sí mismo un patrón de envío masivo. Con la pausa de abajo, una
         * tanda de once tarda menos de medio minuto.
         */
        for (const d of lote) {
          try {
            const res = await CAMPANAS[clave].enviar(d);
            if (res.sent) {
              enviados += 1;
              await registrarEnvio(strapi, {
                correo: d.correo,
                campana: clave,
                estado: 'enviado',
                destinatarioId: d.destinatarioId ?? d.userId ?? null,
              });
            } else if (res.dryRun) {
              // Sin SMTP configurado no se anota nada: no salió ningún correo
              // y anotarlo dejaría a esa persona fuera del envío de verdad.
              strapi.log.warn(`[envio-masivo.tanda] ${clave}: modo simulación, no se anota`);
            } else {
              fallidos += 1;
              await registrarEnvio(strapi, {
                correo: d.correo,
                campana: clave,
                estado: 'fallido',
                error: res.error,
              });
            }
          } catch (err: any) {
            fallidos += 1;
            await registrarEnvio(strapi, {
              correo: d.correo,
              campana: clave,
              estado: 'fallido',
              error: err?.message ?? String(err),
            });
          }
          await new Promise((r) => setTimeout(r, 2000));
        }

        strapi.log.info(
          `[envio-masivo.tanda] ${clave}: ${enviados} enviados, ${fallidos} fallidos, faltan ${pendientes.length - lote.length}`,
        );
        resultados.push({
          campana: clave,
          enviados,
          fallidos,
          pendientes: pendientes.length - lote.length,
        });
      } catch (err: any) {
        strapi.log.error(`[envio-masivo.tanda] ${clave}: ${err?.message ?? err}`);
      }
    }

    return resultados;
    } finally {
      tandaEnCurso = false;
    }
  },
});
