export default ({ env }) => ({
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.titan.email'),
        port: env.int('SMTP_PORT', 465),
        secure: env.bool('SMTP_SECURE', true), // true para 465, false para 587
        auth: {
          user: env('SMTP_USER'),
          pass: env('SMTP_PASS'),
        },
        // Añadimos configuración de TLS para mayor compatibilidad con Titan
        tls: {
          rejectUnauthorized: env.bool('SMTP_REJECT_UNAUTHORIZED', true),
        },
      },
      settings: {
        defaultFrom: `"${env('SMTP_FROM_NAME', 'La Corte Dice Tributaria')}" <${env('SMTP_FROM_EMAIL', 'info@lacortedicetributaria.com')}>`,
        defaultReplyTo: env('SMTP_FROM_EMAIL', 'info@lacortedicetributaria.com'),
      },
    },
  },
  'users-permissions': {
    config: {
      jwtSecret: env('JWT_SECRET'),
    },
  },
  graphql: {
    enabled: true,
    config: {
      endpoint: '/graphql',
      shadowCRUD: true,
      landingPage: (strapi) => {
        if (env('NODE_ENV') !== 'production') {
          return true;
        } else {
          return false;
        }
      },
      // Hardening tras outage 2026-04-20 (POST /graphql tardando 4-6 min y
      // pool Postgres agotado). Capamos profundidad y número de items para
      // evitar queries N+1 monstruosas y ataques de complejidad. En prod
      // ocultamos introspección porque el frontend no la necesita y es el
      // primer vector de abuso.
      defaultLimit: env.int('GRAPHQL_DEFAULT_LIMIT', 25),
      maxLimit: env.int('GRAPHQL_MAX_LIMIT', 100),
      depthLimit: env.int('GRAPHQL_DEPTH_LIMIT', 7),
      apolloServer: {
        introspection: env.bool('GRAPHQL_INTROSPECTION', env('NODE_ENV') !== 'production'),
      },
    },
  },
  causas: {
    enabled: true,
    resolve: './src/plugins/causas',
  },
  'admin-panel': {
    enabled: true,
    resolve: './src/plugins/admin-panel',
  },
  'analytics-ingest': {
    // Plugin siempre cargado. El bootstrap lee ANALYTICS_INGEST_ENABLED
    // para decidir si habilita o no la ingesta/registra permisos.
    enabled: true,
    resolve: './src/plugins/analytics-ingest',
  },
});
