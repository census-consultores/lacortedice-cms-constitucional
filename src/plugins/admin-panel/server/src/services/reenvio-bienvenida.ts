import type { Core } from '@strapi/strapi';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendRelaunchEmail, sendWelcomeEmail } from './mailer';

/**
 * Envíos de correo programados desde el panel de admin. Dos tipos:
 *
 *  · 'bienvenida'   → usuarios que NUNCA han entrado (lastLoginAt y
 *    lastActiveAt vacíos). Se les genera una clave temporal NUEVA (la
 *    original no se guarda, solo su hash) y se reenvía el template
 *    `welcome`. Invalidar la clave anterior es inocuo: jamás fue usada.
 *  · 'reactivacion' → usuarios que sí entraron alguna vez pero llevan
 *    más de 30 días sin actividad. Reciben el template `relaunch`;
 *    sus contraseñas NO se tocan.
 *
 * La programación vive en el core store del plugin (sin migraciones) y la
 * ejecuta el tick del bootstrap cada minuto: sobrevive reinicios del CMS y
 * no depende de nadie conectado a la hora del envío. La lista `pendientes`
 * se persiste al arrancar la ejecución para que un reinicio a mitad de
 * envío retome donde quedó sin duplicar correos.
 */

export type TipoEnvio = 'bienvenida' | 'reactivacion';

type Fallo = { email: string; error: string };

export type EstadoReenvio = {
  estado: 'programado' | 'ejecutando' | 'completado' | 'cancelado';
  enviarEn: string; // ISO UTC
  creadoEn: string;
  actualizadoEn: string;
  pendientes: string[] | null; // emails aún por enviar (null = aún no computados)
  enviados: string[];
  fallidos: Fallo[];
  nota?: string;
};

const TIPOS: TipoEnvio[] = ['bienvenida', 'reactivacion'];
const CLAVE_STORE: Record<TipoEnvio, string> = {
  bienvenida: 'reenvio-bienvenida',
  reactivacion: 'reenvio-reactivacion',
};

const PAUSA_ENTRE_ENVIOS_MS = 3_000;
const REINTENTO_CUOTA_MIN = 65; // Titan: cuota por hora → reintentar pasada la hora
const MAX_DIAS_FUTURO = 30;
const DIAS_INACTIVIDAD = 30;

function randomTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function esErrorDeCuota(mensaje: string | undefined): boolean {
  if (!mensaje) return false;
  return /5\.4\.6\s*Sender Hourly Quota Exceeded/i.test(mensaje);
}

function emailValido(email: unknown): email is string {
  return typeof email === 'string' && /@/.test(email) && !email.includes('mail-tester');
}

const reenvioBienvenida = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = (tipo: TipoEnvio) =>
    strapi.store({ type: 'plugin', name: 'admin-panel', key: CLAVE_STORE[tipo] });

  // Candado en memoria: el tick corre cada minuto y un envío con pausas
  // puede tardar más que eso; sin esto se solaparían ejecuciones.
  let ejecutando = false;

  return {
    async leer(tipo: TipoEnvio = 'bienvenida'): Promise<EstadoReenvio | null> {
      return ((await store(tipo).get()) as EstadoReenvio | null) ?? null;
    },

    /**
     * Destinatarios según el tipo:
     *  · bienvenida: cuentas locales activas que jamás iniciaron sesión.
     *  · reactivacion: cuentas activas cuyo último uso fue hace más de
     *    30 días (cualquier proveedor: el correo no toca la contraseña).
     * Siempre se excluyen bloqueados y direcciones de mail-tester.
     */
    async destinatarios(tipo: TipoEnvio = 'bienvenida'): Promise<{ email: string; username: string }[]> {
      if (tipo === 'bienvenida') {
        const rows = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: {
            blocked: false,
            provider: 'local',
            lastLoginAt: { $null: true },
            lastActiveAt: { $null: true },
          },
          select: ['email', 'username'],
          orderBy: { email: 'asc' },
          limit: 500,
        });
        return rows.filter((r: any) => emailValido(r.email)).map((r: any) => ({ email: r.email, username: r.username }));
      }

      const corte = new Date(Date.now() - DIAS_INACTIVIDAD * 24 * 3600 * 1000);
      const rows = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { blocked: false, confirmed: true },
        select: ['email', 'username', 'lastLoginAt', 'lastActiveAt'],
        orderBy: { email: 'asc' },
        limit: 2000,
      });
      return rows
        .filter((r: any) => {
          if (!emailValido(r.email)) return false;
          const ultimo = r.lastActiveAt ?? r.lastLoginAt;
          return !!ultimo && new Date(ultimo) < corte;
        })
        .map((r: any) => ({ email: r.email, username: r.username }));
    },

    async programar(enviarEnISO: string, tipo: TipoEnvio = 'bienvenida'): Promise<EstadoReenvio> {
      const cuando = new Date(enviarEnISO);
      if (isNaN(cuando.getTime())) throw new Error('Fecha inválida');
      const ahora = Date.now();
      if (cuando.getTime() <= ahora) throw new Error('La fecha debe ser futura');
      if (cuando.getTime() > ahora + MAX_DIAS_FUTURO * 24 * 3600 * 1000)
        throw new Error(`La fecha no puede superar ${MAX_DIAS_FUTURO} días`);

      const actual = await this.leer(tipo);
      if (actual?.estado === 'ejecutando')
        throw new Error('Hay un envío ejecutándose en este momento');

      const nuevo: EstadoReenvio = {
        estado: 'programado',
        enviarEn: cuando.toISOString(),
        creadoEn: new Date().toISOString(),
        actualizadoEn: new Date().toISOString(),
        pendientes: null,
        enviados: [],
        fallidos: [],
      };
      await store(tipo).set({ value: nuevo });
      strapi.log.info(`[reenvio:${tipo}] programado para ${nuevo.enviarEn}`);
      return nuevo;
    },

    async cancelar(tipo: TipoEnvio = 'bienvenida'): Promise<EstadoReenvio | null> {
      const actual = await this.leer(tipo);
      if (!actual || actual.estado !== 'programado') return actual;
      const cancelado: EstadoReenvio = {
        ...actual,
        estado: 'cancelado',
        actualizadoEn: new Date().toISOString(),
      };
      await store(tipo).set({ value: cancelado });
      return cancelado;
    },

    /**
     * Llamado por el bootstrap cada minuto. Dispara los envíos cuya hora
     * llegó, o retoma una ejecución interrumpida por un reinicio.
     */
    async tick(): Promise<void> {
      if (ejecutando) return;
      ejecutando = true;
      try {
        for (const tipo of TIPOS) {
          const actual = await this.leer(tipo);
          if (!actual) continue;
          const debeCorrer =
            (actual.estado === 'programado' && new Date(actual.enviarEn).getTime() <= Date.now()) ||
            // 'ejecutando' persistido pero sin candado en memoria = el proceso
            // se reinició a mitad de envío → retomar con los pendientes guardados.
            actual.estado === 'ejecutando';
          if (!debeCorrer) continue;
          await this.ejecutar(tipo, actual);
        }
      } catch (err: any) {
        strapi.log.error('[reenvio] error en ejecución: ' + (err?.message ?? err));
      } finally {
        ejecutando = false;
      }
    },

    async ejecutar(tipo: TipoEnvio, estado: EstadoReenvio): Promise<void> {
      // Congelar la lista de destinatarios una sola vez.
      if (!estado.pendientes) {
        const objetivo = await this.destinatarios(tipo);
        estado.pendientes = objetivo.map((d) => d.email);
        strapi.log.info(`[reenvio:${tipo}] arrancando: ${estado.pendientes.length} destinatarios`);
      }
      estado.estado = 'ejecutando';
      estado.actualizadoEn = new Date().toISOString();
      await store(tipo).set({ value: estado });

      const pendientes = estado.pendientes;
      while (pendientes.length > 0) {
        const email = pendientes[0];

        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { email },
          select: ['id', 'email', 'username', 'blocked', 'lastLoginAt', 'lastActiveAt'],
        });

        // Eliminado o bloqueado mientras tanto → ya no aplica. Para la
        // bienvenida, si entró mientras tanto tampoco (no pisar su clave).
        const yaEntro = !!(user?.lastLoginAt || user?.lastActiveAt);
        if (!user || user.blocked || (tipo === 'bienvenida' && yaEntro)) {
          pendientes.shift();
          await store(tipo).set({ value: { ...estado, actualizadoEn: new Date().toISOString() } });
          continue;
        }

        try {
          const r = await this.enviarUno(tipo, user);

          if (r.sent || r.dryRun) {
            estado.enviados.push(user.email);
            strapi.log.info(`[reenvio:${tipo}] enviado a ${user.email}${r.dryRun ? ' (dry-run)' : ''}`);
          } else if (esErrorDeCuota(r.error)) {
            // Cuota por hora de Titan agotada: reprogramar el resto.
            estado.estado = 'programado';
            estado.enviarEn = new Date(Date.now() + REINTENTO_CUOTA_MIN * 60_000).toISOString();
            estado.nota = `Cuota SMTP agotada; el resto (${pendientes.length}) continúa a las ${estado.enviarEn}`;
            estado.actualizadoEn = new Date().toISOString();
            await store(tipo).set({ value: estado });
            strapi.log.warn(`[reenvio:${tipo}] ` + estado.nota);
            return;
          } else {
            estado.fallidos.push({ email: user.email, error: r.error ?? 'unknown_error' });
            strapi.log.warn(`[reenvio:${tipo}] fallo con ${user.email}: ${r.error}`);
          }
        } catch (err: any) {
          estado.fallidos.push({ email: user.email, error: err?.message ?? String(err) });
          strapi.log.error(`[reenvio:${tipo}] excepción con ${user.email}: ${err?.message}`);
        }

        pendientes.shift();
        estado.actualizadoEn = new Date().toISOString();
        await store(tipo).set({ value: estado });

        if (pendientes.length > 0) {
          await new Promise((r) => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
        }
      }

      estado.estado = 'completado';
      estado.actualizadoEn = new Date().toISOString();
      await store(tipo).set({ value: estado });
      strapi.log.info(
        `[reenvio:${tipo}] completado: ${estado.enviados.length} enviados, ${estado.fallidos.length} fallidos`
      );
    },

    /** Envía UN correo del tipo dado. La bienvenida rota la clave temporal. */
    async enviarUno(
      tipo: TipoEnvio,
      user: { id: number; email: string; username: string }
    ): Promise<{ sent: boolean; dryRun?: boolean; error?: string }> {
      if (tipo === 'reactivacion') {
        return sendRelaunchEmail({ to: user.email, nombre: user.username || 'Estimado/a' });
      }

      const tempPassword = randomTempPassword();
      const hashed = await bcrypt.hash(tempPassword, 10);
      // Mismo patrón que createUser: hash manual + query de bajo nivel,
      // para no pasar por lifecycles que re-hashearían la clave.
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { password: hashed, mustChangePassword: true },
      });
      return sendWelcomeEmail({
        to: user.email,
        nombre: user.username,
        email: user.email,
        passwordTemporal: tempPassword,
      });
    },
  };
};

export default reenvioBienvenida;
