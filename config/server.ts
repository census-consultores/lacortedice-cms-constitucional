import cronTasks from './cron';

export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  //HABILITAR EN PRODUCCION
  url: env('PUBLIC_URL'),
  proxy: true,
  cron: {
    enabled: env.bool('CRON_ENABLED', false),
    // Strapi 5 requiere que las tareas se pasen explícitamente aquí.
    // Sin esto, config/cron.ts se ignora.
    tasks: cronTasks,
  },
});
