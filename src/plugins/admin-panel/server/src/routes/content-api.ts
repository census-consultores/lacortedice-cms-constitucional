export default [
  {method:'GET',path:'/launch/status',handler:'launch.status',config:{policies:['plugin::admin-panel.isAdmin']}},
  {method:'POST',path:'/launch/import',handler:'launch.import',config:{policies:['plugin::admin-panel.isAdmin']}},
  {method:'POST',path:'/launch/test',handler:'launch.test',config:{policies:['plugin::admin-panel.isAdmin']}},
  {method:'POST',path:'/launch/configure',handler:'launch.configure',config:{policies:['plugin::admin-panel.isAdmin']}},

  {method:'POST',path:'/acquisition/install',handler:'acquisition.install',config:{auth:false}},
  {method:'POST',path:'/acquisition/click',handler:'acquisition.click',config:{auth:false}},
  {method:'GET',path:'/acquisition/report',handler:'acquisition.report',config:{policies:['plugin::admin-panel.isAdmin']}},
  // --- Protegidos: solo admin/superadmin ---
  {
    method: 'GET',
    path: '/users',
    handler: 'controller.getUsers',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/users/:id',
    handler: 'controller.getUserById',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/users/:id',
    handler: 'controller.updateUser',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    // Borrado duro de un usuario desde el panel admin. Elimina el registro
    // en up_users y cualquier fila colgante en analytics que dependa del
    // numeric id (case_interactions, user_tags, user_assignments, etc.).
    // Policy: isAdmin (admin O superadmin).
    method: 'DELETE',
    path: '/users/:id',
    handler: 'controller.deleteUser',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    // Crear usuario desde el panel admin. No depende de allow_register de
    // users-permissions; crea el registro con password temporal hasheado +
    // flags (userRole, mustChangePassword, confirmed, isProfileComplete=false).
    // La webapp dispara /auth/forgot-password después para enviar el link
    // de activación/clave.
    method: 'POST',
    path: '/users',
    handler: 'controller.createUser',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    /*
     * Cambio de rol. Va aparte de PUT /users/:id a propósito.
     *
     * `userRole` estaba en la lista de campos editables de updateUser(), y esa
     * ruta la protege isAdmin, que acepta admin Y superadmin: un admin común
     * podía hacerse superadmin con un PUT sobre su propio id. El handler de
     * acá exige superadmin explícitamente antes de tocar nada.
     */
    method: 'PUT',
    path: '/users/:id/role',
    handler: 'controller.updateUserRole',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    // Toggle del flag `blocked` del usuario. El handler ya existía en el
    // controller pero faltaba declarar la ruta HTTP — el botón "Bloquear /
    // Desbloquear" en /admin/usuarios/[id] llamaba a un endpoint inexistente
    // y devolvía 404 silencioso.
    method: 'PUT',
    path: '/users/:id/block',
    handler: 'controller.toggleBlockUser',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/stats',
    handler: 'controller.getStats',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  // --- Públicos: cualquier usuario autenticado ---
  {
    method: 'POST',
    path: '/activity-ping',
    handler: 'controller.activityPing',
    config: {
      policies: [],
    },
  },
  {
    // La app (PWA en el celular o binario nativo) avisa que está instalada y
    // en uso. Alimenta la columna "App" y el KPI del panel de usuarios.
    method: 'POST',
    path: '/app-instalada',
    handler: 'controller.appInstalada',
    config: {
      policies: [],
    },
  },
  {
    // Registrar un login explícito del usuario autenticado. La webapp lo
    // dispara tras /auth/local con el JWT recién emitido para que
    // lastLoginAt y loginCount dejen de quedar desactualizados (antes sólo
    // se tocaban como parche dentro de activity-ping).
    method: 'POST',
    path: '/auth/track-login',
    handler: 'controller.trackLogin',
    config: {
      policies: [],
    },
  },
  {
    method: 'PUT',
    path: '/profile',
    handler: 'controller.updateProfile',
    config: {
      policies: [],
    },
  },
  {
    /**
     * Login con Google / Apple.
     * POST /api/admin-panel/auth/social
     *
     * `auth: false` porque justamente sirve para NO tener sesión todavía. La
     * seguridad no está en el gate de Strapi sino en verificar la firma del
     * `id_token` contra el JWKS del proveedor, más emisor, audiencia,
     * expiración y correo verificado (ver services/social-auth.ts). Aceptar el
     * token sin eso permitiría entrar como cualquiera.
     */
    method: 'POST',
    path: '/auth/social',
    handler: 'socialAuth.social',
    config: {
      auth: false,
      policies: [],
    },
  },

  {
    /**
     * Login con Google desde la app de ESCRITORIO.
     * POST /api/admin-panel/auth/google-escritorio
     *
     * Recibe el `code` que Google dejo en el loopback de la app y lo canjea
     * aca, donde vive el secreto del cliente. Despues delega en el mismo
     * `social` de siempre, asi que la verificacion del token es identica.
     *
     * `auth: false` por lo mismo que el de arriba: existe precisamente para
     * quien todavia no tiene sesion. Lo que lo protege es PKCE, la validacion
     * del redirect loopback y, al final, la verificacion del id_token.
     */
    method: 'POST',
    path: '/auth/google-escritorio',
    handler: 'socialAuth.googleEscritorio',
    config: {
      auth: false,
      policies: [],
    },
  },

  {
    // Borrado de la PROPIA cuenta, iniciado por el usuario autenticado.
    //
    // Obligatorio para publicar en App Store: la Guideline 5.1.1(v) exige que
    // toda app que permite crear cuenta ofrezca borrarla desde dentro de la
    // app. Google Play pide lo equivalente. Sin esto el rechazo es automático,
    // independiente de cualquier otro criterio.
    //
    // Distinto de DELETE /users/:id, que es la vía del panel admin y que
    // deliberadamente BLOQUEA el self-delete. Acá el self-delete es el punto.
    method: 'POST',
    path: '/account/delete',
    handler: 'controller.deleteOwnAccount',
    config: {
      policies: [],
    },
  },

  // --- Sprint 12 · recuperación + cambio de contraseña -----------------------

  /**
   * Endpoint PÚBLICO de recuperación de contraseña.
   * POST /api/admin-panel/auth/recuperar
   * - auth: false → cualquiera puede llamarlo, sin JWT.
   * - Anti-enumeración: siempre responde 200 con mensaje uniforme.
   */
  {
    method: 'POST',
    path: '/auth/recuperar',
    handler: 'recovery.request',
    config: {
      auth: false,
      policies: [],
    },
  },

  /**
   * Endpoint AUTENTICADO de cambio de contraseña.
   * POST /api/admin-panel/auth/change-password
   * - Requiere JWT (users-permissions). La permission para la role
   *   "authenticated" se concede en bootstrap.ts.
   */
  {
    method: 'POST',
    path: '/auth/change-password',
    handler: 'changePassword.changePassword',
    config: {
      policies: [],
    },
  },

  // --- Sprint 12b · rediseño por token -------------------------------------

  /**
   * Inspeccionar un token de recuperación sin consumirlo.
   * POST /api/admin-panel/auth/recuperar/inspeccionar   body: { token }
   * Respuesta: { valid: boolean, reason?: 'invalid'|'expired', email?, expiresAt? }
   * Se usa desde la webapp al cargar /recuperar/confirmar para mostrar
   * el email correcto y decidir si pintar el formulario o un "link expiró".
   */
  {
    method: 'POST',
    path: '/auth/recuperar/inspeccionar',
    handler: 'confirmReset.inspect',
    config: {
      auth: false,
      policies: [],
    },
  },

  /**
   * Confirmar recuperación de contraseña.
   * POST /api/admin-panel/auth/recuperar/confirmar  body: { token, newPassword }
   * Si el token es válido, setea la nueva contraseña y lo invalida.
   * La contraseña NO se cambia nunca antes de este paso.
   */
  {
    method: 'POST',
    path: '/auth/recuperar/confirmar',
    handler: 'confirmReset.confirm',
    config: {
      auth: false,
      policies: [],
    },
  },

  /**
   * Formulario de contacto de la landing pública.
   * POST /api/admin-panel/contacto/send
   * - auth: false → cualquiera puede llamarlo.
   * - Rate-limit en memoria por IP (3 envíos / 10 min) y soporte de
   *   header Idempotency-Key — todo controlado dentro del controller.
   */
  {
    method: 'POST',
    path: '/contacto/send',
    handler: 'contacto.send',
    config: {
      auth: false,
      policies: [],
    },
  },
  /**
   * Baja de los correos masivos — PÚBLICO a propósito.
   *
   * Lo llama /baja de la aplicación, que a su vez atiende el enlace del pie y
   * el botón «Cancelar suscripción» de Gmail y Outlook. Exigir sesión aquí
   * empujaría a la gente a marcar spam en vez de darse de baja, que es el
   * daño que este endpoint existe para evitar. Autoriza el HMAC del correo,
   * no la sesión: sin esa firma no se da de baja a nadie.
   */
  {
    method: 'POST',
    path: '/baja',
    handler: 'baja.registrar',
    config: {
      auth: false,
      policies: [],
    },
  },
  /**
   * Relaunch broadcast — admin only.
   * GET  /broadcast/relaunch/preview  → cuántos usuarios recibirían el push
   * POST /broadcast/relaunch          → dispara el envío (body: { dryRun?: boolean })
   */
  {
    method: 'GET',
    path: '/broadcast/relaunch/preview',
    handler: 'broadcast.preview',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/broadcast/relaunch',
    handler: 'broadcast.sendRelaunch',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  /**
   * Lanzamiento de la app nativa — admin only.
   * GET  /broadcast/app-lanzamiento/preview → cuántos correos y de qué audiencia
   * POST /broadcast/app-lanzamiento         → envía
   *        body: { dryRun?, soloAudiencia?: 'cuenta_activa'|'usuario_enviado',
   *                soloA?: string[] }   ← soloA = modo prueba a buzones propios
   */
  {
    method: 'GET',
    path: '/broadcast/app-lanzamiento/preview',
    handler: 'broadcast.previewAppLaunch',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/broadcast/app-lanzamiento',
    handler: 'broadcast.sendAppLaunch',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  /**
   * Invitación a profesionales del derecho tributario — admin only.
   * Lista estática (data/directorio-profesionales.ts), no base de datos.
   * GET  /broadcast/profesionales/preview → cuántos quedan tras excluir a los
   *        que ya reciben el correo de lanzamiento
   * GET  /broadcast/profesionales/vista   → HTML renderizado (?id= elige a quién)
   * POST /broadcast/profesionales         → envía
   *        body: { dryRun?, soloA?: string[] }   ← soloA = modo prueba
   */
  /**
   * Control de las campañas a cuentagotas — admin only.
   * GET  /broadcast/estado  → cuántos faltan, ritmo y si está encendida
   * POST /broadcast/campana → encender, apagar o cambiar el ritmo
   * POST /broadcast/tanda   → mandar una tanda ahora, sin esperar al cron
   */
  {
    method: 'GET',
    path: '/broadcast/resultados',
    handler: 'resultadosCorreo.resultados',
    config: { policies: ['plugin::admin-panel.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/broadcast/estado',
    handler: 'broadcast.estadoCampanas',
    config: { policies: ['plugin::admin-panel.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/broadcast/campana',
    handler: 'broadcast.configurarCampana',
    config: { policies: ['plugin::admin-panel.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/broadcast/tanda',
    handler: 'broadcast.tandaAhora',
    config: { policies: ['plugin::admin-panel.isAdmin'] },
  },
  {
    method: 'GET',
    path: '/broadcast/profesionales/preview',
    handler: 'broadcast.previewProfesionales',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/broadcast/profesionales/vista',
    handler: 'broadcast.vistaProfesionales',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/broadcast/profesionales',
    handler: 'broadcast.sendProfesionales',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  /**
   * Abogados del Ranking Legal Ecuador — admin only.
   * Lista estática (data/ranking-legal.ts), separada de la de profesionales
   * para poder medirlas y encenderlas por separado.
   */
  {
    method: 'GET',
    path: '/broadcast/ranking/preview',
    handler: 'broadcast.previewRanking',
    config: { policies: ['plugin::admin-panel.isAdmin'] },
  },
  {
    method: 'POST',
    path: '/broadcast/ranking',
    handler: 'broadcast.sendRanking',
    config: { policies: ['plugin::admin-panel.isAdmin'] },
  },

  // --- CRUD de contenido jurídico (admin only) ------------------------------
  //
  // Reemplaza el flujo donde la webapp pegaba directo a `/causas`, `/casaciones`
  // y catálogos con el JWT del admin (lo que obligaba a abrir create/update/delete
  // en el rol Authenticated). Ahora esos endpoints viven aquí con policy isAdmin
  // y el rol Authenticated queda con solo find/findOne para lectura pública.
  //
  // El :collection es el pluralName del content-type (ej: "causas", "casaciones",
  // "jueces"). La whitelist está en content.ts → COLLECTION_MAP.
  {
    method: 'POST',
    path: '/content/:collection',
    handler: 'content.createContent',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/content/:collection/:documentId',
    handler: 'content.updateContent',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'DELETE',
    path: '/content/:collection/:documentId',
    handler: 'content.deleteContent',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },

  // --- Sinónimos / relaciones del buscador (admin only) --------------------
  //
  // CRUD de la tabla cruda `sinonimos` (NO content-type Strapi). Alimenta la
  // expansión de búsqueda del webapp (impuesto→tributo) y las sugerencias de
  // términos relacionados. Gestionado desde /admin/trazabilidad/sinonimos.
  {
    method: 'GET',
    path: '/sinonimos',
    handler: 'sinonimos.list',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/sinonimos',
    handler: 'sinonimos.create',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'PUT',
    path: '/sinonimos/:id',
    handler: 'sinonimos.update',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'DELETE',
    path: '/sinonimos/:id',
    handler: 'sinonimos.remove',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },

  // --- Upload management (admin only) --------------------------------------
  //
  // Endpoint para borrar archivos del Upload library desde la webapp admin.
  // No usamos el `/api/upload/files/:id` nativo de Strapi porque eso requiere
  // que el rol Authenticated tenga `plugin::upload.destroy`, y abrir ese
  // permiso permitiría a cualquier usuario logueado borrar cualquier archivo.
  // Aquí lo protegemos con la policy isAdmin (admin/superadmin), igual que el
  // CRUD de contenido jurídico arriba.
  {
    // Subir archivos al Upload library (PDFs de sentencia). Wrap del endpoint
    // nativo /api/upload con policy isAdmin para que el rol Authenticated no
    // necesite `plugin::upload.upload`. URL cliente: `/api/admin-panel/files`.
    method: 'POST',
    path: '/files',
    handler: 'uploadAdmin.uploadFile',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    // Borrar archivo del Upload library. NB: el path es `/files/:id` (sin
    // prefijo `upload/`) para evitar colisión con el namespace del plugin
    // upload nativo. URL cliente: `/api/admin-panel/files/:id`.
    method: 'DELETE',
    path: '/files/:id',
    handler: 'uploadAdmin.deleteFile',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },

  // --- Sprint registro-whitelist · auto-registro estudiantil ---------------
  //
  // 4 endpoints PÚBLICOS (auth: false) que conducen el flujo de registro:
  // verificar email → completar form → inspeccionar token → confirmar cuenta.
  // 6 endpoints ADMIN (isAdmin) para gestión de la whitelist desde el panel.

  // PÚBLICOS — sin auth, protección por rate-limit (webapp) + anti-enumeración
  // (controller). Detalle en controllers/registration.ts.
  {
    method: 'POST',
    path: '/registro/verificar-correo',
    handler: 'registration.verificarCorreo',
    config: {
      auth: false,
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/registro/completar',
    handler: 'registration.completar',
    config: {
      auth: false,
      policies: [],
    },
  },
  // ── Premium: compra In-App (Apple) y créditos de Jurimetría IA ──────────
  // auth por defecto (token de usuario requerido).
  {
    method: 'POST',
    path: '/premium/iap/activar',
    handler: 'premium.iapActivar',
    config: { policies: [] },
  },
  {
    method: 'GET',
    path: '/premium/jurimetria/saldo',
    handler: 'premium.jurimetriaSaldo',
    config: { policies: [] },
  },
  {
    method: 'POST',
    path: '/premium/jurimetria/consumir',
    handler: 'premium.jurimetriaConsumir',
    config: { policies: [] },
  },

  // OTP de registro: envía/reenvía el código de 6 dígitos al correo.
  // Rate-limit propio en el controller (3 envíos / 15 min, 45s entre envíos)
  // además del rate-limit por IP del BFF.
  {
    method: 'POST',
    path: '/registro/enviar-codigo',
    handler: 'registration.enviarCodigo',
    config: {
      auth: false,
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/registro/confirmar/inspeccionar',
    handler: 'registration.inspeccionar',
    config: {
      auth: false,
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/registro/confirmar',
    handler: 'registration.confirmar',
    config: {
      auth: false,
      policies: [],
    },
  },
  // Self-service de reenvío cuando el link expiró o no llegó al usuario.
  // Rate-limited (10 min) + anti-enumeración (respuesta uniforme).
  {
    method: 'POST',
    path: '/registro/reenviar-verificacion',
    handler: 'registration.reenviarVerificacion',
    config: {
      auth: false,
      policies: [],
    },
  },

  // ADMIN — gestión de la whitelist desde el panel.
  {
    method: 'POST',
    path: '/invited-emails/bulk',
    handler: 'invitedEmails.bulk',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/invited-emails',
    handler: 'invitedEmails.create',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/invited-emails',
    handler: 'invitedEmails.list',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/invited-emails/stats',
    handler: 'invitedEmails.stats',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'DELETE',
    path: '/invited-emails/:id',
    handler: 'invitedEmails.delete',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/invited-emails/:id/resend',
    handler: 'invitedEmails.resend',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/invited-emails/:id/resend-welcome',
    handler: 'invitedEmails.resendWelcome',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/invited-emails/bulk-resend-welcome',
    handler: 'invitedEmails.bulkResendWelcome',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'GET',
    path: '/invited-emails/bulk-resend-welcome/status',
    handler: 'invitedEmails.bulkResendWelcomeStatus',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  // Reenvío programado de bienvenida (usuarios que nunca han entrado)
  {
    method: 'GET',
    path: '/reenvio-bienvenida',
    handler: 'reenvioBienvenida.estado',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/reenvio-bienvenida/programar',
    handler: 'reenvioBienvenida.programar',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
  {
    method: 'POST',
    path: '/reenvio-bienvenida/cancelar',
    handler: 'reenvioBienvenida.cancelar',
    config: {
      policies: ['plugin::admin-panel.isAdmin'],
    },
  },
];
