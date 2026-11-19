/**
 * invited-email routes
 *
 * Intencionalmente vacío: no exponemos CRUD por content-api ni rutas custom
 * aquí. Toda la operación pasa por el plugin admin-panel:
 *   - Endpoints públicos (registro/...) en admin-panel/.../controllers/registration.ts
 *   - Endpoints admin (invited-emails/...) en admin-panel/.../controllers/invited-emails.ts
 *
 * Si exponiéramos GET /api/invited-emails con el factory por defecto,
 * cualquier authenticated podría enumerar la whitelist. Evitamos eso.
 */

export default {
  routes: [],
};
