/**
 * isAdmin policy - verifies user has admin or superadmin role
 */
export default async (policyContext, config, { strapi }) => {
  const user = policyContext.state.user;
  if (!user) return false;

  const fullUser = await strapi.db
    .query('plugin::users-permissions.user')
    .findOne({
      where: { id: user.id },
      select: ['id', 'userRole'],
    });

  if (!fullUser) return false;

  const allowedRoles = ['admin', 'superadmin'];
  return allowedRoles.includes(fullUser.userRole);
};
