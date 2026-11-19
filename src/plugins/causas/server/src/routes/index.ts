'use strict';
import admin from './admin-api';
import contentApi from './content-api';

const routes = {
  'content-api': {
    type: 'content-api',
    routes: [...contentApi],
  },
  admin: {
    type: 'admin',
    routes: [...admin],
  },
};

export default routes;
