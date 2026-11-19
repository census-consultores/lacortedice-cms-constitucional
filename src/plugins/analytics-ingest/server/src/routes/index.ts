import contentApi from './content-api';

const routes = {
  'content-api': {
    type: 'content-api',
    routes: [...contentApi],
  },
};

export default routes;
