/**
 * Policy: isAdmin
 *
 * Allows the route only when the authenticated user has role 'admin' or 'superadmin'.
 * Mirrors the policy used by the existing admin-panel plugin.
 */
export default async (policyContext: any, _config: any, { strapi }: any) => {
  const user = policyContext.state?.user;
  if (!user) {
    strapi.log.warn('[analytics-ingest.isAdmin] no user in context');
    return false;
  }

  // Cargar el usuario completo con su rol
  const fullUser = await strapi
    .query('plugin::users-permissions.user')
    .findOne({
      where: { id: user.id },
      populate: ['role'],
    });

  if (!fullUser) return false;

  const userRole = (fullUser.userRole || fullUser.role?.name || '').toLowerCase();
  const allowed = ['admin', 'superadmin'];
  return allowed.includes(userRole);
};
