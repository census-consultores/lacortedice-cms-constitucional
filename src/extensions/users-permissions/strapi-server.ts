/**
 * Overrides the users-permissions auth controller via Strapi's extension
 * mechanism so that lastLoginAt / lastActiveAt / loginCount are reliably
 * tracked every time a user authenticates through /auth/local.
 *
 * The previous approach (monkey-patching the controller in bootstrap)
 * does not persist across all execution paths in Strapi 5 because the
 * auth controller is resolved lazily; the extension folder is the
 * officially supported way to customise users-permissions.
 *
 * Sprint 12 addition:
 *   - Surfaces `mustChangePassword` / `passwordChangedAt` on body.user so
 *     the webapp can force a password change flow.
 *   - Enforces 72h TTL on temporary passwords: if the user still has
 *     mustChangePassword=true and more than 72 hours have elapsed since
 *     `passwordResetRequestedAt` (or, as a fallback, `createdAt`), the
 *     login is rejected with 403 `TemporaryPasswordExpired` so the user
 *     is forced to go through /recuperar again.
 */

const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

export default (plugin: any) => {
	const originalAuthCallback = plugin.controllers.auth.callback;

	plugin.controllers.auth.callback = async (ctx: any, next: any) => {
		await originalAuthCallback(ctx, next);

		const body = ctx.response?.body as any;
		if (ctx.response?.status === 200 && body?.user?.id) {
			const userId = body.user.id;
			try {
				const user = await strapi.db
					.query('plugin::users-permissions.user')
					.findOne({ where: { id: userId } });

				// --- Sprint 12 · enforce 72h TTL on temporary passwords ----------
				if (user?.mustChangePassword) {
					const reference =
						user.passwordResetRequestedAt ?? user.createdAt ?? null;
					if (reference) {
						const elapsed = Date.now() - new Date(reference).getTime();
						if (elapsed > TEMP_PASSWORD_TTL_MS) {
							ctx.status = 403;
							ctx.body = {
								error: {
									status: 403,
									name: 'TemporaryPasswordExpired',
									message:
										'Tu contraseña temporal ha expirado. Solicita una nueva desde la pantalla de recuperación.'
								}
							};
							return;
						}
					}
				}

				const now = new Date();
				await strapi.db.query('plugin::users-permissions.user').update({
					where: { id: userId },
					data: {
						lastLoginAt: now,
						lastActiveAt: now,
						loginCount: (user?.loginCount || 0) + 1
					}
				});

				// Surface extended fields on the login response so the webapp
				// can persist them in the session cookie.
				body.user.userRole = user?.userRole || 'user';
				body.user.isProfileComplete = user?.isProfileComplete || false;
				body.user.picture = user?.picture || null;
				body.user.mustChangePassword = user?.mustChangePassword || false;
				body.user.passwordChangedAt = user?.passwordChangedAt || null;
			} catch (err) {
				strapi.log.error('Error updating login tracking:', err);
			}
		}
	};

	return plugin;
};
