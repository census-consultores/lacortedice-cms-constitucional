export default [
  {
    method: 'GET',
    path: '/users',
    handler: 'controller.getUsers',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/users/:id',
    handler: 'controller.getUserById',
    config: {
      policies: [],
    },
  },
  {
    method: 'PUT',
    path: '/users/:id',
    handler: 'controller.updateUser',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/stats',
    handler: 'controller.getStats',
    config: {
      policies: [],
    },
  },

  // --- Sprint 12 · recuperación + cambio de contraseña -----------------------

  /**
   * Endpoint PÚBLICO de recuperación de contraseña.
   * Expuesto como POST /api/admin-panel/auth/recuperar.
   * - auth: false → cualquiera puede llamarlo.
   * - Anti-enumeración: siempre responde 200 con mensaje uniforme.
   * - Rate-limit en memoria: 60s por email.
   * - Si el email existe, genera temp password, la hashea, setea
   *   mustChangePassword=true, envía correo.
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
   * Expuesto como POST /api/admin-panel/auth/change-password.
   * - Requiere JWT (users-permissions).
   * - Verifica contraseña actual, valida la nueva contra policy,
   *   actualiza password + passwordChangedAt + mustChangePassword=false.
   */
  {
    method: 'POST',
    path: '/auth/change-password',
    handler: 'changePassword.changePassword',
    config: {
      policies: [],
    },
  },
];
