/**
 * Controlador admin · Dashboard Ejecutivo + Panel 360° + Panel por Sentencia
 * Todas las rutas están protegidas por la policy isAdmin.
 */
const pickStrapi = (ctx: any) => ctx.state?.strapi ?? (global as any).strapi;
const rows = (res: any) => res?.rows ?? res ?? [];

// ----------- Helpers CSV -----------
const CSV_SEP = ',';
function csvCell(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(CSV_SEP) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function toCsv(headers: string[], data: any[], fields: string[]): string {
  const lines = [headers.map(csvCell).join(CSV_SEP)];
  for (const row of data) {
    lines.push(fields.map((f) => csvCell(row?.[f])).join(CSV_SEP));
  }
  // BOM UTF-8 para que Excel en Windows reconozca acentos sin configurar
  return '\uFEFF' + lines.join('\n');
}
function setCsvHeaders(ctx: any, filename: string) {
  ctx.set('Content-Type', 'text/csv; charset=utf-8');
  ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
  ctx.set('Cache-Control', 'no-store');
}
async function auditExport(strapi: any, ctx: any, action: string) {
  await strapi.db.connection
    .raw(
      `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, ip_address) VALUES (?, ?, ?, ?)`,
      [ctx.state?.user?.id ?? null, action, null, ctx.request?.ip ?? null]
    )
    .catch(() => { /* no romper el export si la audit falla */ });
}

/**
 * Sprint 8 — inserta un evento en analytics.lead_history.
 * No rompe el flujo principal si falla (ej. tabla aún no creada).
 */
async function logHistory(
  strapi: any,
  ctx: any,
  userId: number | string,
  event: string,
  payload: Record<string, any> = {}
) {
  try {
    await strapi.db.connection.raw(
      `INSERT INTO analytics.lead_history (user_id, event, payload, author_id, author_email)
       VALUES (?, ?, ?::jsonb, ?, ?)`,
      [
        Number(userId),
        event,
        JSON.stringify(payload),
        ctx.state?.user?.id ?? null,
        ctx.state?.user?.email ?? null,
      ]
    );
  } catch {
    /* silencio — la tabla puede no existir aún */
  }
}

const admin = {
  /**
   * GET /admin/kpis?days=N
   *
   * Resumen ejecutivo (8 tarjetas hero del Dashboard Ejecutivo).
   * Por defecto ventana de 30 días, aceptando 1..90 para filtro global.
   * Cuando days=30 usa la view precomputada `v_executive_kpis` para ser
   * consistente con lo que vieron antes del filtro; para otros rangos
   * calcula en vivo las mismas métricas sobre la ventana solicitada.
   */
  async kpis(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    // Settings dinámicas: el umbral de hot lead y la ventana "nueva" deben
    // poder calibrarse desde /admin/trazabilidad/configuracion sin redeploy.
    const settingsSvc: any = strapi.plugin('analytics-ingest').service('settings');
    const hotThreshold = await settingsSvc.get('hot_lead_threshold');
    const newLeadWin = await settingsSvc.get('new_lead_window_days');
    try {
      const r = await strapi.db.connection.raw(`
        WITH w AS (
          SELECT
            now() - interval '${days} days'     AS since,
            now() - interval '${days * 2} days' AS prev_since,
            now() - interval '${days} days'     AS prev_until
        )
        SELECT
          (SELECT COUNT(*) FROM public.up_users)                                                                             AS users_total,
          (SELECT COUNT(*) FROM public.up_users WHERE created_at >= now() - interval '${newLeadWin} days')                   AS users_new_7d,
          (SELECT COUNT(DISTINCT user_id) FROM analytics.sessions
             WHERE user_id IS NOT NULL AND started_at >= (SELECT since FROM w))                                              AS mau,
          (SELECT COUNT(DISTINCT user_id) FROM analytics.sessions
             WHERE user_id IS NOT NULL AND started_at >= now() - interval '${newLeadWin} days')                              AS wau,
          (SELECT COUNT(*) FROM analytics.searches WHERE created_at >= (SELECT since FROM w))                                AS searches_30d,
          (SELECT COUNT(*) FROM analytics.searches
             WHERE created_at >= (SELECT prev_since FROM w) AND created_at < (SELECT prev_until FROM w))                     AS searches_prev,
          (SELECT COUNT(*) FROM analytics.searches WHERE zero_result AND created_at >= (SELECT since FROM w))                AS zero_results_30d,
          (SELECT COUNT(*) FROM analytics.events   WHERE event_name = 'case_open'      AND event_timestamp >= (SELECT since FROM w)) AS case_opens_30d,
          (SELECT COUNT(*) FROM analytics.events   WHERE event_name = 'case_open'      AND event_timestamp >= (SELECT prev_since FROM w) AND event_timestamp < (SELECT prev_until FROM w)) AS case_opens_prev,
          (SELECT COUNT(*) FROM analytics.events   WHERE event_name = 'case_print'     AND event_timestamp >= (SELECT since FROM w)) AS prints_30d,
          (SELECT COUNT(*) FROM analytics.events   WHERE event_name = 'case_download'  AND event_timestamp >= (SELECT since FROM w)) AS downloads_30d,
          (SELECT COUNT(DISTINCT user_id) FROM analytics.sessions
             WHERE user_id IS NOT NULL
               AND started_at >= (SELECT prev_since FROM w)
               AND started_at < (SELECT prev_until FROM w))                                                                  AS mau_prev,
          (SELECT COUNT(*) FROM analytics.user_profiles_computed WHERE lead_score >= ${hotThreshold})                        AS hot_leads
      `);
      const row = rows(r)[0] || null;
      if (row) {
        // Cuando days=30 también completamos los deltas porque la view no los trae
        const pctChange = (cur: any, prev: any) => {
          const p = Number(prev) || 0;
          const c = Number(cur) || 0;
          if (p === 0) return null;
          return ((c - p) / p) * 100;
        };
        row.searches_delta_pct = pctChange(row.searches_30d, row.searches_prev);
        row.case_opens_delta_pct = pctChange(row.case_opens_30d, row.case_opens_prev);
        row.mau_delta_pct = pctChange(row.mau, row.mau_prev);
      }
      ctx.body = row;
    } catch (e) {
      strapi.log.error('[analytics-ingest.kpis]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/keywords?limit=50&days=N
   *
   * Si days=30 (default) usa la view `v_top_keywords_30d` por consistencia;
   * para cualquier otro valor construye el top en vivo sobre la ventana.
   * Los campos expuestos intentan igualar los de la view (keyword, searches,
   * growth_pct, unique_users, zero_rate, is_trending) aunque growth_pct
   * compara la ventana seleccionada contra el bloque previo de mismo tamaño.
   */
  async keywords(ctx: any) {
    const strapi = pickStrapi(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.limit || 50), 1), 200);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    try {
      if (days === 30) {
        const r = await strapi.db.connection.raw(
          `SELECT * FROM analytics.v_top_keywords_30d LIMIT ${limit}`
        );
        ctx.body = rows(r);
        return;
      }

      const r = await strapi.db.connection.raw(`
        WITH w AS (
          SELECT now() - interval '${days} days' AS since,
                 now() - interval '${days * 2} days' AS prev_since,
                 now() - interval '${days} days' AS prev_until
        ),
        current AS (
          SELECT query_normalized AS keyword,
                 COUNT(*) AS searches,
                 COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS unique_users,
                 SUM(CASE WHEN zero_result THEN 1 ELSE 0 END) AS zero_results
          FROM analytics.searches, w
          WHERE created_at >= w.since AND query_normalized IS NOT NULL AND query_normalized <> ''
          GROUP BY query_normalized
        ),
        prev AS (
          SELECT query_normalized AS keyword,
                 COUNT(*) AS searches_prev
          FROM analytics.searches, w
          WHERE created_at >= w.prev_since AND created_at < w.prev_until
            AND query_normalized IS NOT NULL
          GROUP BY query_normalized
        )
        SELECT
          c.keyword,
          c.searches::int                                                              AS searches_last_30d,
          c.unique_users::int                                                          AS unique_users,
          CASE WHEN c.searches > 0
               THEN (c.zero_results::numeric / c.searches) * 100 ELSE 0 END            AS zero_rate,
          CASE WHEN COALESCE(p.searches_prev, 0) = 0 THEN NULL
               ELSE ((c.searches - p.searches_prev)::numeric / p.searches_prev) * 100
          END                                                                          AS growth_pct_7d_vs_prev7d,
          (COALESCE(p.searches_prev, 0) > 0
             AND (c.searches - p.searches_prev)::numeric / p.searches_prev >= 0.5)     AS is_trending
        FROM current c
        LEFT JOIN prev p USING (keyword)
        ORDER BY c.searches DESC
        LIMIT ${limit}
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.keywords]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/zero-results?days=N
   */
  async zeroResults(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    try {
      if (days === 30) {
        const r = await strapi.db.connection.raw(
          `SELECT * FROM analytics.v_zero_result_opportunities LIMIT 100`
        );
        ctx.body = rows(r);
        return;
      }

      const r = await strapi.db.connection.raw(`
        SELECT
          query_normalized                                              AS query,
          COUNT(*)::int                                                 AS reps,
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS unique_users,
          MAX(created_at)                                               AS last_seen_at
        FROM analytics.searches
        WHERE zero_result
          AND created_at >= now() - interval '${days} days'
          AND query_normalized IS NOT NULL AND query_normalized <> ''
        GROUP BY query_normalized
        ORDER BY reps DESC
        LIMIT 100
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.zeroResults]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/top-cases?days=N
   */
  async topCases(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    try {
      // LEFT JOIN con public.causas para enriquecer el case_id (documentId
      // de 24 caracteres) con campos humanos: juicio (nº de causa) y actor.
      // Si el caso fue desvinculado o nunca existió en causas, los campos
      // vienen null y el frontend cae al propio case_id.
      if (days === 30) {
        const r = await strapi.db.connection.raw(`
          SELECT
            v.case_id,
            v.opens_last_30d,
            v.unique_users_last_30d,
            v.avg_dwell_sec,
            v.prints_total,
            v.downloads_total,
            c.juicio,
            c.actor
          FROM analytics.v_top_cases_30d v
          LEFT JOIN LATERAL (
            SELECT juicio, actor
              FROM public.causas
             WHERE document_id = v.case_id::text
             ORDER BY id DESC
             LIMIT 1
          ) c ON true
        `);
        ctx.body = rows(r);
        return;
      }

      const r = await strapi.db.connection.raw(`
        WITH agg AS (
          SELECT
            case_id,
            COUNT(*) FILTER (WHERE event_name = 'case_open')::int                          AS opens_last_30d,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'case_open'
                                            AND user_id IS NOT NULL)::int                  AS unique_users_last_30d,
            (SELECT prints_total FROM analytics.content_metrics cm WHERE cm.case_id = e.case_id)        AS prints_total,
            (SELECT downloads_total FROM analytics.content_metrics cm WHERE cm.case_id = e.case_id)     AS downloads_total
          FROM analytics.events e
          WHERE case_id IS NOT NULL
            AND event_timestamp >= now() - interval '${days} days'
            AND event_name IN ('case_open','case_print','case_download')
          GROUP BY case_id
        )
        SELECT agg.*, c.juicio, c.actor
        FROM agg
        LEFT JOIN LATERAL (
          SELECT juicio, actor
            FROM public.causas
           WHERE document_id = agg.case_id::text
           ORDER BY id DESC
           LIMIT 1
        ) c ON true
        ORDER BY opens_last_30d DESC, unique_users_last_30d DESC
        LIMIT 25
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.topCases]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/hot-leads?days=N
   *
   * Cuando days=30 usa la view precomputada. Para otros rangos filtra el
   * mismo set por actividad en la ventana (last_seen_at >= since).
   * Audita el acceso en analytics.admin_audit.
   */
  async hotLeads(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    try {
      const r = await (days === 30
        ? strapi.db.connection.raw(`SELECT * FROM analytics.v_hot_leads LIMIT 200`)
        : strapi.db.connection.raw(`
            SELECT hl.*
            FROM analytics.v_hot_leads hl
            JOIN analytics.user_profiles_computed upc ON upc.user_id = hl.user_id
            WHERE upc.last_seen_at >= now() - interval '${days} days'
            ORDER BY hl.lead_score DESC
            LIMIT 200
          `));
      ctx.body = rows(r);

      // Audit
      await strapi.db.connection
        .raw(
          `INSERT INTO analytics.admin_audit
             (admin_user_id, action, target_type, ip_address)
           VALUES (?, ?, ?, ?)`,
          [
            ctx.state?.user?.id ?? null,
            'view_hot_leads',
            null,
            ctx.request?.ip ?? null,
          ]
        )
        .catch(() => { /* no romper si la audit falla */ });
    } catch (e) {
      strapi.log.error('[analytics-ingest.hotLeads]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/funnel
   * Embudo búsqueda → preview → apertura → lectura profunda → impresión/descarga → contacto.
   */
  async funnel(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    try {
      const r = await strapi.db.connection.raw(`
        WITH w AS (SELECT now() - interval '${days} days' AS since)
        SELECT
          (SELECT COUNT(*) FROM analytics.searches     WHERE created_at >= (SELECT since FROM w))                           AS busquedas,
          (SELECT COUNT(*) FROM analytics.events       WHERE event_name = 'case_preview' AND event_timestamp >= (SELECT since FROM w))  AS previews,
          (SELECT COUNT(*) FROM analytics.events       WHERE event_name = 'case_open'    AND event_timestamp >= (SELECT since FROM w))  AS aperturas,
          (SELECT COUNT(*) FROM analytics.events       WHERE event_name = 'case_scroll_milestone' AND (payload->>'milestone_pct')::int >= 75 AND event_timestamp >= (SELECT since FROM w)) AS lectura_profunda,
          (SELECT COUNT(*) FROM analytics.events       WHERE event_name IN ('case_print','case_download') AND event_timestamp >= (SELECT since FROM w)) AS imp_dl,
          (SELECT COUNT(*) FROM analytics.events       WHERE event_name IN ('contact_firm_click','lead_form_submitted') AND event_timestamp >= (SELECT since FROM w)) AS contactos
      `);
      ctx.body = rows(r)[0] || null;
    } catch (e) {
      strapi.log.error('[analytics-ingest.funnel]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/embudo-entrada?days=30
   *
   * El embudo de ANTES de la cuenta: ingresar, crear cuenta y recuperar la
   * contraseña. Responde tres preguntas que el panel no sabía contestar:
   * cuánta gente llega a cada pantalla, cuánta sale por el otro lado, y —lo
   * que importa para arreglarlo— por qué se cae la que se cae.
   *
   * La unidad es PERSONAS DISTINTAS, no eventos: quien reintenta cinco veces
   * es una persona atascada, no cinco intentos sanos. Los motivos de fallo y
   * los campos que faltan sí se cuentan por veces, porque ahí lo que se
   * busca es la frecuencia del problema.
   *
   * El último escalón del registro se lee de `up_users`, no de un evento: una
   * cuenta creada es una fila en la tabla, y contarla ahí no depende de que
   * el navegador alcanzara a mandar el aviso antes de navegar.
   */
  async embudoEntrada(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 365);
    const desde = `now() - interval '${days} days'`;
    // Persona distinta: la cuenta si hay sesión, el id anónimo si todavía no.
    const QUIEN = `COALESCE(user_id::text, anonymous_id)`;

    try {
      // ── Escalones, en personas distintas ────────────────────────────
      const escalones = await strapi.db.connection.raw(`
        WITH e AS (
          SELECT event_name, payload, ${QUIEN} AS quien
            FROM analytics.events
           WHERE event_timestamp >= ${desde}
        ),
        v AS (
          SELECT COALESCE(NULLIF(payload->>'path', ''), '/') AS ruta, quien
            FROM e WHERE event_name = 'page_view'
        )
        SELECT
          (SELECT COUNT(DISTINCT quien) FROM v WHERE ruta LIKE '/login%')          AS login_pantalla,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'auth_login_intento')   AS login_intento,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'auth_login_ok')        AS login_ok,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'auth_login_fallo')     AS login_fallo,

          (SELECT COUNT(DISTINCT quien) FROM v WHERE ruta LIKE '/registro%')       AS reg_pantalla,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'registro_paso1_enviado')  AS reg_paso1,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'registro_codigo_ok')      AS reg_correo_ok,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'registro_codigo_fallo')   AS reg_correo_fallo,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'registro_intento')        AS reg_envio,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'registro_incompleto')     AS reg_incompleto,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'registro_creado')         AS reg_creado,

          (SELECT COUNT(DISTINCT quien) FROM v WHERE ruta LIKE '/recuperar%')      AS rec_pantalla,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'recuperar_solicitado')    AS rec_solicitado,
          (SELECT COUNT(DISTINCT quien) FROM e WHERE event_name = 'recuperar_completado')    AS rec_completado,

          (SELECT COUNT(*) FROM public.up_users WHERE created_at >= ${desde})      AS cuentas_reales
      `);

      // ── Ingreso: por vía y por motivo de fallo ──────────────────────
      const loginPorMetodo = await strapi.db.connection.raw(`
        SELECT
          COALESCE(NULLIF(payload->>'metodo', ''), 'correo')                           AS metodo,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'auth_login_intento')    AS intentos,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'auth_login_ok')         AS ok,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'auth_login_fallo')      AS fallos
        FROM analytics.events
        WHERE event_timestamp >= ${desde}
          AND event_name IN ('auth_login_intento', 'auth_login_ok', 'auth_login_fallo')
        GROUP BY 1
        ORDER BY intentos DESC
      `);

      const loginMotivos = await strapi.db.connection.raw(`
        SELECT
          COALESCE(NULLIF(payload->>'motivo', ''), 'otro')  AS motivo,
          COUNT(*)                                          AS veces,
          COUNT(DISTINCT ${QUIEN})                          AS personas
        FROM analytics.events
        WHERE event_name = 'auth_login_fallo'
          AND event_timestamp >= ${desde}
        GROUP BY 1
        ORDER BY veces DESC
      `);

      // ── Registro: qué campo deja a la gente en la puerta ────────────
      // `campos` viaja como lista de NOMBRES de campo. Nunca lo escrito.
      const camposQueFaltan = await strapi.db.connection.raw(`
        SELECT
          campo,
          COUNT(*)                 AS veces,
          COUNT(DISTINCT quien)    AS personas
        FROM (
          SELECT
            jsonb_array_elements_text(payload->'campos')  AS campo,
            ${QUIEN}                                      AS quien
          FROM analytics.events
          WHERE event_name = 'registro_incompleto'
            AND event_timestamp >= ${desde}
            AND jsonb_typeof(payload->'campos') = 'array'
        ) x
        GROUP BY 1
        ORDER BY veces DESC
        LIMIT 20
      `);

      // ── Registro: con qué cuenta lo intentan ────────────────────────
      const registroPorVia = await strapi.db.connection.raw(`
        SELECT
          COALESCE(NULLIF(payload->>'social', ''), 'correo')                            AS via,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'registro_intento')       AS envios,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'registro_incompleto')    AS incompletos,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'registro_creado')        AS creados
        FROM analytics.events
        WHERE event_timestamp >= ${desde}
          AND event_name IN ('registro_intento', 'registro_incompleto', 'registro_creado')
        GROUP BY 1
        ORDER BY envios DESC
      `);

      // ── Curva diaria de los tres finales ────────────────────────────
      const porDia = await strapi.db.connection.raw(`
        SELECT
          to_char(date_trunc('day', event_timestamp), 'YYYY-MM-DD')                     AS dia,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'auth_login_ok')          AS ingresos,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'auth_login_fallo')       AS fallos,
          COUNT(DISTINCT ${QUIEN}) FILTER (WHERE event_name = 'registro_incompleto')    AS abandonos
        FROM analytics.events
        WHERE event_timestamp >= now() - interval '${Math.min(days, 90)} days'
          AND event_name IN ('auth_login_ok', 'auth_login_fallo', 'registro_incompleto')
        GROUP BY 1
        ORDER BY 1
      `);

      // ── Clics al botón de descarga, por campaña y por tienda ────────
      // Los deja el puente /ir/... de la web. Sirve para leer el correo de
      // lanzamiento sin depender de que Apple o Google reporten la campaña.
      const clicsTienda = await strapi.db.connection.raw(`
        SELECT
          COALESCE(NULLIF(payload->>'campana', ''), 'directo')  AS campana,
          COALESCE(NULLIF(payload->>'destino', ''), 'app-store') AS destino,
          COUNT(*)                                              AS clics,
          COUNT(DISTINCT ${QUIEN})                              AS personas,
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS con_cuenta
        FROM analytics.events
        WHERE event_name = 'store_click'
          AND event_timestamp >= ${desde}
        GROUP BY 1, 2
        ORDER BY clics DESC
        LIMIT 20
      `);

      // De quienes hicieron clic teniendo cuenta, cuántos ya tienen la app.
      // Es la respuesta directa a «¿el correo trajo instalaciones?».
      const instalaronTrasClic = await strapi.db.connection.raw(`
        SELECT
          COUNT(*)                                                        AS con_cuenta,
          COUNT(*) FILTER (WHERE u.app_instalada IS NOT NULL)             AS ya_con_app
        FROM (
          SELECT DISTINCT user_id
            FROM analytics.events
           WHERE event_name = 'store_click'
             AND user_id IS NOT NULL
             AND event_timestamp >= ${desde}
        ) c
        -- Comparado como texto a propósito: el resto del panel asume que
        -- analytics.user_id es entero, pero el esquema original lo declaraba
        -- UUID. Así el cruce funciona sea cual sea el tipo desplegado.
        JOIN public.up_users u ON u.id::text = c.user_id::text
      `);

      ctx.body = {
        days,
        escalones: rows(escalones)[0] ?? {},
        loginPorMetodo: rows(loginPorMetodo),
        loginMotivos: rows(loginMotivos),
        camposQueFaltan: rows(camposQueFaltan),
        registroPorVia: rows(registroPorVia),
        clicsTienda: rows(clicsTienda),
        instalaronTrasClic: rows(instalaronTrasClic)[0] ?? {},
        porDia: rows(porDia),
      };
    } catch (e) {
      strapi.log.error('[analytics-ingest.embudoEntrada]', e);
      ctx.status = 500;
      ctx.body = { error: 'No se pudo calcular el embudo de entrada' };
    }
  },

  /**
   * GET /admin/users/search?q=maria&limit=20
   *
   * Búsqueda case-insensitive en up_users (email, username, profession).
   * Adjunta lead_score, engagement_score, last_seen_at y churn_risk del
   * perfil computado, para que el resultado ya se pueda priorizar
   * comercialmente sin una segunda consulta.
   */
  async searchUsers(ctx: any) {
    const strapi = pickStrapi(ctx);
    const q = String(ctx.query.q ?? '').trim();
    const limit = Math.min(Math.max(Number(ctx.query.limit || 10), 1), 50);
    if (!q || q.length < 2) {
      ctx.body = [];
      return;
    }
    try {
      const pattern = `%${q.toLowerCase()}%`;
      const r = await strapi.db.connection.raw(
        `
        SELECT
          u.id            AS user_id,
          u.email,
          u.username,
          u.profession,
          u.city,
          upc.lead_score,
          upc.engagement_score,
          upc.churn_risk,
          upc.last_seen_at,
          upc.days_since_last_seen
        FROM public.up_users u
        LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = u.id
        WHERE LOWER(u.email) LIKE ?
           OR LOWER(u.username) LIKE ?
           OR LOWER(COALESCE(u.profession, '')) LIKE ?
        ORDER BY COALESCE(upc.lead_score, 0) DESC, u.id DESC
        LIMIT ${limit}
        `,
        [pattern, pattern, pattern]
      );
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.searchUsers]', e);
      ctx.status = 500;
      ctx.body = { error: 'Search failed' };
    }
  },

  /**
   * GET /admin/users/:id/profile360
   */
  async userProfile(ctx: any) {
    const strapi = pickStrapi(ctx);
    const { id } = ctx.params;
    try {
      const r = await strapi
        .plugin('analytics-ingest')
        .service('profile')
        .getUser360(id);
      // El servicio devuelve null si el user NO existe en up_users.
      // Distinguimos 404 (no existe) de la respuesta normal — el shape
      // de respuesta normal trae `has_analytics: false` cuando el user
      // existe pero el cron todavía no calculó su perfil analytics.
      if (r === null) {
        ctx.status = 404;
        ctx.body = { error: 'user_not_found' };
        return;
      }
      ctx.body = r;

      await strapi.db.connection
        .raw(
          `INSERT INTO analytics.admin_audit
             (admin_user_id, action, target_type, target_id, ip_address)
           VALUES (?, ?, ?, ?, ?)`,
          [ctx.state?.user?.id ?? null, 'view_user_profile', 'user', id, ctx.request?.ip ?? null]
        )
        .catch(() => { });
    } catch (e) {
      strapi.log.error('[analytics-ingest.userProfile]', e);
      ctx.status = 500;
      ctx.body = { error: 'Internal error' };
    }
  },

  /**
   * GET /admin/cases/:id/detail
   */
  async caseDetail(ctx: any) {
    const strapi = pickStrapi(ctx);
    const { id } = ctx.params;
    try {
      const r = await strapi
        .plugin('analytics-ingest')
        .service('profile')
        .getCaseDetail(id);
      ctx.body = r;
    } catch (e) {
      strapi.log.error('[analytics-ingest.caseDetail]', e);
      ctx.status = 500;
      ctx.body = { error: 'Internal error' };
    }
  },

  /**
   * GET /admin/insights
   *
   * Ejecuta un conjunto de reglas simples sobre los datos recientes y
   * devuelve hasta 6 tarjetas accionables. Cada tarjeta tiene:
   *   { kind, severity, title, description, count, target_url }
   *
   * severity: 'high' (requiere acción comercial inmediata) |
   *           'medium' (vale la pena mirar hoy) |
   *           'low' (informativo).
   *
   * Reglas actuales:
   *   1. hot-lead-untagged   → leads lead_score≥60 sin ningún tag CRM
   *   2. deep-read-untagged  → usuarios con case scroll ≥75% en 7d y sin tag
   *   3. trending-keyword    → keyword con growth_pct_7d_vs_prev7d ≥ 100%
   *   4. zero-result-spike   → keyword zero-result con ≥5 búsquedas en 7d de ≥3 usuarios distintos
   *   5. churn-at-risk       → usuarios con engagement≥50 y days_since_last_seen≥14
   *   6. new-hot-leads       → leads que cruzaron a score≥60 en los últimos 7d
   */
  async insights(ctx: any) {
    const strapi = pickStrapi(ctx);
    const cards: any[] = [];
    const q = async (sql: string) => rows(await strapi.db.connection.raw(sql));
    // Settings dinámicas — los umbrales de las insights se calibran desde
    // /admin/trazabilidad/configuracion.
    const settingsSvc: any = strapi.plugin('analytics-ingest').service('settings');
    const RISK = await settingsSvc.get('risk_days');
    const NEW_WIN = await settingsSvc.get('new_lead_window_days');

    try {
      // 1. hot leads sin tagear
      const hotUntagged = (
        await q(`
          SELECT COUNT(*)::int AS n
            FROM analytics.v_hot_leads hl
           WHERE NOT EXISTS (
             SELECT 1 FROM analytics.user_tags ut WHERE ut.user_id = hl.user_id
           )
        `)
      )[0]?.n ?? 0;
      if (hotUntagged > 0) {
        cards.push({
          kind: 'hot-lead-untagged',
          severity: hotUntagged >= 5 ? 'high' : 'medium',
          title: `${hotUntagged} lead${hotUntagged === 1 ? '' : 's'} caliente${hotUntagged === 1 ? '' : 's'} sin contactar`,
          description:
            'Tienen lead_score ≥ 60 pero ningún miembro del equipo los ha taggeado todavía. Este es el segmento más accionable ahora mismo.',
          count: hotUntagged,
          target_url: '/admin/trazabilidad/pipeline?leadFilter=untagged',
        });
      }

      // 2. deep readers sin tagear (scroll≥75 en 7d)
      const deepUntagged = (
        await q(`
          WITH deep AS (
            SELECT DISTINCT user_id
              FROM analytics.events
             WHERE event_name = 'case_scroll_milestone'
               AND (payload->>'milestone_pct')::int >= 75
               AND event_timestamp >= now() - interval '7 days'
               AND user_id IS NOT NULL
          )
          SELECT COUNT(*)::int AS n
            FROM deep d
           WHERE NOT EXISTS (
             SELECT 1 FROM analytics.user_tags ut WHERE ut.user_id = d.user_id
           )
        `)
      )[0]?.n ?? 0;
      if (deepUntagged > 0) {
        cards.push({
          kind: 'deep-read-untagged',
          severity: 'medium',
          title: `${deepUntagged} lector${deepUntagged === 1 ? '' : 'es'} profundo${deepUntagged === 1 ? '' : 's'} sin tagear`,
          description:
            'Leyeron ≥75% de una sentencia en los últimos 7 días. Señal fuerte de intención profesional.',
          count: deepUntagged,
          target_url: '/admin/trazabilidad/pipeline?leadFilter=untagged',
        });
      }

      // 3. keyword en explosión
      const trending = await q(`
        SELECT keyword, searches_last_30d, growth_pct_7d_vs_prev7d
          FROM analytics.v_top_keywords_30d
         WHERE growth_pct_7d_vs_prev7d >= 100 AND searches_last_30d >= 10
         ORDER BY growth_pct_7d_vs_prev7d DESC
         LIMIT 1
      `);
      if (trending.length) {
        const k = trending[0];
        cards.push({
          kind: 'trending-keyword',
          severity: 'medium',
          title: `« ${k.keyword} » está en explosión`,
          description: `Creció ${Math.round(Number(k.growth_pct_7d_vs_prev7d))}% en los últimos 7 días vs semana previa. Oportunidad editorial o comercial.`,
          count: Number(k.searches_last_30d),
          target_url: `/admin/trazabilidad/zero-results?highlight=${encodeURIComponent(k.keyword)}`,
        });
      }

      // 4. zero-result con spike
      const spikeZero = await q(`
        SELECT query_normalized AS keyword,
               COUNT(*)::int AS reps,
               COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS unique_users
          FROM analytics.searches
         WHERE zero_result
           AND created_at >= now() - interval '7 days'
           AND query_normalized IS NOT NULL AND query_normalized <> ''
         GROUP BY query_normalized
        HAVING COUNT(*) >= 5 AND COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) >= 3
         ORDER BY reps DESC
         LIMIT 1
      `);
      if (spikeZero.length) {
        const z = spikeZero[0];
        cards.push({
          kind: 'zero-result-spike',
          severity: 'medium',
          title: `« ${z.keyword} » no tiene resultados y ${z.unique_users} personas la buscaron`,
          description: `${z.reps} búsquedas sin resultados en los últimos 7 días. Demanda editorial clara.`,
          count: z.reps,
          target_url: `/admin/trazabilidad/zero-results/${encodeURIComponent(z.keyword)}`,
        });
      }

      // 5. usuarios valiosos en riesgo de churn
      const churn = (
        await q(`
          SELECT COUNT(*)::int AS n
            FROM analytics.user_profiles_computed
           WHERE engagement_score >= 50
             AND days_since_last_seen >= ${RISK}
        `)
      )[0]?.n ?? 0;
      if (churn > 0) {
        cards.push({
          kind: 'churn-at-risk',
          severity: churn >= 5 ? 'high' : 'low',
          title: `${churn} lector${churn === 1 ? '' : 'es'} valioso${churn === 1 ? '' : 's'} en riesgo`,
          description:
            `Engagement ≥ 50 pero no han vuelto en ≥ ${RISK} días. Considera reactivarlos con contenido o contacto directo.`,
          count: churn,
          target_url: '/admin/trazabilidad/pipeline?leadFilter=at-risk',
        });
      }

      // 6. nuevos hot leads (lead ≥hot_lead_threshold con primera vez en
      // <= new_lead_window_days)
      const HOT = await settingsSvc.get('hot_lead_threshold');
      const newHot = (
        await q(`
          SELECT COUNT(*)::int AS n
            FROM analytics.user_profiles_computed
           WHERE lead_score >= ${HOT}
             AND first_seen_at >= now() - interval '${NEW_WIN} days'
        `)
      )[0]?.n ?? 0;
      if (newHot > 0) {
        cards.push({
          kind: 'new-hot-leads',
          severity: 'high',
          title: `🔥 ${newHot} lead${newHot === 1 ? '' : 's'} caliente${newHot === 1 ? '' : 's'} nuevo${newHot === 1 ? '' : 's'} esta semana`,
          description: `Usuarios que llegaron hace ≤${NEW_WIN} días y ya alcanzaron score ≥ ${HOT}.`,
          count: newHot,
          target_url: '/admin/trazabilidad/pipeline?leadFilter=untagged&new=1',
        });
      }

      // Orden: high > medium > low, y dentro de cada nivel por count desc
      const priority: Record<string, number> = { high: 3, medium: 2, low: 1 };
      cards.sort(
        (a, b) =>
          (priority[b.severity] ?? 0) - (priority[a.severity] ?? 0) ||
          Number(b.count ?? 0) - Number(a.count ?? 0)
      );

      ctx.body = cards.slice(0, 6);
    } catch (e) {
      strapi.log.error('[analytics-ingest.insights]', e);
      ctx.status = 500;
      ctx.body = { error: 'Insights engine not ready' };
    }
  },

  /**
   * GET /admin/zero-results/detail?q=<keyword>&days=N
   *
   * Lista cronológica de todas las búsquedas zero-result para esa keyword
   * (query_normalized), junto con el usuario que la realizó. Pensado para
   * que el editorial priorice contenido: "18 búsquedas sin resultado de
   * 14 personas distintas en 30 días → hay que publicar sobre esto".
   */
  async zeroResultDetail(ctx: any) {
    const strapi = pickStrapi(ctx);
    const q = String(ctx.query.q ?? '').trim().toLowerCase();
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 90);
    if (!q) {
      ctx.body = { summary: null, rows: [] };
      return;
    }
    try {
      const summaryRes = await strapi.db.connection.raw(
        `
        SELECT
          COUNT(*)::int                                                 AS total_searches,
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS unique_users,
          MIN(created_at)                                               AS first_seen_at,
          MAX(created_at)                                               AS last_seen_at
        FROM analytics.searches
        WHERE zero_result
          AND LOWER(query_normalized) = ?
          AND created_at >= now() - interval '${days} days'
        `,
        [q]
      );
      const summary = rows(summaryRes)[0] || null;

      const rowsRes = await strapi.db.connection.raw(
        `
        SELECT
          s.search_id,
          s.created_at,
          s.query_raw,
          s.filters,
          s.user_id,
          u.email,
          u.username,
          u.profession,
          upc.lead_score,
          upc.engagement_score
        FROM analytics.searches s
        LEFT JOIN public.up_users u                     ON u.id = s.user_id
        LEFT JOIN analytics.user_profiles_computed upc  ON upc.user_id = s.user_id
        WHERE s.zero_result
          AND LOWER(s.query_normalized) = ?
          AND s.created_at >= now() - interval '${days} days'
        ORDER BY s.created_at DESC
        LIMIT 200
        `,
        [q]
      );

      ctx.body = {
        query: q,
        days,
        summary,
        rows: rows(rowsRes),
      };
    } catch (e) {
      strapi.log.error('[analytics-ingest.zeroResultDetail]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/daily-pulse?days=14
   * Serie diaria de eventos + usuarios únicos para sparkline/bars de Banda 4.
   *
   * Nota: se interpola `days` como literal en el SQL porque knex no soporta
   * bindings (`?`) dentro de expresiones aritméticas como `(? - 1) * interval`.
   * El valor está saneado con Math.min/Max antes de interpolar (SQL-injection-safe).
   */
  async dailyPulse(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 14), 1), 90);
    try {
      // session_heartbeat es ruido de telemetría (cada 30s mientras el tab
      // está abierto) — representa ~90% de los eventos y no tiene valor
      // analítico. Lo excluimos del conteo de "events" para que el pulso
      // diario refleje actividad real (page_view, searches, etc.).
      const r = await strapi.db.connection.raw(`
        WITH span AS (
          SELECT generate_series(
            (now()::date - (${days} - 1) * interval '1 day')::date,
            now()::date,
            interval '1 day'
          )::date AS d
        )
        SELECT
          span.d::text                                                          AS day,
          COALESCE((SELECT COUNT(*) FROM analytics.events
                    WHERE event_timestamp::date = span.d
                      AND event_name <> 'session_heartbeat'), 0)::int           AS events,
          COALESCE((SELECT COUNT(DISTINCT user_id) FROM analytics.events
                    WHERE event_timestamp::date = span.d
                      AND user_id IS NOT NULL
                      AND event_name <> 'session_heartbeat'), 0)::int           AS unique_users,
          COALESCE((SELECT COUNT(*) FROM analytics.searches
                    WHERE created_at::date = span.d), 0)::int                   AS searches,
          COALESCE((SELECT COUNT(*) FROM analytics.events
                    WHERE event_name = 'case_open'
                      AND event_timestamp::date = span.d), 0)::int              AS case_opens
        FROM span
        ORDER BY span.d
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.dailyPulse]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  /**
   * GET /admin/at-risk-users?limit=20
   *
   * Usuarios "en riesgo de churn": son lectores valiosos (engagement>20)
   * cuya última actividad está distante o cuyo `churn_risk` ya fue marcado
   * por el motor de scoring. Ordenado por mayor engagement (los más valiosos).
   *
   * Nota: el cálculo de churn_risk vive en analytics.refresh_user_profile().
   * Aquí solo lo exponemos.
   */
  async atRiskUsers(ctx: any) {
    const strapi = pickStrapi(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.limit || 20), 1), 100);
    const settingsSvc: any = strapi.plugin('analytics-ingest').service('settings');
    const RISK = await settingsSvc.get('risk_days');
    try {
      const r = await strapi.db.connection.raw(`
        SELECT
          upc.user_id,
          u.email,
          u.username,
          u.profession,
          upc.engagement_score,
          upc.lead_score,
          upc.churn_risk,
          upc.sessions_last_7d,
          upc.sessions_last_30d,
          upc.last_seen_at,
          upc.days_since_last_seen
        FROM analytics.user_profiles_computed upc
        LEFT JOIN public.up_users u ON u.id = upc.user_id
        WHERE upc.engagement_score > 20
          AND (
            upc.churn_risk IN ('high', 'medium')
            OR upc.days_since_last_seen >= ${RISK}
          )
        ORDER BY upc.engagement_score DESC, upc.days_since_last_seen DESC
        LIMIT ${limit}
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.atRiskUsers]', e);
      ctx.status = 500;
      ctx.body = { error: 'Analytics schema not ready' };
    }
  },

  // =====================================================================
  // CRM LITE — notas + tags por usuario (Sprint 3)
  // Cerrar el ciclo comercial: quién ya contactó, cuál fue el resultado.
  // =====================================================================

  /**
   * GET /admin/users/:id/crm → { notes, tags }
   */
  async crmGet(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    if (!Number.isFinite(uid)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid user id' };
      return;
    }
    try {
      const notesRes = await strapi.db.connection.raw(
        `SELECT id, content, author_email, created_at
           FROM analytics.user_notes
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 200`,
        [uid]
      );
      const tagsRes = await strapi.db.connection.raw(
        `SELECT tag, author_id, created_at
           FROM analytics.user_tags
          WHERE user_id = ?
          ORDER BY created_at DESC`,
        [uid]
      );
      // Sprint 5: incluir assignment actual si existe
      let assignment = null;
      try {
        const ar = await strapi.db.connection.raw(
          `SELECT assignee_id, assignee_email, assigned_at
             FROM analytics.user_assignments
            WHERE user_id = ?`,
          [uid]
        );
        assignment = rows(ar)[0] ?? null;
      } catch { /* assignment table may not exist yet */ }

      ctx.body = { notes: rows(notesRes), tags: rows(tagsRes), assignment };
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmGet]', e);
      ctx.status = 500;
      ctx.body = { error: 'CRM tables not ready' };
    }
  },

  /**
   * POST /admin/users/:id/notes  { content }
   */
  async crmAddNote(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    const content = String(ctx.request.body?.content ?? '').trim();
    if (!Number.isFinite(uid) || !content) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid payload' };
      return;
    }
    if (content.length > 4000) {
      ctx.status = 400;
      ctx.body = { error: 'Note too long (max 4000)' };
      return;
    }
    try {
      const authorId = ctx.state?.user?.id ?? null;
      const authorEmail = ctx.state?.user?.email ?? null;
      const r = await strapi.db.connection.raw(
        `INSERT INTO analytics.user_notes (user_id, author_id, author_email, content)
         VALUES (?, ?, ?, ?)
         RETURNING id, content, author_email, created_at`,
        [uid, authorId, authorEmail, content]
      );
      ctx.body = rows(r)[0];
      await strapi.db.connection.raw(
        `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, target_id, ip_address)
         VALUES (?, 'crm_add_note', 'user', ?, ?)`,
        [authorId, String(uid), ctx.request?.ip ?? null]
      ).catch(() => { });
      await logHistory(strapi, ctx, uid, 'note_added', { preview: content.slice(0, 120) });
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmAddNote]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not save note' };
    }
  },

  /**
   * DELETE /admin/users/:id/notes/:noteId
   */
  async crmDeleteNote(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    const noteId = Number(ctx.params.noteId);
    if (!Number.isFinite(uid) || !Number.isFinite(noteId)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid ids' };
      return;
    }
    try {
      await strapi.db.connection.raw(
        `DELETE FROM analytics.user_notes WHERE id = ? AND user_id = ?`,
        [noteId, uid]
      );
      ctx.body = { ok: true };
      await strapi.db.connection.raw(
        `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, target_id, ip_address)
         VALUES (?, 'crm_delete_note', 'user', ?, ?)`,
        [ctx.state?.user?.id ?? null, String(uid), ctx.request?.ip ?? null]
      ).catch(() => { });
      await logHistory(strapi, ctx, uid, 'note_deleted', { note_id: noteId });
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmDeleteNote]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not delete note' };
    }
  },

  /**
   * POST /admin/users/:id/tags  { tag }
   * Normaliza el tag a minúsculas, sin espacios a los extremos.
   */
  async crmAddTag(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    const rawTag = String(ctx.request.body?.tag ?? '').trim().toLowerCase();
    if (!Number.isFinite(uid) || !rawTag) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid payload' };
      return;
    }
    if (rawTag.length > 50 || !/^[a-z0-9_\-\s]+$/i.test(rawTag)) {
      ctx.status = 400;
      ctx.body = { error: 'Tag debe ser 1-50 chars alfanuméricos' };
      return;
    }
    try {
      const authorId = ctx.state?.user?.id ?? null;
      await strapi.db.connection.raw(
        `INSERT INTO analytics.user_tags (user_id, tag, author_id)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, tag) DO NOTHING`,
        [uid, rawTag, authorId]
      );
      ctx.body = { ok: true, tag: rawTag };
      await logHistory(strapi, ctx, uid, 'tag_added', { tag: rawTag });
      // Sprint 10: dispara webhook si el tag corresponde a un hito comercial
      if (rawTag === 'cliente') {
        strapi.plugin('analytics-ingest').service('webhooks')
          .fire('lead_became_client', { user_id: uid, source: 'manual_tag' })
          .catch(() => { });
      }
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmAddTag]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not add tag' };
    }
  },

  /**
   * DELETE /admin/users/:id/tags/:tag
   */
  async crmDeleteTag(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    const tag = String(ctx.params.tag ?? '').trim().toLowerCase();
    if (!Number.isFinite(uid) || !tag) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid payload' };
      return;
    }
    try {
      await strapi.db.connection.raw(
        `DELETE FROM analytics.user_tags WHERE user_id = ? AND tag = ?`,
        [uid, tag]
      );
      ctx.body = { ok: true };
      await logHistory(strapi, ctx, uid, 'tag_removed', { tag });
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmDeleteTag]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not delete tag' };
    }
  },

  /**
   * GET /admin/crm/tags-summary → tags más usados + map user_id → tags[]
   * El dashboard lo consume para mostrar badges junto a los hot-leads.
   */
  /**
   * GET /admin/crm/pipeline → todos los usuarios con al menos un tag,
   * con sus scores y última actividad. Para la vista de pipeline comercial.
   */
  async crmPipeline(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(`
        WITH tagged AS (
          SELECT user_id, ARRAY_AGG(tag ORDER BY tag) AS tags
            FROM analytics.user_tags
           GROUP BY user_id
        )
        SELECT
          t.user_id,
          t.tags,
          u.email,
          u.username,
          u.profession,
          u.city,
          upc.lead_score,
          upc.engagement_score,
          upc.churn_risk,
          upc.last_seen_at,
          upc.days_since_last_seen,
          (SELECT COUNT(*) FROM analytics.user_notes WHERE user_id = t.user_id)::int AS notes_count
        FROM tagged t
        LEFT JOIN public.up_users u                    ON u.id = t.user_id
        LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = t.user_id
        ORDER BY COALESCE(upc.lead_score, 0) DESC, t.user_id DESC
        LIMIT 500
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmPipeline]', e);
      ctx.status = 500;
      ctx.body = { error: 'CRM tables not ready' };
    }
  },

  // =====================================================================
  // SPRINT 5 — gestión de equipo: asignación + funnel de ventas
  // =====================================================================

  /**
   * GET /admin/team/members → listado de miembros del equipo admin.
   *
   * Usamos los roles de strapi admin (table admin_users) porque es ahí
   * donde viven los usuarios que realmente operan el dashboard. Se
   * excluyen bloqueados.
   */
  async teamMembers(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(
        `SELECT id, firstname, lastname, email
           FROM public.admin_users
          WHERE is_active = true AND blocked = false
          ORDER BY firstname NULLS LAST, email`
      );
      ctx.body = rows(r);
    } catch (e) {
      // Fallback: si el schema de admin_users difiere, devolvemos solo los up_users marcados como admin-ish.
      strapi.log.warn('[analytics-ingest.teamMembers] falling back to up_users', e);
      try {
        const r2 = await strapi.db.connection.raw(
          `SELECT u.id, NULL::text AS firstname, NULL::text AS lastname, u.email
             FROM public.up_users u
            WHERE u.blocked = false
              AND u.confirmed = true
            ORDER BY u.email
            LIMIT 50`
        );
        ctx.body = rows(r2);
      } catch (e2) {
        strapi.log.error('[analytics-ingest.teamMembers]', e2);
        ctx.status = 500;
        ctx.body = { error: 'Team members not available' };
      }
    }
  },

  /**
   * PUT /admin/users/:id/assignment  { assignee_id }
   * Upsert: un lead solo puede estar asignado a una persona a la vez.
   */
  async assignmentSet(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    const assigneeId = Number(ctx.request.body?.assignee_id);
    if (!Number.isFinite(uid) || !Number.isFinite(assigneeId)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid ids' };
      return;
    }
    try {
      // Resolvemos el email del assignee (admin_users, con fallback a up_users)
      let assigneeEmail: string | null = null;
      try {
        const em = rows(await strapi.db.connection.raw(
          `SELECT email FROM public.admin_users WHERE id = ?`,
          [assigneeId]
        ))[0];
        assigneeEmail = em?.email ?? null;
      } catch { /* ignore */ }

      await strapi.db.connection.raw(
        `INSERT INTO analytics.user_assignments
           (user_id, assignee_id, assignee_email, assigned_by_id, assigned_at)
         VALUES (?, ?, ?, ?, now())
         ON CONFLICT (user_id) DO UPDATE SET
           assignee_id    = EXCLUDED.assignee_id,
           assignee_email = EXCLUDED.assignee_email,
           assigned_by_id = EXCLUDED.assigned_by_id,
           assigned_at    = now()`,
        [uid, assigneeId, assigneeEmail, ctx.state?.user?.id ?? null]
      );
      ctx.body = { ok: true, user_id: uid, assignee_id: assigneeId, assignee_email: assigneeEmail };
      await strapi.db.connection.raw(
        `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, target_id, ip_address)
         VALUES (?, 'assign_lead', 'user', ?, ?)`,
        [ctx.state?.user?.id ?? null, String(uid), ctx.request?.ip ?? null]
      ).catch(() => { });
      await logHistory(strapi, ctx, uid, 'assigned', {
        assignee_id: assigneeId,
        assignee_email: assigneeEmail,
      });
    } catch (e) {
      strapi.log.error('[analytics-ingest.assignmentSet]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not assign' };
    }
  },

  /**
   * DELETE /admin/users/:id/assignment
   */
  async assignmentClear(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    if (!Number.isFinite(uid)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid id' };
      return;
    }
    try {
      await strapi.db.connection.raw(
        `DELETE FROM analytics.user_assignments WHERE user_id = ?`,
        [uid]
      );
      ctx.body = { ok: true };
      await logHistory(strapi, ctx, uid, 'unassigned', {});
    } catch (e) {
      strapi.log.error('[analytics-ingest.assignmentClear]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not clear assignment' };
    }
  },

  /**
   * GET /admin/crm/assignments-summary
   * Devuelve { byUser } para pintar badges del asignado en el dashboard.
   */
  async assignmentsSummary(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(
        `SELECT user_id, assignee_id, assignee_email, assigned_at
           FROM analytics.user_assignments`
      );
      ctx.body = { byUser: rows(r) };
    } catch (e) {
      strapi.log.error('[analytics-ingest.assignmentsSummary]', e);
      ctx.status = 500;
      ctx.body = { byUser: [] };
    }
  },

  /**
   * GET /admin/crm/my-inbox
   * Vista personal del admin logueado. Devuelve 4 secciones:
   *   - new_leads: hot leads asignados sin tag "contactado"
   *   - in_progress: asignados con tag en propuesta / negociando
   *   - at_risk: asignados con days_since_last_seen >= 14
   *   - total: conteo total de mis asignados
   */
  async myInbox(ctx: any) {
    const strapi = pickStrapi(ctx);
    const me = Number(ctx.state?.user?.id ?? 0);
    if (!me) {
      ctx.body = { total: 0, new_leads: [], in_progress: [], at_risk: [] };
      return;
    }
    try {
      const all = rows(await strapi.db.connection.raw(
        `SELECT
           ua.user_id,
           u.email,
           u.username,
           u.profession,
           upc.lead_score,
           upc.engagement_score,
           upc.churn_risk,
           upc.last_seen_at,
           upc.days_since_last_seen,
           COALESCE((SELECT ARRAY_AGG(tag ORDER BY tag) FROM analytics.user_tags t WHERE t.user_id = ua.user_id), ARRAY[]::text[]) AS tags
         FROM analytics.user_assignments ua
         LEFT JOIN public.up_users u                    ON u.id = ua.user_id
         LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = ua.user_id
         WHERE ua.assignee_id = ?
         ORDER BY COALESCE(upc.lead_score, 0) DESC`,
        [me]
      ));

      const hasTag = (row: any, tag: string) => (row.tags ?? []).includes(tag);

      const new_leads = all.filter(
        (r: any) => Number(r.lead_score ?? 0) >= 60 && !hasTag(r, 'contactado') && !hasTag(r, 'cliente')
      );
      const in_progress = all.filter(
        (r: any) => hasTag(r, 'en propuesta') || hasTag(r, 'negociando')
      );
      const at_risk = all.filter(
        (r: any) => Number(r.days_since_last_seen ?? 0) >= 14 && !hasTag(r, 'cliente')
      );

      ctx.body = { total: all.length, new_leads, in_progress, at_risk };
    } catch (e) {
      strapi.log.error('[analytics-ingest.myInbox]', e);
      ctx.status = 500;
      ctx.body = { error: 'Inbox not ready' };
    }
  },

  /**
   * GET /admin/crm/sales-funnel
   * Funnel COMERCIAL (vs el funnel técnico de /admin/funnel). Convierte los
   * tags del CRM en etapas y calcula conversion rate entre etapas.
   *
   * Etapas:
   *   hot_leads   → todos los lead_score ≥ 60 (universo)
   *   contactado  → tienen tag "contactado"
   *   en_propuesta → tienen tag "en propuesta" o "negociando"
   *   cliente     → tienen tag "cliente"
   */
  async salesFunnel(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(`
        WITH hot AS (
          SELECT user_id FROM analytics.user_profiles_computed WHERE lead_score >= 60
        ),
        tagged AS (
          SELECT user_id, ARRAY_AGG(tag) AS tags
            FROM analytics.user_tags GROUP BY user_id
        )
        SELECT
          (SELECT COUNT(*) FROM hot)::int                                                     AS hot_leads,
          (SELECT COUNT(DISTINCT hot.user_id)
             FROM hot JOIN tagged ON tagged.user_id = hot.user_id
            WHERE 'contactado' = ANY(tagged.tags))::int                                       AS contactado,
          (SELECT COUNT(DISTINCT hot.user_id)
             FROM hot JOIN tagged ON tagged.user_id = hot.user_id
            WHERE 'en propuesta' = ANY(tagged.tags) OR 'negociando' = ANY(tagged.tags))::int AS en_propuesta,
          (SELECT COUNT(DISTINCT hot.user_id)
             FROM hot JOIN tagged ON tagged.user_id = hot.user_id
            WHERE 'cliente' = ANY(tagged.tags))::int                                          AS cliente
      `);
      ctx.body = rows(r)[0] || null;
    } catch (e) {
      strapi.log.error('[analytics-ingest.salesFunnel]', e);
      ctx.status = 500;
      ctx.body = { error: 'Sales funnel not ready' };
    }
  },

  /**
   * GET /admin/crm/team-leaderboard
   * Agrega métricas por assignee: total asignados, contactados, propuestas,
   * clientes, conversion rate y tiempo promedio desde asignación hasta que
   * el lead obtuvo el tag "cliente".
   */
  async teamLeaderboard(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(`
        WITH assigned AS (
          SELECT
            ua.assignee_id,
            ua.assignee_email,
            ua.user_id,
            ua.assigned_at,
            (SELECT ARRAY_AGG(ut.tag) FROM analytics.user_tags ut WHERE ut.user_id = ua.user_id) AS tags,
            (SELECT MIN(ut.created_at) FROM analytics.user_tags ut WHERE ut.user_id = ua.user_id AND ut.tag = 'cliente') AS cliente_at,
            (SELECT MIN(ut.created_at) FROM analytics.user_tags ut WHERE ut.user_id = ua.user_id AND ut.tag = 'contactado') AS contactado_at
          FROM analytics.user_assignments ua
        )
        SELECT
          assignee_id,
          COALESCE(assignee_email, 'Usuario #' || assignee_id) AS assignee_email,
          COUNT(*)::int                                                                               AS total,
          COUNT(*) FILTER (WHERE 'contactado'    = ANY(tags))::int                                    AS contactados,
          COUNT(*) FILTER (WHERE 'en propuesta'  = ANY(tags) OR 'negociando' = ANY(tags))::int        AS en_propuesta,
          COUNT(*) FILTER (WHERE 'cliente'       = ANY(tags))::int                                    AS clientes,
          CASE WHEN COUNT(*) = 0 THEN 0
               ELSE (COUNT(*) FILTER (WHERE 'cliente' = ANY(tags)))::numeric * 100 / COUNT(*)
          END                                                                                          AS conversion_pct,
          AVG(EXTRACT(EPOCH FROM (cliente_at - assigned_at)) / 86400)
            FILTER (WHERE cliente_at IS NOT NULL)                                                     AS avg_days_to_close,
          AVG(EXTRACT(EPOCH FROM (contactado_at - assigned_at)) / 3600)
            FILTER (WHERE contactado_at IS NOT NULL)                                                  AS avg_hours_to_first_contact
        FROM assigned
        GROUP BY assignee_id, assignee_email
        ORDER BY conversion_pct DESC, clientes DESC
      `);
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.teamLeaderboard]', e);
      ctx.status = 500;
      ctx.body = { error: 'Leaderboard not ready' };
    }
  },

  /**
   * GET /admin/snapshot
   * Resumen ejecutivo listo para imprimir/exportar a PDF. Agrupa en un
   * solo response todo lo que necesita la página de snapshot semanal:
   *   - KPIs últimos 7 días + deltas vs 7d previos
   *   - Funnel de ventas
   *   - Top 5 hot leads sin contactar
   *   - Top 5 keywords de la semana
   *   - Top 5 zero-results de la semana
   *   - Usuarios en riesgo (top 5 por engagement)
   *   - Tendencia diaria (últimos 7 días)
   */
  async weeklySnapshot(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const kpis = rows(await strapi.db.connection.raw(`
        WITH w AS (
          SELECT
            now() - interval '7 days'  AS since,
            now() - interval '14 days' AS prev_since,
            now() - interval '7 days'  AS prev_until
        )
        SELECT
          (SELECT COUNT(*) FROM analytics.searches WHERE created_at >= (SELECT since FROM w))::int       AS searches_7d,
          (SELECT COUNT(*) FROM analytics.searches
             WHERE created_at >= (SELECT prev_since FROM w) AND created_at < (SELECT prev_until FROM w))::int AS searches_prev,
          (SELECT COUNT(*) FROM analytics.events WHERE event_name='case_open' AND event_timestamp >= (SELECT since FROM w))::int AS case_opens_7d,
          (SELECT COUNT(*) FROM analytics.events WHERE event_name='case_open'
             AND event_timestamp >= (SELECT prev_since FROM w) AND event_timestamp < (SELECT prev_until FROM w))::int AS case_opens_prev,
          (SELECT COUNT(DISTINCT user_id) FROM analytics.sessions
             WHERE user_id IS NOT NULL AND started_at >= (SELECT since FROM w))::int                      AS active_users_7d,
          (SELECT COUNT(DISTINCT user_id) FROM analytics.sessions
             WHERE user_id IS NOT NULL AND started_at >= (SELECT prev_since FROM w) AND started_at < (SELECT prev_until FROM w))::int AS active_users_prev,
          (SELECT COUNT(*) FROM public.up_users WHERE created_at >= now() - interval '7 days')::int       AS new_users_7d,
          (SELECT COUNT(*) FROM analytics.user_profiles_computed WHERE lead_score >= 60)::int             AS hot_leads
      `))[0] || {};

      const pct = (cur: any, prev: any) => {
        const p = Number(prev) || 0;
        const c = Number(cur) || 0;
        if (p === 0) return null;
        return ((c - p) / p) * 100;
      };
      kpis.searches_delta_pct = pct(kpis.searches_7d, kpis.searches_prev);
      kpis.case_opens_delta_pct = pct(kpis.case_opens_7d, kpis.case_opens_prev);
      kpis.active_users_delta_pct = pct(kpis.active_users_7d, kpis.active_users_prev);

      const funnelTech = rows(await strapi.db.connection.raw(`
        WITH w AS (SELECT now() - interval '7 days' AS since)
        SELECT
          (SELECT COUNT(*) FROM analytics.searches WHERE created_at >= (SELECT since FROM w))::int AS busquedas,
          (SELECT COUNT(*) FROM analytics.events WHERE event_name='case_open' AND event_timestamp >= (SELECT since FROM w))::int AS aperturas,
          (SELECT COUNT(*) FROM analytics.events WHERE event_name='case_scroll_milestone' AND (payload->>'milestone_pct')::int >= 75 AND event_timestamp >= (SELECT since FROM w))::int AS lectura_profunda,
          (SELECT COUNT(*) FROM analytics.events WHERE event_name IN ('case_print','case_download') AND event_timestamp >= (SELECT since FROM w))::int AS imp_dl,
          (SELECT COUNT(*) FROM analytics.events WHERE event_name IN ('contact_firm_click','lead_form_submitted') AND event_timestamp >= (SELECT since FROM w))::int AS contactos
      `))[0] || null;

      const salesFunnel = rows(await strapi.db.connection.raw(`
        WITH hot AS (SELECT user_id FROM analytics.user_profiles_computed WHERE lead_score >= 60),
             tagged AS (SELECT user_id, ARRAY_AGG(tag) AS tags FROM analytics.user_tags GROUP BY user_id)
        SELECT
          (SELECT COUNT(*) FROM hot)::int                                                                 AS hot_leads,
          (SELECT COUNT(*) FROM hot JOIN tagged USING(user_id) WHERE 'contactado' = ANY(tagged.tags))::int AS contactado,
          (SELECT COUNT(*) FROM hot JOIN tagged USING(user_id) WHERE 'en propuesta' = ANY(tagged.tags) OR 'negociando' = ANY(tagged.tags))::int AS en_propuesta,
          (SELECT COUNT(*) FROM hot JOIN tagged USING(user_id) WHERE 'cliente' = ANY(tagged.tags))::int   AS cliente
      `))[0] || null;

      const topHotUntagged = rows(await strapi.db.connection.raw(`
        SELECT hl.user_id, hl.username, hl.email, hl.profession, hl.lead_score, hl.engagement_score
          FROM analytics.v_hot_leads hl
         WHERE NOT EXISTS (SELECT 1 FROM analytics.user_tags ut WHERE ut.user_id = hl.user_id)
         ORDER BY hl.lead_score DESC
         LIMIT 5
      `));

      const topKeywords = rows(await strapi.db.connection.raw(`
        SELECT query_normalized AS keyword,
               COUNT(*)::int AS searches,
               COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS unique_users
          FROM analytics.searches
         WHERE created_at >= now() - interval '7 days'
           AND query_normalized IS NOT NULL AND query_normalized <> ''
         GROUP BY query_normalized
         ORDER BY searches DESC
         LIMIT 5
      `));

      const topZero = rows(await strapi.db.connection.raw(`
        SELECT query_normalized AS keyword,
               COUNT(*)::int AS reps,
               COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::int AS unique_users
          FROM analytics.searches
         WHERE zero_result
           AND created_at >= now() - interval '7 days'
           AND query_normalized IS NOT NULL AND query_normalized <> ''
         GROUP BY query_normalized
         ORDER BY reps DESC
         LIMIT 5
      `));

      const atRisk = rows(await strapi.db.connection.raw(`
        SELECT upc.user_id, u.email, u.username, u.profession,
               upc.engagement_score, upc.days_since_last_seen
          FROM analytics.user_profiles_computed upc
          LEFT JOIN public.up_users u ON u.id = upc.user_id
         WHERE upc.engagement_score >= 40
           AND upc.days_since_last_seen >= 14
         ORDER BY upc.engagement_score DESC
         LIMIT 5
      `));

      const pulse = rows(await strapi.db.connection.raw(`
        WITH span AS (
          SELECT generate_series(
            (now()::date - 6 * interval '1 day')::date,
            now()::date,
            interval '1 day'
          )::date AS d
        )
        SELECT span.d::text AS day,
               COALESCE((SELECT COUNT(*) FROM analytics.events
                          WHERE event_timestamp::date = span.d), 0)::int AS events
          FROM span ORDER BY span.d
      `));

      ctx.body = {
        generated_at: new Date().toISOString(),
        kpis,
        funnel_tech: funnelTech,
        sales_funnel: salesFunnel,
        top_hot_untagged: topHotUntagged,
        top_keywords: topKeywords,
        top_zero: topZero,
        at_risk: atRisk,
        pulse,
      };
    } catch (e) {
      strapi.log.error('[analytics-ingest.weeklySnapshot]', e);
      ctx.status = 500;
      ctx.body = { error: 'Snapshot not ready' };
    }
  },

  /**
   * GET /admin/cases/:id/similar
   * "Usuarios que vieron esta también vieron..." — recomendador basado en
   * co-ocurrencia de aperturas por usuario. Para un case_id dado, busca
   * los otros case_ids más frecuentes entre los usuarios que abrieron el
   * primero. Window: últimos 90 días.
   */
  async caseSimilar(ctx: any) {
    const strapi = pickStrapi(ctx);
    const caseId = String(ctx.params.id ?? '').trim();
    if (!caseId) {
      ctx.status = 400;
      ctx.body = { error: 'case_id requerido' };
      return;
    }
    try {
      const r = await strapi.db.connection.raw(
        `
        WITH viewers AS (
          SELECT DISTINCT user_id
            FROM analytics.case_interactions
           WHERE case_id = ?
             AND user_id IS NOT NULL
             AND last_open_at >= now() - interval '90 days'
        )
        SELECT
          ci.case_id,
          COUNT(DISTINCT ci.user_id)::int                 AS shared_users,
          SUM(ci.opens_count)::int                        AS combined_opens,
          AVG(ci.max_scroll_pct)::numeric(5,2)            AS avg_scroll_pct
        FROM analytics.case_interactions ci
        JOIN viewers v ON v.user_id = ci.user_id
        WHERE ci.case_id <> ?
          AND ci.last_open_at >= now() - interval '90 days'
        GROUP BY ci.case_id
        ORDER BY shared_users DESC, combined_opens DESC
        LIMIT 10
        `,
        [caseId, caseId]
      );
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.caseSimilar]', e);
      ctx.status = 500;
      ctx.body = { error: 'Similar cases not ready' };
    }
  },

  /**
   * GET /admin/crm/my-alerts
   *
   * Devuelve un resumen liviano (≤1kb) pensado para polling cada 60s.
   * Contenido:
   *   - pending_contact: mis asignados sin tag 'contactado' ni 'cliente'
   *   - at_risk_now: mis asignados con days_since_last_seen ≥ 14, no cliente
   *   - new_hot_leads_unassigned: hot (score≥60) sin dueño, con first_seen ≤ 7d
   *   - new_since_last_visit: hot sin dueño cuyo first_seen_at > last_inbox_seen_at
   *   - server_time: para que el cliente calcule deltas sin asumir reloj local
   *
   * Usa ctx.state.user.id para personalizar. Devuelve 0s si no hay sesión.
   */
  async myAlerts(ctx: any) {
    const strapi = pickStrapi(ctx);
    const me = Number(ctx.state?.user?.id ?? 0);
    try {
      let mine = { pending_contact: 0, at_risk_now: 0 };
      if (me) {
        const mineRes = rows(await strapi.db.connection.raw(
          `
          WITH assigned AS (
            SELECT ua.user_id,
                   COALESCE((SELECT ARRAY_AGG(tag) FROM analytics.user_tags t WHERE t.user_id = ua.user_id), ARRAY[]::text[]) AS tags,
                   upc.lead_score,
                   upc.days_since_last_seen
              FROM analytics.user_assignments ua
              LEFT JOIN analytics.user_profiles_computed upc ON upc.user_id = ua.user_id
             WHERE ua.assignee_id = ?
          )
          SELECT
            COUNT(*) FILTER (
              WHERE lead_score >= 60
                AND NOT ('contactado' = ANY(tags))
                AND NOT ('cliente' = ANY(tags))
            )::int AS pending_contact,
            COUNT(*) FILTER (
              WHERE days_since_last_seen >= 14
                AND NOT ('cliente' = ANY(tags))
            )::int AS at_risk_now
          FROM assigned
          `,
          [me]
        ))[0];
        if (mineRes) mine = mineRes as any;
      }

      // Última visita del admin (si existe)
      let lastInboxSeen: string | null = null;
      if (me) {
        try {
          const s = rows(await strapi.db.connection.raw(
            `SELECT last_inbox_seen_at FROM analytics.admin_seen WHERE admin_id = ?`,
            [me]
          ))[0];
          lastInboxSeen = s?.last_inbox_seen_at ?? null;
        } catch { /* ignore */ }
      }

      // Hot sin dueño · en ventana 7d
      const unassignedRes = rows(await strapi.db.connection.raw(`
        SELECT COUNT(*)::int AS n
          FROM analytics.user_profiles_computed upc
         WHERE upc.lead_score >= 60
           AND upc.first_seen_at >= now() - interval '7 days'
           AND NOT EXISTS (
             SELECT 1 FROM analytics.user_assignments ua WHERE ua.user_id = upc.user_id
           )
      `))[0];
      const newHotUnassigned = Number(unassignedRes?.n ?? 0);

      // Nuevos desde mi última visita al inbox (si existe timestamp)
      let newSinceLast = 0;
      if (lastInboxSeen) {
        try {
          const ns = rows(await strapi.db.connection.raw(
            `SELECT COUNT(*)::int AS n
               FROM analytics.user_profiles_computed upc
              WHERE upc.lead_score >= 60
                AND upc.first_seen_at > ?::timestamptz
                AND NOT EXISTS (
                  SELECT 1 FROM analytics.user_assignments ua WHERE ua.user_id = upc.user_id
                )`,
            [lastInboxSeen]
          ))[0];
          newSinceLast = Number(ns?.n ?? 0);
        } catch { /* ignore */ }
      }

      ctx.body = {
        pending_contact: mine.pending_contact,
        at_risk_now: mine.at_risk_now,
        new_hot_leads_unassigned: newHotUnassigned,
        new_since_last_visit: newSinceLast,
        last_inbox_seen_at: lastInboxSeen,
        server_time: new Date().toISOString(),
      };
    } catch (e) {
      strapi.log.error('[analytics-ingest.myAlerts]', e);
      ctx.status = 500;
      ctx.body = { error: 'Alerts not ready' };
    }
  },

  /**
   * POST /admin/crm/mark-seen  { kind: 'inbox' | 'dashboard' }
   * Upsert que guarda el "last X seen at" del admin logueado.
   */
  async markSeen(ctx: any) {
    const strapi = pickStrapi(ctx);
    const me = Number(ctx.state?.user?.id ?? 0);
    const kind = String(ctx.request.body?.kind ?? 'inbox');
    if (!me) {
      ctx.status = 401;
      ctx.body = { error: 'No admin id' };
      return;
    }
    const col = kind === 'dashboard' ? 'last_dashboard_seen_at' : 'last_inbox_seen_at';
    try {
      await strapi.db.connection.raw(
        `
        INSERT INTO analytics.admin_seen (admin_id, ${col}, updated_at)
        VALUES (?, now(), now())
        ON CONFLICT (admin_id) DO UPDATE SET
          ${col} = now(),
          updated_at = now()
        `,
        [me]
      );
      ctx.body = { ok: true, kind, at: new Date().toISOString() };
    } catch (e) {
      strapi.log.error('[analytics-ingest.markSeen]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not mark seen' };
    }
  },

  /**
   * GET /admin/users/:id/history
   * Devuelve el audit trail comercial del lead ordenado cronológico desc.
   */
  async leadHistory(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    if (!Number.isFinite(uid)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid id' };
      return;
    }
    try {
      const r = await strapi.db.connection.raw(
        `SELECT id, event, payload, author_email, created_at
           FROM analytics.lead_history
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 500`,
        [uid]
      );
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.leadHistory]', e);
      ctx.status = 500;
      ctx.body = { error: 'History not available' };
    }
  },

  /**
   * POST /admin/crm/bulk
   *   { user_ids: number[], action: 'assign'|'unassign'|'add_tag'|'remove_tag', payload: {...} }
   *
   * Ejecuta la acción para todos los user_ids en una única transacción lógica
   * (cada uno se intenta independientemente; éxitos/fallos se cuentan por
   * separado). Cada cambio loguea en lead_history vía logHistory.
   */
  async crmBulk(ctx: any) {
    const strapi = pickStrapi(ctx);
    const body = ctx.request.body ?? {};
    const userIds: number[] = Array.isArray(body.user_ids)
      ? body.user_ids.map((v: any) => Number(v)).filter(Number.isFinite)
      : [];
    const action = String(body.action ?? '');
    const payload = body.payload ?? {};

    if (userIds.length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'user_ids requerido' };
      return;
    }
    if (userIds.length > 200) {
      ctx.status = 400;
      ctx.body = { error: 'Max 200 user_ids por request' };
      return;
    }

    let ok = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const uid of userIds) {
      try {
        if (action === 'assign') {
          const assigneeId = Number(payload.assignee_id);
          if (!Number.isFinite(assigneeId)) {
            failed++;
            continue;
          }
          let assigneeEmail: string | null = null;
          try {
            const em = rows(await strapi.db.connection.raw(
              `SELECT email FROM public.admin_users WHERE id = ?`, [assigneeId]
            ))[0];
            assigneeEmail = em?.email ?? null;
          } catch { /* ignore */ }
          await strapi.db.connection.raw(
            `INSERT INTO analytics.user_assignments (user_id, assignee_id, assignee_email, assigned_by_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (user_id) DO UPDATE SET
               assignee_id = EXCLUDED.assignee_id,
               assignee_email = EXCLUDED.assignee_email,
               assigned_by_id = EXCLUDED.assigned_by_id,
               assigned_at = now()`,
            [uid, assigneeId, assigneeEmail, ctx.state?.user?.id ?? null]
          );
          await logHistory(strapi, ctx, uid, 'assigned', {
            assignee_id: assigneeId,
            assignee_email: assigneeEmail,
            bulk: true,
          });
          ok++;
        } else if (action === 'unassign') {
          await strapi.db.connection.raw(
            `DELETE FROM analytics.user_assignments WHERE user_id = ?`,
            [uid]
          );
          await logHistory(strapi, ctx, uid, 'unassigned', { bulk: true });
          ok++;
        } else if (action === 'add_tag') {
          const tag = String(payload.tag ?? '').trim().toLowerCase();
          if (!tag || tag.length > 50) {
            failed++;
            continue;
          }
          await strapi.db.connection.raw(
            `INSERT INTO analytics.user_tags (user_id, tag, author_id)
             VALUES (?, ?, ?)
             ON CONFLICT (user_id, tag) DO NOTHING`,
            [uid, tag, ctx.state?.user?.id ?? null]
          );
          await logHistory(strapi, ctx, uid, 'tag_added', { tag, bulk: true });
          ok++;
        } else if (action === 'remove_tag') {
          const tag = String(payload.tag ?? '').trim().toLowerCase();
          if (!tag) {
            failed++;
            continue;
          }
          await strapi.db.connection.raw(
            `DELETE FROM analytics.user_tags WHERE user_id = ? AND tag = ?`,
            [uid, tag]
          );
          await logHistory(strapi, ctx, uid, 'tag_removed', { tag, bulk: true });
          ok++;
        } else {
          failed++;
          if (!errors.includes('invalid_action')) errors.push('invalid_action');
        }
      } catch (e: any) {
        failed++;
        strapi.log.error('[analytics-ingest.crmBulk user ' + uid + ']', e);
      }
    }

    // Auditamos la operación bulk completa
    await strapi.db.connection
      .raw(
        `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, ip_address)
         VALUES (?, ?, ?, ?)`,
        [ctx.state?.user?.id ?? null, `crm_bulk_${action}`, null, ctx.request?.ip ?? null]
      )
      .catch(() => { });

    ctx.body = { ok, failed, total: userIds.length, errors };
  },

  // =====================================================================
  // SPRINT 9 — AUTO-RULES + SETTINGS
  // =====================================================================

  /** GET /admin/auto-rules */
  async autoRulesList(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(
        `SELECT id, slug, name, description, kind, tag, enabled,
                last_run_at, last_affected, total_affected, created_at
           FROM analytics.auto_rules
          ORDER BY enabled DESC, name`
      );
      ctx.body = rows(r);
    } catch (e) {
      strapi.log.error('[analytics-ingest.autoRulesList]', e);
      ctx.status = 500;
      ctx.body = { error: 'Rules table not ready' };
    }
  },

  /** PUT /admin/auto-rules/:id  { enabled } */
  async autoRulesUpdate(ctx: any) {
    const strapi = pickStrapi(ctx);
    const id = Number(ctx.params.id);
    const enabled = Boolean(ctx.request.body?.enabled);
    if (!Number.isFinite(id)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid id' };
      return;
    }
    try {
      await strapi.db.connection.raw(
        `UPDATE analytics.auto_rules SET enabled = ? WHERE id = ?`,
        [enabled, id]
      );
      await strapi.db.connection
        .raw(
          `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, target_id, ip_address)
           VALUES (?, ?, 'auto_rule', ?, ?)`,
          [
            ctx.state?.user?.id ?? null,
            enabled ? 'rule_enable' : 'rule_disable',
            String(id),
            ctx.request?.ip ?? null,
          ]
        )
        .catch(() => { });
      ctx.body = { ok: true, id, enabled };
    } catch (e) {
      strapi.log.error('[analytics-ingest.autoRulesUpdate]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not update rule' };
    }
  },

  /**
   * POST /admin/auto-rules/:id/run
   * Ejecuta UNA regla ad-hoc (sin esperar al cron). Útil como "correr ahora"
   * tras activar una regla recién.
   */
  async autoRulesRunOne(ctx: any) {
    const strapi = pickStrapi(ctx);
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid id' };
      return;
    }
    try {
      const rule = rows(
        await strapi.db.connection.raw(
          `SELECT id, slug, kind, tag, condition_sql, enabled FROM analytics.auto_rules WHERE id = ?`,
          [id]
        )
      )[0];
      if (!rule) {
        ctx.status = 404;
        ctx.body = { error: 'Rule not found' };
        return;
      }
      if (rule.kind !== 'add_tag' || !rule.tag) {
        ctx.status = 400;
        ctx.body = { error: 'Unsupported rule kind' };
        return;
      }
      const res = rows(await strapi.db.connection.raw(rule.condition_sql));
      const userIds = res.map((r: any) => Number(r.user_id)).filter(Number.isFinite);
      let added = 0;
      if (userIds.length > 0) {
        const insertRes = rows(await strapi.db.connection.raw(
          `
          INSERT INTO analytics.user_tags (user_id, tag, author_id)
          SELECT uid, ?, NULL FROM unnest(ARRAY[${userIds.join(',')}]::int[]) AS uid
          ON CONFLICT (user_id, tag) DO NOTHING
          RETURNING user_id
          `,
          [rule.tag]
        ));
        added = insertRes.length;
        for (const row of insertRes) {
          await strapi.db.connection
            .raw(
              `INSERT INTO analytics.lead_history (user_id, event, payload, author_email)
               VALUES (?, 'tag_added', ?::jsonb, ?)`,
              [
                row.user_id,
                JSON.stringify({ tag: rule.tag, auto: true, rule: rule.slug, manual_run: true }),
                `Auto-rule: ${rule.slug}`,
              ]
            )
            .catch(() => { });
        }
      }
      await strapi.db.connection.raw(
        `UPDATE analytics.auto_rules
           SET last_affected = ?, total_affected = total_affected + ?, last_run_at = now()
         WHERE id = ?`,
        [added, added, id]
      );
      ctx.body = { ok: true, matched: userIds.length, added };
    } catch (e) {
      strapi.log.error('[analytics-ingest.autoRulesRunOne]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not run rule' };
    }
  },

  /** GET /admin/settings */
  async settingsGet(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(
        `SELECT key, value, updated_at FROM analytics.settings ORDER BY key`
      );
      // devolvemos como { key: value }
      const map: Record<string, any> = {};
      for (const row of rows(r)) {
        map[row.key] = row.value;
      }
      ctx.body = map;
    } catch (e) {
      strapi.log.error('[analytics-ingest.settingsGet]', e);
      ctx.status = 500;
      ctx.body = { error: 'Settings not ready' };
    }
  },

  /**
   * PUT /admin/settings  { hot_lead_threshold?, risk_days?, new_lead_window_days?, deep_read_scroll_pct? }
   * Valida rangos y hace upsert por key.
   */
  async settingsUpdate(ctx: any) {
    const strapi = pickStrapi(ctx);
    const body = ctx.request.body ?? {};

    const validators: Record<string, (v: any) => number | null> = {
      hot_lead_threshold: (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : null;
      },
      risk_days: (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 3 && n <= 180 ? Math.round(n) : null;
      },
      new_lead_window_days: (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 1 && n <= 90 ? Math.round(n) : null;
      },
      deep_read_scroll_pct: (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 25 && n <= 100 ? Math.round(n) : null;
      },
    };

    const updates: Array<{ key: string; value: number }> = [];
    const errors: string[] = [];

    for (const key of Object.keys(validators)) {
      if (body[key] !== undefined) {
        const valid = validators[key](body[key]);
        if (valid === null) errors.push(`${key}: fuera de rango`);
        else updates.push({ key, value: valid });
      }
    }

    if (errors.length) {
      ctx.status = 400;
      ctx.body = { error: errors.join('; ') };
      return;
    }
    if (updates.length === 0) {
      ctx.body = { ok: true, updated: 0 };
      return;
    }

    try {
      for (const u of updates) {
        await strapi.db.connection.raw(
          `
          INSERT INTO analytics.settings (key, value, updated_at)
          VALUES (?, to_jsonb(?::int), now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
          `,
          [u.key, u.value]
        );
      }
      await strapi.db.connection
        .raw(
          `INSERT INTO analytics.admin_audit (admin_user_id, action, target_type, ip_address)
           VALUES (?, 'settings_update', NULL, ?)`,
          [ctx.state?.user?.id ?? null, ctx.request?.ip ?? null]
        )
        .catch(() => { });
      // Invalidar cache para que el cambio surta efecto en la próxima
      // request (sin esperar al TTL de 30s del helper getSetting).
      try {
        strapi.plugin('analytics-ingest').service('settings').invalidate();
      } catch { /* noop */ }
      ctx.body = { ok: true, updated: updates.length };
    } catch (e) {
      strapi.log.error('[analytics-ingest.settingsUpdate]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not update settings' };
    }
  },

  // =====================================================================
  // SPRINT 10 — WEBHOOKS SALIENTES
  // =====================================================================

  async webhooksList(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const list = await strapi.plugin('analytics-ingest').service('webhooks').list();
      ctx.body = list;
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooksList]', e);
      ctx.status = 500;
      ctx.body = { error: 'Webhooks not ready' };
    }
  },

  async webhooksCreate(ctx: any) {
    const strapi = pickStrapi(ctx);
    const body = ctx.request.body ?? {};
    const name = String(body.name ?? '').trim();
    const url = String(body.url ?? '').trim();
    const events = Array.isArray(body.events) ? body.events : undefined;
    const secret = body.secret ? String(body.secret) : null;
    if (!name || !url || !/^https?:\/\//.test(url)) {
      ctx.status = 400;
      ctx.body = { error: 'name y url (http/https) son requeridos' };
      return;
    }
    try {
      const id = await strapi.plugin('analytics-ingest').service('webhooks').create({
        name, url, events, secret,
      });
      ctx.body = { ok: true, id };
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooksCreate]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not create webhook' };
    }
  },

  async webhooksUpdate(ctx: any) {
    const strapi = pickStrapi(ctx);
    const id = Number(ctx.params.id);
    const body = ctx.request.body ?? {};
    if (!Number.isFinite(id)) {
      ctx.status = 400; ctx.body = { error: 'Invalid id' }; return;
    }
    try {
      await strapi.plugin('analytics-ingest').service('webhooks').update(id, body);
      ctx.body = { ok: true };
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooksUpdate]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not update webhook' };
    }
  },

  async webhooksDelete(ctx: any) {
    const strapi = pickStrapi(ctx);
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.status = 400; ctx.body = { error: 'Invalid id' }; return;
    }
    try {
      await strapi.plugin('analytics-ingest').service('webhooks').remove(id);
      ctx.body = { ok: true };
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooksDelete]', e);
      ctx.status = 500;
      ctx.body = { error: 'Could not delete webhook' };
    }
  },

  /** POST /admin/webhooks/:id/test — dispara un payload ficticio */
  async webhooksTest(ctx: any) {
    const strapi = pickStrapi(ctx);
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.status = 400; ctx.body = { error: 'Invalid id' }; return;
    }
    try {
      const wh = await strapi.plugin('analytics-ingest').service('webhooks').get(id);
      if (!wh) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
      // Disparo forzado por id (re-usamos fire pero con sólo un hook)
      // Como fire lee por event, en vez hacemos test directo: insertamos
      // un delivery sintético usando el servicio.
      await strapi.plugin('analytics-ingest').service('webhooks').fire('webhook_test', {
        test: true,
        webhook_id: id,
        note: 'Test enviado desde el panel de administración',
      });
      ctx.body = { ok: true };
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooksTest]', e);
      ctx.status = 500;
      ctx.body = { error: 'Test failed' };
    }
  },

  async webhooksDeliveries(ctx: any) {
    const strapi = pickStrapi(ctx);
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.status = 400; ctx.body = { error: 'Invalid id' }; return;
    }
    try {
      const res = await strapi.plugin('analytics-ingest').service('webhooks').recentDeliveries(id, 30);
      ctx.body = res;
    } catch (e) {
      strapi.log.error('[analytics-ingest.webhooksDeliveries]', e);
      ctx.status = 500;
      ctx.body = { error: 'Deliveries not ready' };
    }
  },

  /**
   * GET /admin/crm/conversion-stats
   * Compara la cohorte de usuarios con tag "cliente" vs hot leads sin
   * ese tag, y devuelve promedios clave para alimentar la predicción.
   */
  async conversionStats(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(`
        WITH clients AS (
          SELECT upc.user_id, upc.lead_score, upc.engagement_score,
                 upc.cases_viewed_total, upc.searches_total,
                 upc.prints_total, upc.downloads_total
            FROM analytics.user_profiles_computed upc
            JOIN analytics.user_tags ut ON ut.user_id = upc.user_id AND ut.tag = 'cliente'
        ),
        hot_non_clients AS (
          SELECT upc.user_id, upc.lead_score, upc.engagement_score,
                 upc.cases_viewed_total, upc.searches_total,
                 upc.prints_total, upc.downloads_total
            FROM analytics.user_profiles_computed upc
            WHERE upc.lead_score >= 60
              AND NOT EXISTS (
                SELECT 1 FROM analytics.user_tags ut
                 WHERE ut.user_id = upc.user_id AND ut.tag = 'cliente'
              )
        )
        SELECT
          (SELECT COUNT(*) FROM clients)::int                                    AS clients_count,
          (SELECT COUNT(*) FROM hot_non_clients)::int                            AS hot_non_clients_count,
          (SELECT AVG(lead_score) FROM clients)                                  AS avg_lead_score_clients,
          (SELECT AVG(engagement_score) FROM clients)                            AS avg_engagement_clients,
          (SELECT AVG(cases_viewed_total) FROM clients)                          AS avg_cases_clients,
          (SELECT AVG(searches_total) FROM clients)                              AS avg_searches_clients,
          (SELECT AVG(prints_total + downloads_total) FROM clients)              AS avg_imp_dl_clients,
          (SELECT AVG(lead_score) FROM hot_non_clients)                          AS avg_lead_score_non_clients,
          (SELECT AVG(engagement_score) FROM hot_non_clients)                    AS avg_engagement_non_clients,
          (SELECT AVG(cases_viewed_total) FROM hot_non_clients)                  AS avg_cases_non_clients,
          (SELECT AVG(searches_total) FROM hot_non_clients)                      AS avg_searches_non_clients
      `);

      // días promedio desde assigned_at hasta primer tag "cliente"
      const timeToClose = rows(await strapi.db.connection.raw(`
        SELECT AVG(EXTRACT(EPOCH FROM (cliente_at - ua.assigned_at)) / 86400) AS avg_days
          FROM analytics.user_assignments ua
          JOIN LATERAL (
            SELECT MIN(created_at) AS cliente_at
              FROM analytics.user_tags ut
             WHERE ut.user_id = ua.user_id AND ut.tag = 'cliente'
          ) x ON x.cliente_at IS NOT NULL
      `))[0];

      const out = rows(r)[0] || null;
      if (out) out.avg_days_to_close = timeToClose?.avg_days ?? null;
      ctx.body = out;
    } catch (e) {
      strapi.log.error('[analytics-ingest.conversionStats]', e);
      ctx.status = 500;
      ctx.body = { error: 'Conversion stats not ready' };
    }
  },

  /**
   * GET /admin/users/:id/close-probability
   *
   * Calcula una probabilidad simple de cierre comparando el perfil del
   * usuario contra la cohorte de "clientes". Método: contar cuántas de
   * 4 señales están por encima de la mediana de los clientes y mapear
   * ese score 0-4 a un porcentaje 15-85. No es ML, es una heurística
   * transparente que el admin puede auditar en UI.
   */
  async closeProbability(ctx: any) {
    const strapi = pickStrapi(ctx);
    const uid = Number(ctx.params.id);
    if (!Number.isFinite(uid)) {
      ctx.status = 400; ctx.body = { error: 'Invalid id' }; return;
    }
    try {
      const user = rows(await strapi.db.connection.raw(
        `SELECT lead_score, engagement_score, cases_viewed_total,
                searches_total, prints_total, downloads_total,
                EXISTS(SELECT 1 FROM analytics.user_tags ut WHERE ut.user_id = upc.user_id AND ut.tag = 'cliente') AS is_client
           FROM analytics.user_profiles_computed upc
          WHERE upc.user_id = ?`,
        [uid]
      ))[0];

      if (!user) {
        ctx.body = { probability_pct: null, reasons: [], is_client: false };
        return;
      }
      if (user.is_client) {
        ctx.body = { probability_pct: 100, reasons: ['Ya es cliente'], is_client: true };
        return;
      }

      const medians = rows(await strapi.db.connection.raw(`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY upc.lead_score)              AS m_lead,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY upc.engagement_score)        AS m_eng,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY upc.cases_viewed_total)      AS m_cases,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY upc.prints_total + upc.downloads_total) AS m_impdl
          FROM analytics.user_profiles_computed upc
          JOIN analytics.user_tags ut ON ut.user_id = upc.user_id AND ut.tag = 'cliente'
      `))[0];

      // Si no hay suficientes clientes para medianas, retornamos placeholder
      if (!medians || medians.m_lead === null) {
        ctx.body = {
          probability_pct: null,
          reasons: ['Aún no hay suficientes clientes en el histórico para calcular'],
          is_client: false,
        };
        return;
      }

      const signals = [
        {
          label: 'Lead score',
          passes: Number(user.lead_score ?? 0) >= Number(medians.m_lead ?? 0),
          user: Number(user.lead_score ?? 0),
          median: Number(medians.m_lead ?? 0),
        },
        {
          label: 'Engagement',
          passes: Number(user.engagement_score ?? 0) >= Number(medians.m_eng ?? 0),
          user: Number(user.engagement_score ?? 0),
          median: Number(medians.m_eng ?? 0),
        },
        {
          label: 'Sentencias abiertas',
          passes: Number(user.cases_viewed_total ?? 0) >= Number(medians.m_cases ?? 0),
          user: Number(user.cases_viewed_total ?? 0),
          median: Number(medians.m_cases ?? 0),
        },
        {
          label: 'Imp/DL combinados',
          passes:
            Number(user.prints_total ?? 0) + Number(user.downloads_total ?? 0) >=
            Number(medians.m_impdl ?? 0),
          user: Number(user.prints_total ?? 0) + Number(user.downloads_total ?? 0),
          median: Number(medians.m_impdl ?? 0),
        },
      ];

      const passed = signals.filter((s) => s.passes).length;
      // 0 señales → 15%, 4 señales → 85%, interpolar lineal
      const probability = 15 + (passed / 4) * 70;

      ctx.body = {
        probability_pct: Math.round(probability),
        passed_signals: passed,
        total_signals: signals.length,
        signals,
        is_client: false,
      };
    } catch (e) {
      strapi.log.error('[analytics-ingest.closeProbability]', e);
      ctx.status = 500;
      ctx.body = { error: 'Probability not ready' };
    }
  },

  async crmTagsSummary(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const byTag = await strapi.db.connection.raw(
        `SELECT tag, COUNT(*)::int AS n FROM analytics.user_tags
         GROUP BY tag ORDER BY n DESC LIMIT 50`
      );
      const byUser = await strapi.db.connection.raw(
        `SELECT user_id, ARRAY_AGG(tag ORDER BY tag) AS tags
           FROM analytics.user_tags GROUP BY user_id`
      );
      ctx.body = { byTag: rows(byTag), byUser: rows(byUser) };
    } catch (e) {
      strapi.log.error('[analytics-ingest.crmTagsSummary]', e);
      ctx.status = 500;
      ctx.body = { error: 'CRM tables not ready' };
    }
  },

  // =====================================================================
  // EXPORTS CSV — acciones comerciales fuera del sistema (Excel/Sheets)
  // Todos los exports se auditan en analytics.admin_audit.
  // =====================================================================

  /**
   * GET /admin/exports/hot-leads.csv
   */
  async exportHotLeads(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(
        `SELECT * FROM analytics.v_hot_leads LIMIT 500`
      );
      const data = rows(r);
      const csv = toCsv(
        [
          'user_id', 'username', 'email', 'profession', 'segment_primary',
          'lead_score', 'engagement_score', 'sessions_last_30d',
          'case_opens_total', 'prints_total', 'downloads_total',
          'last_seen_at',
        ],
        data,
        [
          'user_id', 'username', 'email', 'profession', 'segment_primary',
          'lead_score', 'engagement_score', 'sessions_last_30d',
          'case_opens_total', 'prints_total', 'downloads_total',
          'last_seen_at',
        ]
      );
      const today = new Date().toISOString().slice(0, 10);
      setCsvHeaders(ctx, `hot-leads_${today}.csv`);
      ctx.body = csv;
      await auditExport(strapi, ctx, 'export_hot_leads');
    } catch (e) {
      strapi.log.error('[analytics-ingest.exportHotLeads]', e);
      ctx.status = 500;
      ctx.body = 'Error generating CSV';
    }
  },

  /**
   * GET /admin/exports/zero-results.csv
   */
  async exportZeroResults(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(
        `SELECT * FROM analytics.v_zero_result_opportunities LIMIT 500`
      );
      const data = rows(r);
      const csv = toCsv(
        ['query', 'repeticiones', 'usuarios_unicos', 'ultima_vez'],
        data,
        ['query', 'reps', 'unique_users', 'last_seen_at']
      );
      const today = new Date().toISOString().slice(0, 10);
      setCsvHeaders(ctx, `zero-results_${today}.csv`);
      ctx.body = csv;
      await auditExport(strapi, ctx, 'export_zero_results');
    } catch (e) {
      strapi.log.error('[analytics-ingest.exportZeroResults]', e);
      ctx.status = 500;
      ctx.body = 'Error generating CSV';
    }
  },

  /**
   * GET /admin/exports/at-risk-users.csv
   */
  async exportAtRiskUsers(ctx: any) {
    const strapi = pickStrapi(ctx);
    try {
      const r = await strapi.db.connection.raw(`
        SELECT
          upc.user_id,
          u.email,
          u.username,
          u.profession,
          upc.engagement_score,
          upc.lead_score,
          upc.churn_risk,
          upc.sessions_last_7d,
          upc.sessions_last_30d,
          upc.last_seen_at,
          upc.days_since_last_seen
        FROM analytics.user_profiles_computed upc
        LEFT JOIN public.up_users u ON u.id = upc.user_id
        WHERE upc.engagement_score > 20
          AND (upc.churn_risk IN ('high', 'medium') OR upc.days_since_last_seen >= 14)
        ORDER BY upc.engagement_score DESC, upc.days_since_last_seen DESC
        LIMIT 500
      `);
      const data = rows(r);
      const csv = toCsv(
        [
          'user_id', 'username', 'email', 'profession',
          'engagement_score', 'lead_score', 'churn_risk',
          'sessions_last_7d', 'sessions_last_30d',
          'last_seen_at', 'days_since_last_seen',
        ],
        data,
        [
          'user_id', 'username', 'email', 'profession',
          'engagement_score', 'lead_score', 'churn_risk',
          'sessions_last_7d', 'sessions_last_30d',
          'last_seen_at', 'days_since_last_seen',
        ]
      );
      const today = new Date().toISOString().slice(0, 10);
      setCsvHeaders(ctx, `at-risk-users_${today}.csv`);
      ctx.body = csv;
      await auditExport(strapi, ctx, 'export_at_risk_users');
    } catch (e) {
      strapi.log.error('[analytics-ingest.exportAtRiskUsers]', e);
      ctx.status = 500;
      ctx.body = 'Error generating CSV';
    }
  },

  /**
   * GET /analytics-ingest/admin/audiencia
   *
   * Retrato de QUIÉN está en la plataforma y POR DÓNDE entró — el pedido de
   * John: gente en línea ahora, visitantes acumulados, con qué cuenta se
   * registraron (correo, Google, Apple), qué pantallas ven y en qué tienda
   * instalaron la app. Todo sale de datos que ya se capturaban
   * (up_users.provider, up_users.app_instalada, analytics.events/sessions);
   * este endpoint solo los reúne.
   *
   * `days` acota lo que es "reciente"; los acumulados son de siempre.
   */
  async audiencia(ctx: any) {
    const strapi = pickStrapi(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days || 30), 1), 365);
    try {
      // ── 1. Vivo ahora + acumulados ──────────────────────────────────
      const resumen = await strapi.db.connection.raw(`
        SELECT
          (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
             FROM analytics.events
            WHERE event_timestamp >= now() - interval '5 minutes')                     AS en_linea_5m,
          (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
             FROM analytics.events
            WHERE event_timestamp >= now() - interval '30 minutes')                    AS activos_30m,
          (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
             FROM analytics.events)                                                    AS visitantes_total,
          (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
             FROM analytics.events
            WHERE event_timestamp >= date_trunc('day', now()))                         AS visitantes_hoy,
          (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
             FROM analytics.events
            WHERE event_timestamp >= now() - interval '${days} days')                  AS visitantes_periodo,
          (SELECT COUNT(DISTINCT anonymous_id)
             FROM analytics.events
            WHERE user_id IS NULL)                                                     AS anonimos_total,
          (SELECT COUNT(*) FROM analytics.sessions)                                    AS sesiones_total,
          (SELECT COUNT(*) FROM analytics.sessions
            WHERE started_at >= now() - interval '${days} days')                       AS sesiones_periodo,
          (SELECT COUNT(*) FROM public.up_users)                                       AS registrados_total,
          (SELECT COUNT(*) FROM public.up_users
            WHERE created_at >= now() - interval '${days} days')                       AS registrados_periodo
      `);

      // ── 2. Vía de acceso: con qué cuenta se registraron ──────────────
      // `provider` es de users-permissions: 'local' = correo y contraseña.
      const porProveedor = await strapi.db.connection.raw(`
        SELECT
          CASE lower(coalesce(provider, 'local'))
            WHEN 'local'  THEN 'Correo y contraseña'
            WHEN 'google' THEN 'Google'
            WHEN 'apple'  THEN 'Apple'
            ELSE initcap(coalesce(provider, 'otro'))
          END                                                        AS via,
          COUNT(*)                                                   AS usuarios,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '${days} days') AS nuevos,
          COUNT(*) FILTER (WHERE last_active_at >= now() - interval '30 days')  AS activos_30d
        FROM public.up_users
        GROUP BY 1
        ORDER BY usuarios DESC
      `);

      // ── 3. Dónde instalaron la app (Play Store / App Store / PWA) ────
      const porInstalacion = await strapi.db.connection.raw(`
        SELECT
          CASE coalesce(app_instalada, 'ninguna')
            WHEN 'ios-nativa'     THEN 'App de iPhone (App Store)'
            WHEN 'android-nativa' THEN 'App de Android (Play Store)'
            WHEN 'pwa-ios'        THEN 'Acceso directo en iPhone'
            WHEN 'pwa-android'    THEN 'Acceso directo en Android'
            WHEN 'pwa-escritorio' THEN 'Acceso directo en computador'
            ELSE 'Solo desde el navegador'
          END                                                          AS canal,
          coalesce(app_instalada, 'ninguna')                           AS clave,
          COUNT(*)                                                     AS usuarios,
          COUNT(*) FILTER (WHERE app_instalada_en >= now() - interval '${days} days') AS nuevos,
          COUNT(*) FILTER (WHERE app_ultimo_uso_en >= now() - interval '30 days')     AS activos_30d
        FROM public.up_users
        GROUP BY 1, 2
        ORDER BY usuarios DESC
      `);

      // ── 4. Qué pantallas ven ────────────────────────────────────────
      // Se agrupa la RUTA en su sección (los ids de expediente y de tema
      // harían una lista infinita de rutas irrepetibles).
      const pantallas = await strapi.db.connection.raw(`
        WITH vistas AS (
          SELECT
            COALESCE(NULLIF(payload->>'path', ''), '/')          AS ruta,
            COALESCE(user_id::text, anonymous_id)                AS visitante
          FROM analytics.events
          WHERE event_name = 'page_view'
            AND event_timestamp >= now() - interval '${days} days'
        )
        SELECT
          CASE
            WHEN ruta = '/' OR ruta = ''            THEN 'Inicio'
            WHEN ruta LIKE '/home%'                 THEN 'Inicio'
            WHEN ruta LIKE '/buscar%'               THEN 'Buscador'
            WHEN ruta LIKE '/expediente%'           THEN 'Ficha del caso'
            WHEN ruta LIKE '/tribuna%'              THEN 'Debate Tributario'
            WHEN ruta LIKE '/jurimetria%'           THEN 'Jurimetría'
            WHEN ruta LIKE '/observatorio%'         THEN 'Observatorio'
            WHEN ruta LIKE '/analitica%'            THEN 'Análisis jurimétrico'
            WHEN ruta LIKE '/falla-tu%'
              OR ruta LIKE '/juegos%'               THEN 'Juegos'
            WHEN ruta LIKE '/favoritos%'            THEN 'Favoritos'
            WHEN ruta LIKE '/notificaciones%'       THEN 'Notificaciones'
            WHEN ruta LIKE '/mi-cuenta%'            THEN 'Mi cuenta'
            WHEN ruta LIKE '/premium%'              THEN 'Premium'
            WHEN ruta LIKE '/login%'
              OR ruta LIKE '/registro%'             THEN 'Acceso y registro'
            WHEN ruta LIKE '/admin%'                THEN 'Panel de administración'
            ELSE 'Otras'
          END                            AS pantalla,
          COUNT(*)                       AS vistas,
          COUNT(DISTINCT visitante)      AS personas
        FROM vistas
        GROUP BY 1
        ORDER BY vistas DESC
        LIMIT 20
      `);

      // ── 5. Dispositivo desde el que entran ──────────────────────────
      const porDispositivo = await strapi.db.connection.raw(`
        SELECT
          COALESCE(NULLIF(device_context->>'platform', ''), 'desconocido') AS plataforma,
          COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))            AS personas,
          COUNT(*)                                                         AS eventos
        FROM analytics.events
        WHERE event_timestamp >= now() - interval '${days} days'
        GROUP BY 1
        ORDER BY personas DESC
        LIMIT 12
      `);

      // ── 6. Curva diaria de visitantes ────────────────────────────────
      const porDia = await strapi.db.connection.raw(`
        SELECT
          to_char(date_trunc('day', event_timestamp), 'YYYY-MM-DD')  AS dia,
          COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))      AS personas,
          COUNT(DISTINCT session_id)                                 AS sesiones
        FROM analytics.events
        WHERE event_timestamp >= now() - interval '${Math.min(days, 90)} days'
        GROUP BY 1
        ORDER BY 1
      `);

      ctx.body = {
        days,
        resumen: rows(resumen)[0] ?? {},
        porProveedor: rows(porProveedor),
        porInstalacion: rows(porInstalacion),
        pantallas: rows(pantallas),
        porDispositivo: rows(porDispositivo),
        porDia: rows(porDia),
      };
    } catch (e) {
      strapi.log.error('[analytics-ingest.audiencia]', e);
      ctx.status = 500;
      ctx.body = { error: 'No se pudo calcular la audiencia' };
    }
  },
};

export default admin;
