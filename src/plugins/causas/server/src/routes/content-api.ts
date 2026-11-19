export default [
  {
    method: 'GET',
    path: '/estados-de-juicio',
    handler: 'controller.getEstadosDeJuicio',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/tribunales',
    handler: 'controller.getTribunales',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/jueces',
    handler: 'controller.getJueces',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/jueces/:documentId',
    handler: 'controller.getJuecesByTribunal',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/crear-juez',
    handler: 'controller.setJuez',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/abogados',
    handler: 'controller.getAbogados',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/crear-abogado',
    handler: 'controller.setAbogado',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/entidades',
    handler: 'controller.getEntidades',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/categoria/:documentId',
    handler: 'controller.getCategoriesByEntity',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/subcategoria',
    handler: 'controller.getSubCategoriesByCategory',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/causas',
    handler: 'controller.getCausas',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/tipos-de-accion',
    handler: 'controller.getTiposDeAccion',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/decision-final',
    handler: 'controller.getDecisionFinal',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/decision-final-casacion',
    handler: 'controller.getDecisionFinalCasacion',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/causal-invocada',
    handler: 'controller.getCausalesInvocadas',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/crear-causa',
    handler: 'controller.setCausa',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/recurrente',
    handler: 'controller.getRecurrentes',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/crear-recurrente',
    handler: 'controller.setRecurrente',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/crear-casacion',
    handler: 'controller.setCasacion',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/upload',
    handler: 'controller.uploadFile',
    config: {
      policies: [],
    },
  },
];
