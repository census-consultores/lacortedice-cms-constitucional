import type { Core } from '@strapi/strapi';

/**
 * Settings runtime del módulo analytics-ingest.
 *
 * Por qué existe este servicio:
 * Hasta este sprint, los umbrales del motor (hot lead score, días de
 * riesgo, ventana de "nuevo", scroll para "lectura profunda") vivían
 * hardcoded en literales SQL dentro de `controllers/admin.ts`. La UI
 * `/admin/trazabilidad/configuracion` editaba la tabla `analytics.settings`,
 * pero ningún query las leía → cambiar un slider no afectaba al motor.
 *
 * Acá centralizamos lectura con cache corto (30s) para no martillar la
 * BD. La UI llama `invalidateSettingsCache()` después de un PUT exitoso
 * para que el cambio surta efecto inmediato.
 *
 * Fallback en cascada:
 *   1. Cache in-process (TTL 30s).
 *   2. Tabla analytics.settings.
 *   3. DEFAULT_SETTINGS (último recurso para que el sistema no rompa si
 *      la tabla se borró o no existe — instalación fresca, etc.).
 */

export const DEFAULT_SETTINGS = {
  hot_lead_threshold: 60,
  risk_days: 14,
  new_lead_window_days: 7,
  deep_read_scroll_pct: 75,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

const cache = new Map<SettingKey, { value: number; expiresAt: number }>();
const TTL_MS = 30_000;

const settings = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Devuelve el valor numérico de una setting. Usa cache + fallback al
   * default si la tabla o la fila no existen.
   */
  async get(key: SettingKey): Promise<number> {
    const c = cache.get(key);
    if (c && c.expiresAt > Date.now()) return c.value;

    let value = DEFAULT_SETTINGS[key];
    try {
      const res: any = await strapi.db.connection.raw(
        `SELECT value FROM analytics.settings WHERE key = ?`,
        [key]
      );
      const raw = res?.rows?.[0]?.value;
      if (raw !== null && raw !== undefined) {
        // `value` está guardado como jsonb; postgres devuelve number/string
        // según el contenido. Casteamos defensivamente a number.
        const n = Number(raw);
        if (Number.isFinite(n)) value = n as any;
      }
    } catch (e: any) {
      strapi.log.warn(
        `[analytics-ingest.settings] no se pudo leer '${key}', usando default ${DEFAULT_SETTINGS[key]}: ${e?.message ?? e}`
      );
    }

    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  },

  /**
   * Devuelve todas las settings en un solo objeto. Útil para los KPIs
   * banner del dashboard.
   */
  async getAll(): Promise<Record<SettingKey, number>> {
    const out = {} as Record<SettingKey, number>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
      out[key] = await this.get(key);
    }
    return out;
  },

  /**
   * Invalida el cache. Llamar después de un UPDATE exitoso en la tabla
   * settings para que el siguiente request lea el valor nuevo.
   */
  invalidate(): void {
    cache.clear();
  },
});

export default settings;
