export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      enabled: true,
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      origin: [
                'https://lacortedicetributaria.com',
                'https://www.lacortedicetributaria.com',
                'https://cms.lacortedicetributaria.com',
        'https://app.lacortedicetributaria.com',
        'https://admin.lacortedicetributaria.com',
        'https://lacortedice-webapp.onrender.com',
        'https://lacortedice-cms.onrender.com',
        'http://localhost:5174',
        'http://localhost:3000',
        'http://localhost:4321',
        'http://localhost:4322',
      ],
    },
  },
  //'strapi::poweredBy',
  // Candado del corpus: exige Bearer o clave interna del BFF en /graphql y
  // /api/causas|casaciones (modo observación mientras CORPUS_INTERNAL_KEY
  // no esté configurada). Ver src/middlewares/proteccion-corpus.ts.
  'global::proteccion-corpus',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      jsonLimit: '5mb',
    },
  },
  // Candado de /api/upload para usuarios no administradores: solo imágenes
  // JPG/PNG/WebP/GIF de hasta 3 MB, verificadas por la firma de los bytes.
  // Sin esto, el permiso de subida del rol `authenticated` (necesario para la
  // foto de perfil) dejaba subir HTML/JS al mismo origen que el panel.
  //
  // VA DESPUÉS DE strapi::body, no antes. Koa arma la cadena en capas: lo que
  // se registra primero corre primero, y el parseo multipart ocurre DENTRO de
  // strapi::body. Registrado antes, `ctx.request.files` siempre llegaba vacío,
  // el middleware tomaba el atajo de "no hay archivos" y dejaba pasar todo:
  // el candado existía pero no cerraba nada.
  'global::upload-seguro',
  'strapi::session',
  {
    name: 'strapi::public',
    config: {
      maxAge: 86400000, // 24 horas en milisegundos
    },
  },
  {
    name: 'strapi::favicon',
    config: {
      path: './public/favicon.ico',
    },
  },
];
