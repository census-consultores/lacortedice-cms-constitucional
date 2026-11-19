import type { Core } from '@strapi/strapi';

/**
 * Service: digests (Sprint 11 — Titan-adapted)
 *
 * Sprint 11 — Email digests semanales (o diarios) al asignatario comercial.
 *
 * Flow:
 *   1) `buildDigest(adminId, periodDays)` → arma el payload personal + global.
 *   2) `renderEmailHTML(payload)` → devuelve { subject, html, text }.
 *   3) `sendDigest(adminId, opts)` → envía vía strapi.plugin('email').service('email').send(...)
 *      (el plugin email está configurado en config/plugins.ts con provider nodemailer
 *      apuntando a Titan Mail — mismas credenciales que ya usa mailer.ts de Sprint 12).
 *   4) `sendAllDue()` → cron hourly que filtra suscripciones por cadence/weekday/hour/tz.
 *
 * Gated por `DIGESTS_ENABLED=true`.
 */

type DigestAssignedRow = {
  user_id: string;
  email: string | null;
  username: string | null;
  lead_score: number | null;
  engagement_score: number | null;
  segment_primary: string | null;
  top_keywords: any;
};

type DigestPayload = {
  admin_id: number;
  admin_email: string;
  period_days: number;
  period_start: string;
  period_end: string;
  generated_at: string;
  new_hot_leads: DigestAssignedRow[];
  at_risk: DigestAssignedRow[];
  in_propuesta: DigestAssignedRow[];
  clients_closed: DigestAssignedRow[];
  top_keywords: Array<{ q: string; searches: number; users: number; growth_pct: number | null }>;
  zero_results: Array<{ q: string; searches: number; users: number }>;
  kpis: {
    searches: number;
    case_opens: number;
    unique_users: number;
    new_leads: number;
  };
};

const DEFAULT_TIMEZONE = 'America/Guayaquil';
const APP_URL = process.env.APP_URL || process.env.STRAPI_ADMIN_BACKEND_URL || 'https://admin.lacortedicetributaria.com';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://lacortedicetributaria.com';
// Titan-adapted: leer SMTP_FROM_EMAIL/NAME primero (configurados desde Sprint 12).
const DIGEST_FROM =
  process.env.SMTP_FROM_EMAIL ||
  process.env.DIGEST_FROM ||
  process.env.SMTP_USER ||
  'info@lacortedicetributaria.com';
const DIGEST_FROM_NAME =
  process.env.SMTP_FROM_NAME ||
  process.env.DIGEST_FROM_NAME ||
  'La Corte Dice Tributaria';

function esc(s: any): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayName(row: DigestAssignedRow): string {
  return (row.username || '').trim() || (row.email || '').trim() || `user:${row.user_id.slice(0, 8)}`;
}

function fmtDate(dt: Date): string {
  return dt.toISOString().replace('T', ' ').slice(0, 16);
}

function nowInZone(zone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    weekday: weekdayMap[parts.weekday] ?? 1,
    hour: parseInt(parts.hour || '0', 10),
    minute: parseInt(parts.minute || '0', 10),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const digests = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getSubscription(adminId: number) {
    const q = await strapi.db.connection.raw(
      `SELECT admin_id, cadence, weekday, hour, enabled, timezone, last_sent_at, created_at, updated_at
         FROM analytics.digest_subscriptions
        WHERE admin_id = ?`,
      [adminId]
    );
    return q.rows?.[0] || null;
  },

  async upsertSubscription(
    adminId: number,
    input: { cadence?: string; weekday?: number; hour?: number; enabled?: boolean; timezone?: string }
  ) {
    const allowedCadence = ['off', 'daily', 'weekly'];
    const cadence = allowedCadence.includes(input.cadence || '') ? input.cadence : 'weekly';
    const weekday = Math.min(6, Math.max(0, Number.isFinite(input.weekday as number) ? (input.weekday as number) : 1));
    const hour = Math.min(23, Math.max(0, Number.isFinite(input.hour as number) ? (input.hour as number) : 8));
    const enabled = input.enabled !== false && cadence !== 'off';
    const tz = input.timezone || DEFAULT_TIMEZONE;

    const q = await strapi.db.connection.raw(
      `
      INSERT INTO analytics.digest_subscriptions (admin_id, cadence, weekday, hour, enabled, timezone)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (admin_id) DO UPDATE SET
        cadence = EXCLUDED.cadence,
        weekday = EXCLUDED.weekday,
        hour = EXCLUDED.hour,
        enabled = EXCLUDED.enabled,
        timezone = EXCLUDED.timezone,
        updated_at = now()
      RETURNING admin_id, cadence, weekday, hour, enabled, timezone, last_sent_at, created_at, updated_at
      `,
      [adminId, cadence, weekday, hour, enabled, tz]
    );
    return q.rows?.[0] || null;
  },

  async recentSends(adminId: number, limit = 20) {
    const n = Math.min(100, Math.max(1, Number(limit) || 20));
    const q = await strapi.db.connection.raw(
      `SELECT id, admin_id, sent_at, period_start, period_end, email_status, email_error
         FROM analytics.digest_sends
        WHERE admin_id = ?
        ORDER BY sent_at DESC
        LIMIT ?`,
      [adminId, n]
    );
    return q.rows || [];
  },

  async buildDigest(adminId: number, periodDays = 7): Promise<DigestPayload> {
    const days = Math.min(30, Math.max(1, Number(periodDays) || 7));
    const adminRow = await strapi.db.connection.raw(
      `SELECT id, email FROM admin_users WHERE id = ?`,
      [adminId]
    );
    const adminEmail: string = adminRow.rows?.[0]?.email || '';
    if (!adminEmail) {
      throw new Error(`[digests] admin ${adminId} not found`);
    }

    const baseAssigned = `
      FROM analytics.user_assignments ua
      JOIN analytics.user_profiles_computed p ON p.user_id = ua.user_id
      LEFT JOIN up_users u ON u.id::text = ua.user_id::text
      WHERE ua.assignee_id = ?
    `;

    const newHot = await strapi.db.connection.raw(
      `SELECT ua.user_id, u.email, u.username, p.lead_score, p.engagement_score,
              p.segment_primary, p.top_keywords
         ${baseAssigned}
          AND p.lead_score >= 60
          AND (ua.assigned_at >= now() - (? || ' days')::interval
               OR p.first_seen_at >= now() - (? || ' days')::interval)
        ORDER BY p.lead_score DESC NULLS LAST
        LIMIT 15`,
      [adminId, days, days]
    );

    const settings = await strapi.db.connection.raw(
      `SELECT key, value FROM analytics.settings WHERE key IN ('risk_days','hot_lead_threshold')`
    );
    const sMap: Record<string, any> = {};
    for (const r of settings.rows || []) sMap[r.key] = r.value;
    const riskDays = Number(sMap['risk_days']) || 14;

    const atRisk = await strapi.db.connection.raw(
      `SELECT ua.user_id, u.email, u.username, p.lead_score, p.engagement_score,
              p.segment_primary, p.top_keywords
         ${baseAssigned}
          AND p.engagement_score >= 50
          AND p.days_since_last_seen >= ?
        ORDER BY p.engagement_score DESC NULLS LAST
        LIMIT 15`,
      [adminId, riskDays]
    );

    const inProp = await strapi.db.connection.raw(
      `SELECT DISTINCT ua.user_id, u.email, u.username, p.lead_score, p.engagement_score,
              p.segment_primary, p.top_keywords
         FROM analytics.user_assignments ua
         JOIN analytics.user_tags t ON t.user_id = ua.user_id
         JOIN analytics.user_profiles_computed p ON p.user_id = ua.user_id
         LEFT JOIN up_users u ON u.id::text = ua.user_id::text
        WHERE ua.assignee_id = ?
          AND t.tag IN ('en propuesta','negociando')
        ORDER BY p.lead_score DESC NULLS LAST
        LIMIT 15`,
      [adminId]
    );

    const closed = await strapi.db.connection.raw(
      `SELECT DISTINCT ua.user_id, u.email, u.username, p.lead_score, p.engagement_score,
              p.segment_primary, p.top_keywords
         FROM analytics.user_assignments ua
         JOIN analytics.user_tags t ON t.user_id = ua.user_id
         JOIN analytics.user_profiles_computed p ON p.user_id = ua.user_id
         LEFT JOIN up_users u ON u.id::text = ua.user_id::text
        WHERE ua.assignee_id = ?
          AND t.tag = 'cliente'
          AND t.created_at >= now() - (? || ' days')::interval
        ORDER BY t.created_at DESC
        LIMIT 15`,
      [adminId, days]
    );

    const topKw = await strapi.db.connection.raw(
      `SELECT q, COUNT(*)::int AS searches, COUNT(DISTINCT COALESCE(user_id::text, session_id::text))::int AS users
         FROM analytics.searches
        WHERE created_at >= now() - (? || ' days')::interval
          AND q IS NOT NULL AND char_length(q) > 0
        GROUP BY q
        ORDER BY searches DESC
        LIMIT 8`,
      [days]
    );

    const zero = await strapi.db.connection.raw(
      `SELECT q, COUNT(*)::int AS searches, COUNT(DISTINCT COALESCE(user_id::text, session_id::text))::int AS users
         FROM analytics.searches
        WHERE created_at >= now() - (? || ' days')::interval
          AND q IS NOT NULL AND char_length(q) > 0
          AND (result_count = 0 OR result_count IS NULL)
        GROUP BY q
       HAVING COUNT(*) >= 3
        ORDER BY searches DESC
        LIMIT 6`,
      [days]
    );

    const kpis = await strapi.db.connection.raw(
      `SELECT
         (SELECT COUNT(*)::int FROM analytics.searches WHERE created_at >= now() - (? || ' days')::interval) AS searches,
         (SELECT COUNT(*)::int FROM analytics.case_interactions WHERE started_at >= now() - (? || ' days')::interval) AS case_opens,
         (SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id::text))::int
            FROM analytics.events
           WHERE created_at >= now() - (? || ' days')::interval) AS unique_users,
         (SELECT COUNT(*)::int
            FROM analytics.user_profiles_computed
           WHERE first_seen_at >= now() - (? || ' days')::interval
             AND lead_score >= 60) AS new_leads
      `,
      [days, days, days, days]
    );

    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 3600 * 1000);

    const payload: DigestPayload = {
      admin_id: adminId,
      admin_email: adminEmail,
      period_days: days,
      period_start: fmtDate(periodStart),
      period_end: fmtDate(periodEnd),
      generated_at: fmtDate(new Date()),
      new_hot_leads: newHot.rows || [],
      at_risk: atRisk.rows || [],
      in_propuesta: inProp.rows || [],
      clients_closed: closed.rows || [],
      top_keywords: topKw.rows || [],
      zero_results: zero.rows || [],
      kpis: kpis.rows?.[0] || { searches: 0, case_opens: 0, unique_users: 0, new_leads: 0 },
    };
    return payload;
  },

  renderEmailHTML(payload: DigestPayload): { subject: string; html: string; text: string } {
    const subject = `La Corte Dice · Resumen ${payload.period_days === 7 ? 'semanal' : `${payload.period_days}d`} (${payload.clients_closed.length} cerrados · ${payload.new_hot_leads.length} hot · ${payload.at_risk.length} en riesgo)`;

    const renderAssignedList = (rows: DigestAssignedRow[], emptyMsg: string): string => {
      if (!rows.length) {
        return `<p style="margin:8px 0 0 0;color:#6b7280;font-size:13px;font-style:italic">${emptyMsg}</p>`;
      }
      return rows
        .map((r) => {
          const topKw = Array.isArray(r.top_keywords)
            ? r.top_keywords.slice(0, 3).map((k: any) => esc(k?.q || k)).filter(Boolean).join(' · ')
            : '';
          return `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #eef2f7;">
                <a href="${APP_URL}/admin/trazabilidad/usuarios/${encodeURIComponent(r.user_id)}"
                   style="color:#0f172a;text-decoration:none;font-weight:600;font-size:14px">
                  ${esc(displayName(r))}
                </a>
                ${topKw ? `<div style="color:#6b7280;font-size:12px;margin-top:2px">${topKw}</div>` : ''}
              </td>
              <td style="padding:10px 12px;text-align:right;border-bottom:1px solid #eef2f7;white-space:nowrap">
                <span style="display:inline-block;padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:99px;font-size:11px;font-weight:600">lead ${r.lead_score ?? '–'}</span>
                <span style="display:inline-block;padding:2px 8px;background:#dbeafe;color:#1e40af;border-radius:99px;font-size:11px;font-weight:600;margin-left:4px">eng ${r.engagement_score ?? '–'}</span>
              </td>
            </tr>`;
        })
        .join('');
    };

    const renderKeywordList = (rows: any[], emptyMsg: string): string => {
      if (!rows.length) {
        return `<p style="margin:8px 0 0 0;color:#6b7280;font-size:13px;font-style:italic">${emptyMsg}</p>`;
      }
      return rows
        .map(
          (r) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;font-size:13px">
              <a href="${WEBAPP_URL}/?q=${encodeURIComponent(r.q || '')}" style="color:#0f172a;text-decoration:none">${esc(r.q)}</a>
            </td>
            <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eef2f7;color:#6b7280;font-size:12px;white-space:nowrap">
              ${r.searches} búsq · ${r.users} usuarios
            </td>
          </tr>`
        )
        .join('');
    };

    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);max-width:92%">

        <tr><td style="padding:24px 28px;background:linear-gradient(135deg,#0b0b0b 0%,#1a1a1a 100%);color:#ffffff">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#d4af37;margin-bottom:6px">Resumen ${payload.period_days === 7 ? 'semanal' : `${payload.period_days} días`}</div>
          <div style="font-size:22px;font-weight:700;line-height:1.2">La Corte Dice Tributaria</div>
          <div style="font-size:13px;color:#cbd5e1;margin-top:6px">${esc(payload.period_start)} → ${esc(payload.period_end)}</div>
        </td></tr>

        <tr><td style="padding:20px 28px 8px 28px">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="text-align:center;padding:10px;background:#f8fafc;border-radius:8px;width:25%">
                <div style="font-size:22px;font-weight:700;color:#0f172a">${payload.kpis.searches}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Búsquedas</div>
              </td>
              <td style="width:8px"></td>
              <td style="text-align:center;padding:10px;background:#f8fafc;border-radius:8px;width:25%">
                <div style="font-size:22px;font-weight:700;color:#0f172a">${payload.kpis.case_opens}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Lecturas</div>
              </td>
              <td style="width:8px"></td>
              <td style="text-align:center;padding:10px;background:#f8fafc;border-radius:8px;width:25%">
                <div style="font-size:22px;font-weight:700;color:#0f172a">${payload.kpis.unique_users}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">Usuarios</div>
              </td>
              <td style="width:8px"></td>
              <td style="text-align:center;padding:10px;background:#fef3c7;border-radius:8px;width:25%">
                <div style="font-size:22px;font-weight:700;color:#92400e">${payload.kpis.new_leads}</div>
                <div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em">Nuevos leads</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:20px 28px 4px 28px">
          <div style="font-size:16px;font-weight:700;color:#065f46">Clientes cerrados (${payload.clients_closed.length})</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px">
            ${renderAssignedList(payload.clients_closed, 'Ningún cierre en este período.')}
          </table>
        </td></tr>

        <tr><td style="padding:16px 28px 4px 28px">
          <div style="font-size:16px;font-weight:700;color:#9a3412">Nuevos hot leads asignados (${payload.new_hot_leads.length})</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px">
            ${renderAssignedList(payload.new_hot_leads, 'Sin hot leads nuevos asignados a ti.')}
          </table>
        </td></tr>

        <tr><td style="padding:16px 28px 4px 28px">
          <div style="font-size:16px;font-weight:700;color:#1e40af">En propuesta / negociando (${payload.in_propuesta.length})</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px">
            ${renderAssignedList(payload.in_propuesta, 'Sin propuestas activas en tu pipeline.')}
          </table>
        </td></tr>

        <tr><td style="padding:16px 28px 4px 28px">
          <div style="font-size:16px;font-weight:700;color:#7c2d12">En riesgo de enfriarse (${payload.at_risk.length})</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px">
            ${renderAssignedList(payload.at_risk, 'Todos tus leads están activos.')}
          </table>
        </td></tr>

        <tr><td style="padding:24px 28px 4px 28px;border-top:2px dashed #e2e8f0;margin-top:12px">
          <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:12px">El mercado esta ${payload.period_days === 7 ? 'semana' : 'ventana'}</div>

          <div style="font-size:15px;font-weight:600;color:#0f172a">Top búsquedas</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:6px">
            ${renderKeywordList(payload.top_keywords, 'Sin tendencias fuertes.')}
          </table>
        </td></tr>

        <tr><td style="padding:16px 28px 24px 28px">
          <div style="font-size:15px;font-weight:600;color:#0f172a">Zero-results (brechas editoriales)</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:6px">
            ${renderKeywordList(payload.zero_results, 'Sin brechas detectadas.')}
          </table>
        </td></tr>

        <tr><td style="padding:8px 28px 28px 28px;text-align:center">
          <a href="${APP_URL}/admin/trazabilidad"
             style="display:inline-block;padding:12px 24px;background:#0b0b0b;color:#d4af37;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;border:1px solid #d4af37">
            Abrir dashboard →
          </a>
        </td></tr>

        <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #eef2f7;font-size:12px;color:#64748b">
          Recibiste este correo porque eres parte del equipo comercial de La Corte Dice Tributaria.
          <br>
          <a href="${APP_URL}/admin/trazabilidad/digests" style="color:#1e40af;text-decoration:none">Cambiar frecuencia o darse de baja</a>
          · Generado ${esc(payload.generated_at)} UTC
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const text = [
      `La Corte Dice Tributaria — Resumen ${payload.period_days === 7 ? 'semanal' : `${payload.period_days}d`}`,
      `Período: ${payload.period_start} → ${payload.period_end}`,
      ``,
      `KPIs (últimos ${payload.period_days}d):`,
      `  ${payload.kpis.searches} búsquedas · ${payload.kpis.case_opens} lecturas · ${payload.kpis.unique_users} usuarios · ${payload.kpis.new_leads} nuevos leads`,
      ``,
      `TUS ASIGNADOS`,
      `  Cerrados: ${payload.clients_closed.length}`,
      `  Hot nuevos: ${payload.new_hot_leads.length}`,
      `  En propuesta: ${payload.in_propuesta.length}`,
      `  En riesgo: ${payload.at_risk.length}`,
      ``,
      `Dashboard: ${APP_URL}/admin/trazabilidad`,
      `Suscripción: ${APP_URL}/admin/trazabilidad/digests`,
    ].join('\n');

    return { subject, html, text };
  },

  async sendDigest(
    adminId: number,
    opts: { periodDays?: number; dryRun?: boolean } = {}
  ) {
    const payload = await this.buildDigest(adminId, opts.periodDays ?? 7);
    const rendered = this.renderEmailHTML(payload);

    if (opts.dryRun) {
      return { ok: true, dryRun: true, subject: rendered.subject, payload };
    }

    let emailStatus = 'ok';
    let emailError: string | null = null;

    try {
      await strapi.plugin('email').service('email').send({
        to: payload.admin_email,
        from: `${DIGEST_FROM_NAME} <${DIGEST_FROM}>`,
        replyTo: DIGEST_FROM,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (e: any) {
      emailStatus = 'error';
      emailError = String(e?.message || e).slice(0, 500);
      strapi.log.error('[digests.sendDigest] email failed', e);
    }

    try {
      await strapi.db.connection.raw(
        `INSERT INTO analytics.digest_sends
           (admin_id, sent_at, period_start, period_end, payload, email_status, email_error)
         VALUES (?, now(), ?::timestamp, ?::timestamp, ?::jsonb, ?, ?)`,
        [
          adminId,
          payload.period_start,
          payload.period_end,
          JSON.stringify(payload),
          emailStatus,
          emailError,
        ]
      );
      if (emailStatus === 'ok') {
        await strapi.db.connection.raw(
          `UPDATE analytics.digest_subscriptions SET last_sent_at = now(), updated_at = now() WHERE admin_id = ?`,
          [adminId]
        );
      }
    } catch (e) {
      strapi.log.error('[digests.sendDigest] could not record send', e);
    }

    return { ok: emailStatus === 'ok', error: emailError, subject: rendered.subject };
  },

  async sendAllDue() {
    if (process.env.DIGESTS_ENABLED !== 'true') {
      strapi.log.info('[digests.sendAllDue] DIGESTS_ENABLED!=true, skipping');
      return { skipped: true };
    }

    const subs = await strapi.db.connection.raw(
      `SELECT s.admin_id, s.cadence, s.weekday, s.hour, s.timezone, s.last_sent_at,
              a.email
         FROM analytics.digest_subscriptions s
         JOIN admin_users a ON a.id = s.admin_id
        WHERE s.enabled = true AND s.cadence != 'off' AND a.is_active = true AND a.blocked = false`
    );

    let attempted = 0;
    let delivered = 0;

    for (const sub of subs.rows || []) {
      const tz = sub.timezone || DEFAULT_TIMEZONE;
      const now = nowInZone(tz);

      if (now.hour !== sub.hour) continue;
      if (sub.cadence === 'weekly' && now.weekday !== sub.weekday) continue;

      const lastSent = sub.last_sent_at ? new Date(sub.last_sent_at) : null;
      if (lastSent) {
        const lastYmd = nowInZone(tz);
        const fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(lastSent);
        if (fmt === lastYmd.ymd) continue;
      }

      const periodDays = sub.cadence === 'daily' ? 1 : 7;
      attempted++;
      try {
        const r = await this.sendDigest(sub.admin_id, { periodDays });
        if (r.ok) delivered++;
      } catch (e) {
        strapi.log.error(`[digests.sendAllDue] admin=${sub.admin_id}`, e);
      }
    }

    strapi.log.info(`[digests.sendAllDue] attempted=${attempted} delivered=${delivered}`);
    return { attempted, delivered };
  },
});

export default digests;
