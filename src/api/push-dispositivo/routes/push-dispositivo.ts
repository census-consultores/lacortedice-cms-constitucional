/**
 * Router custom de notificaciones push. Sin CRUD genérico: todo scoped al
 * usuario autenticado en el controller.
 *
 * Las actions se conceden al rol `authenticated` en src/index.ts — sin eso
 * Strapi responde 403 mudo aunque el JWT sea válido.
 */
export default {
	routes: [
		{
			// Registrar (o reactivar) el token del dispositivo actual.
			method: 'POST',
			path: '/push/registrar',
			handler: 'push-dispositivo.registrar',
			config: { policies: [] }
		},
		{
			// Dar de baja el token (cierre de sesión en el dispositivo).
			method: 'POST',
			path: '/push/baja',
			handler: 'push-dispositivo.baja',
			config: { policies: [] }
		},
		{
			method: 'GET',
			path: '/push/preferencias',
			handler: 'push-dispositivo.preferencias',
			config: { policies: [] }
		},
		{
			method: 'PUT',
			path: '/push/preferencias',
			handler: 'push-dispositivo.guardarPreferencias',
			config: { policies: [] }
		},
		{
			// Silenciar / des-silenciar un tema del Debate para este usuario.
			method: 'POST',
			path: '/push/silenciar-tema',
			handler: 'push-dispositivo.silenciarTema',
			config: { policies: [] }
		},
		{
			// Bandeja de notificaciones del usuario (últimas 50 + no leídas).
			method: 'GET',
			path: '/push/notificaciones',
			handler: 'push-dispositivo.notificaciones',
			config: { policies: [] }
		},
		{
			// Marcar notificaciones como leídas (por ids o todas).
			method: 'POST',
			path: '/push/notificaciones-leidas',
			handler: 'push-dispositivo.marcarLeidas',
			config: { policies: [] }
		},
		{
			// Push de prueba a los dispositivos del propio usuario (solo admin).
			method: 'POST',
			path: '/push/prueba',
			handler: 'push-dispositivo.prueba',
			config: { policies: [] }
		}
	]
};
