'use strict';
import contentApi from './content-api';
import adminApi from './admin-api';

const routes = {
  'content-api': {
    type: 'content-api',
    routes: [...contentApi],
  },
  admin: {
    type: 'admin',
    routes: [...adminApi],
  },
};

export default routes;
