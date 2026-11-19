import type { Core } from '@strapi/strapi';
import crypto from 'crypto';

/**
 * Sprint 10 — webhooks salientes.
 *
 * Tablas (creadas idempotentemente en el bootstrap del plugin):
 *   analytics.webhooks (id, name, url, events[], secret, active,
 *                       last_fired_at, last_status, failure_count, created_at, updated_at)
 *   analytics.webhook_deliveries (id, webhook_id, event, payload jsonb, status, error, created_at)
 *
 * Eventos built-in disparados por otros servicios del plugin:
 *   - rule_applied          (scoring.runAutoRules cuando una regla taguea >=1 usuario)
 *   - lead_became_client    (tag "cliente" aplicado)
 *   - new_hot_lead          (auto-rule prioridad_alta)
 *   - webhook_test          (desde el boton "Probar" del panel admin)
 */

type WebhookRow = {
  id: number;
  name: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  last_fired_at: string | null;
  last_status: string | null;
  failure_count: number;
  created_at?: string;
  updated_at?: string;
};

type WebhookInput = {
  name?: string;
  url?: string;
  events?: string[];
  secret?: string | null;
  active?: boolean;
};

function sign(payload: string, secret: string | null | undefined): string | null {
  if (!secret) return null;
  const h = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${h}`;
}

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeEvents(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80)
    .slice(0, 30);
}

const webhooks = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Dispara un evento contra todos los webhooks activos suscritos a `event`.
   * Nunca lanza excepcion hacia el caller: las fallas se loguean y registran
   * como delivery con status='error'.
   */
  async fire(event: string, payload: Record<string, any>) {
    const conn = strapi.db.connection;
    let hooks: WebhookRow[] = [];
    try {
      const res = await conn.raw(
        `SELECT id, name, url, events, secret, active
           FROM analytics.webhooks
          WHERE active = true AND ? = ANY(events)`,
        [event]
      );
      hooks = res.rows ?? [];
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooks.fire] select failed', e);
      return { delivered: 0, failed: 0 };
    }

    if (hooks.length === 0) return { delivered: 0, failed: 0 };

    const body = JSON.stringify({
      event,
      payload,
      delivered_at: new Date().toISOString(),
    });

    let delivered = 0;
    let failed = 0;

    for (const h of hooks) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'LaCorteDice-Webhook/1.0',
        'X-Lacorte-Event': event,
      };
      const signature = sign(body, h.secret);
      if (signature) headers['X-Lacorte-Signature'] = signature;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      let status: string = 'error';
      let statusCode: number | null = null;
      let errText: string | null = null;

      try {
        const r = await fetch(h.url, {
          method: 'POST',
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
        statusCode = r.status;
        status = r.ok ? 'ok' : 'http_error';
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          errText = `HTTP ${r.status}: ${t.slice(0, 300)}`;
        }
      } catch (e: any) {
        errText = String(e?.message ?? e).slice(0, 500);
        status = e?.name === 'AbortError' ? 'timeout' : 'error';
      } finally {
        clearTimeout(timer);
      }

      try {
        await conn.raw(
          `INSERT INTO analytics.webhook_deliveries
             (webhook_id, event, payload, status, error)
           VALUES (?, ?, ?::jsonb, ?, ?)`,
          [h.id, event, JSON.stringify(payload ?? {}), status, errText]
        );

        if (status === 'ok') {
          await conn.raw(
            `UPDATE analytics.webhooks
                SET last_fired_at = now(),
                    last_status = ?,
                    failure_count = 0,
                    updated_at = now()
              WHERE id = ?`,
            [statusCode ? `ok:${statusCode}` : 'ok', h.id]
          );
          delivered += 1;
        } else {
          await conn.raw(
            `UPDATE analytics.webhooks
                SET last_fired_at = now(),
                    last_status = ?,
                    failure_count = failure_count + 1,
                    updated_at = now()
              WHERE id = ?`,
            [statusCode ? `${status}:${statusCode}` : status, h.id]
          );
          failed += 1;
        }
      } catch (e) {
        strapi.log.error('[analytics-ingest.webhooks.fire] persist failed', e);
      }
    }

    return { delivered, failed };
  },

  async list(): Promise<WebhookRow[]> {
    const conn = strapi.db.connection;
    const res = await conn.raw(
      `SELECT id, name, url, events, secret, active,
              last_fired_at, last_status, failure_count, created_at, updated_at
         FROM analytics.webhooks
        ORDER BY id DESC`
    );
    return res.rows ?? [];
  },

  async get(id: number | string): Promise<WebhookRow | null> {
    const conn = strapi.db.connection;
    const res = await conn.raw(
      `SELECT id, name, url, events, secret, active,
              last_fired_at, last_status, failure_count, created_at, updated_at
         FROM analytics.webhooks
        WHERE id = ?`,
      [Number(id)]
    );
    return (res.rows ?? [])[0] ?? null;
  },

  async create(input: WebhookInput): Promise<WebhookRow> {
    const name = (input.name ?? '').toString().trim().slice(0, 120);
    const url = (input.url ?? '').toString().trim();
    const events = sanitizeEvents(input.events);
    const secret = input.secret ? String(input.secret).slice(0, 200) : null;
    const active = input.active !== false;

    if (!name) throw new Error('name requerido');
    if (!isHttpUrl(url)) throw new Error('url invalida (debe ser http/https)');
    if (events.length === 0) throw new Error('al menos un evento es requerido');

    const conn = strapi.db.connection;
    const res = await conn.raw(
      `INSERT INTO analytics.webhooks
         (name, url, events, secret, active)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, name, url, events, secret, active,
                 last_fired_at, last_status, failure_count, created_at, updated_at`,
      [name, url, events, secret, active]
    );
    return (res.rows ?? [])[0];
  },

  async update(id: number | string, input: WebhookInput): Promise<WebhookRow | null> {
    const conn = strapi.db.connection;
    const current = await this.get(id);
    if (!current) return null;

    const name =
      input.name !== undefined
        ? String(input.name).trim().slice(0, 120)
        : current.name;
    const url =
      input.url !== undefined ? String(input.url).trim() : current.url;
    const events =
      input.events !== undefined ? sanitizeEvents(input.events) : current.events;
    const secret =
      input.secret !== undefined
        ? input.secret
          ? String(input.secret).slice(0, 200)
          : null
        : current.secret;
    const active = input.active !== undefined ? !!input.active : current.active;

    if (!name) throw new Error('name requerido');
    if (!isHttpUrl(url)) throw new Error('url invalida');
    if (!events || events.length === 0)
      throw new Error('al menos un evento es requerido');

    const res = await conn.raw(
      `UPDATE analytics.webhooks
          SET name = ?, url = ?, events = ?, secret = ?, active = ?, updated_at = now()
        WHERE id = ?
        RETURNING id, name, url, events, secret, active,
                  last_fired_at, last_status, failure_count, created_at, updated_at`,
      [name, url, events, secret, active, Number(id)]
    );
    return (res.rows ?? [])[0] ?? null;
  },

  async remove(id: number | string): Promise<boolean> {
    const conn = strapi.db.connection;
    await conn.raw(`DELETE FROM analytics.webhook_deliveries WHERE webhook_id = ?`, [
      Number(id),
    ]);
    const res = await conn.raw(
      `DELETE FROM analytics.webhooks WHERE id = ? RETURNING id`,
      [Number(id)]
    );
    return (res.rows ?? []).length > 0;
  },

  async recentDeliveries(id: number | string, limit: number = 50) {
    const conn = strapi.db.connection;
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const res = await conn.raw(
      `SELECT id, webhook_id, event, payload, status, error, created_at
         FROM analytics.webhook_deliveries
        WHERE webhook_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [Number(id), n]
    );
    return res.rows ?? [];
  },
});

export default webhooks;
