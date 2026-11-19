/**
 * is-Authenticated policy
 */

export default (policyContext, config, { strapi }) => {
  // Add your own logic here.
  strapi.log.info('In is-Authenticated policy.');

  console.log('Estoy en la police isAuthentcated');

  if (policyContext.state.user) {
    // if a session is open
    // go to next policy or reach the controller's action
    return true;
  }

  return false;
};
