/**
 * Routes del plugin analytics-ingest
 *
 *   /analytics/ingest             POST — endpoint público de ingesta de eventos
 *   /analytics/admin/*            GET/POST — panel admin (protegido por isAdmin)
 */
export default [
  // ============== INGESTA PÚBLICA ==============
  {
    method: 'POST',
    path: '/ingest',
    handler: 'ingest.ingest',
    config: {
      auth: false, // permite eventos pre-login
      policies: [],
    },
  },

  // ============== ADMIN — DASHBOARD EJECUTIVO ==============
  {
    method: 'GET',
    path: '/admin/kpis',
    handler: 'admin.kpis',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/keywords',
    handler: 'admin.keywords',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/zero-results',
    handler: 'admin.zeroResults',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/top-cases',
    handler: 'admin.topCases',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/hot-leads',
    handler: 'admin.hotLeads',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    // Audiencia y plataforma: en línea ahora, visitantes acumulados, vía de
    // registro (correo/Google/Apple), pantallas vistas e instalaciones por
    // tienda (App Store / Play Store).
    method: 'GET',
    path: '/admin/audiencia',
    handler: 'admin.audiencia',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/funnel',
    handler: 'admin.funnel',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    // Embudo de ENTRADA: ingresar, crear cuenta y recuperar contraseña —
    // cuánta gente llega a cada escalón, cuánta lo pasa y por qué se cae.
    method: 'GET',
    path: '/admin/embudo-entrada',
    handler: 'admin.embudoEntrada',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — BÚSQUEDA + DETALLE POR USUARIO Y SENTENCIA ==============
  {
    method: 'GET',
    path: '/admin/users/search',
    handler: 'admin.searchUsers',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/users/:id/profile360',
    handler: 'admin.userProfile',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/cases/:id/detail',
    handler: 'admin.caseDetail',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — CRM LITE (notas + tags por usuario) ==============
  {
    method: 'GET',
    path: '/admin/users/:id/crm',
    handler: 'admin.crmGet',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/users/:id/notes',
    handler: 'admin.crmAddNote',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'DELETE',
    path: '/admin/users/:id/notes/:noteId',
    handler: 'admin.crmDeleteNote',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/users/:id/tags',
    handler: 'admin.crmAddTag',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'DELETE',
    path: '/admin/users/:id/tags/:tag',
    handler: 'admin.crmDeleteTag',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/tags-summary',
    handler: 'admin.crmTagsSummary',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/pipeline',
    handler: 'admin.crmPipeline',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — SPRINT 5: ASIGNACIÓN ==============
  {
    method: 'GET',
    path: '/admin/team/members',
    handler: 'admin.teamMembers',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'PUT',
    path: '/admin/users/:id/assignment',
    handler: 'admin.assignmentSet',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'DELETE',
    path: '/admin/users/:id/assignment',
    handler: 'admin.assignmentClear',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/assignments-summary',
    handler: 'admin.assignmentsSummary',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/my-inbox',
    handler: 'admin.myInbox',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/sales-funnel',
    handler: 'admin.salesFunnel',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/team-leaderboard',
    handler: 'admin.teamLeaderboard',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/snapshot',
    handler: 'admin.weeklySnapshot',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/cases/:id/similar',
    handler: 'admin.caseSimilar',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== SPRINT 7 — ALERTAS EN TIEMPO REAL ==============
  {
    method: 'GET',
    path: '/admin/crm/my-alerts',
    handler: 'admin.myAlerts',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/crm/mark-seen',
    handler: 'admin.markSeen',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== SPRINT 8 — HISTORIAL + BULK ACTIONS ==============
  {
    method: 'GET',
    path: '/admin/users/:id/history',
    handler: 'admin.leadHistory',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/crm/bulk',
    handler: 'admin.crmBulk',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== SPRINT 9 — AUTO-RULES + SETTINGS ==============
  {
    method: 'GET',
    path: '/admin/auto-rules',
    handler: 'admin.autoRulesList',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'PUT',
    path: '/admin/auto-rules/:id',
    handler: 'admin.autoRulesUpdate',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/auto-rules/:id/run',
    handler: 'admin.autoRulesRunOne',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/settings',
    handler: 'admin.settingsGet',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'PUT',
    path: '/admin/settings',
    handler: 'admin.settingsUpdate',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== SPRINT 10 — WEBHOOKS + PREDICCIÓN ==============
  {
    method: 'GET',
    path: '/admin/webhooks',
    handler: 'admin.webhooksList',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/webhooks',
    handler: 'admin.webhooksCreate',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'PUT',
    path: '/admin/webhooks/:id',
    handler: 'admin.webhooksUpdate',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'DELETE',
    path: '/admin/webhooks/:id',
    handler: 'admin.webhooksDelete',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/admin/webhooks/:id/test',
    handler: 'admin.webhooksTest',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/webhooks/:id/deliveries',
    handler: 'admin.webhooksDeliveries',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/crm/conversion-stats',
    handler: 'admin.conversionStats',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/users/:id/close-probability',
    handler: 'admin.closeProbability',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — INSIGHTS AUTOMÁTICOS ==============
  {
    method: 'GET',
    path: '/admin/insights',
    handler: 'admin.insights',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — DRILL-DOWN EDITORIAL ==============
  {
    method: 'GET',
    path: '/admin/zero-results/detail',
    handler: 'admin.zeroResultDetail',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — BANDA 4 (PULSO + RIESGO) ==============
  {
    method: 'GET',
    path: '/admin/daily-pulse',
    handler: 'admin.dailyPulse',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/at-risk-users',
    handler: 'admin.atRiskUsers',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },

  // ============== ADMIN — EXPORTS CSV ==============
  {
    method: 'GET',
    path: '/admin/exports/hot-leads.csv',
    handler: 'admin.exportHotLeads',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/exports/zero-results.csv',
    handler: 'admin.exportZeroResults',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/admin/exports/at-risk-users.csv',
    handler: 'admin.exportAtRiskUsers',
    config: { policies: ['plugin::analytics-ingest.isAdmin'] },
  },
];
