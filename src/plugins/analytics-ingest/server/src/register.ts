import type { Core } from '@strapi/strapi';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  // register phase — nada por ahora
  strapi.log.info('[analytics-ingest] plugin registered');
};

export default register;
