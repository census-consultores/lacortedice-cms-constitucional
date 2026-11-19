import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getEstadosDeJuicio(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').estadosDeJuicio();
  },
  async getTribunales(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').tribunales();
  },
  async getJueces(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').allJueces();
  },
  async getJuecesByTribunal(ctx) {
    const { documentId } = ctx.params;
    ctx.body = await strapi.plugin('causas').service('service').jueces(documentId);
  },
  async setJuez(ctx) {
    const { data } = ctx.request.body;
    ctx.body = await strapi.plugin('causas').service('service').setJuez(data);
  },
  async getAbogados(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').abogados();
  },
  async setAbogado(ctx) {
    const { data } = ctx.request.body;
    ctx.body = await strapi.plugin('causas').service('service').setAbogado(data);
  },
  async getEntidades(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').entidades();
  },
  async getCategoriesByEntity(ctx) {
    const { documentId } = ctx.params;
    ctx.body = await strapi.plugin('causas').service('service').categorias(documentId);
  },
  async getSubCategoriesByCategory(ctx) {
    const { categorias } = ctx.request.query;
    if (!Array.isArray(categorias)) {
      ctx.status = 400;
      ctx.body = { data: { error: 'Faltan parámetros requeridos: categorias[]' }};
      return;
    }
    ctx.body = await strapi.plugin('causas').service('service').subCategorias(categorias);
  },
  async getCausas(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').causas();
  },
  async setCausa(ctx) {
    const { data } = ctx.request.body;
    try {
      ctx.body = await strapi.plugin('causas').service('service').setCausa(data);
    } catch (err: any) {
      strapi.log.error('[plugin.causas.setCausa] failed', {
        error: err?.message,
        juicio: data?.juicio,
        causa_tribunal: data?.causa_tribunal
      });
      ctx.throw(500, err?.message || 'Error al crear causa');
    }
  },
  async getTiposDeAccion(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').tiposDeAccion();
  },
  async getDecisionFinal(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').decisionFinal();
  },
  async getDecisionFinalCasacion(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').decisionFinalCasacion();
  },
  async getCausalesInvocadas(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').causalesInvocadas();
  },
  async getRecurrentes(ctx) {
    ctx.body = await strapi.plugin('causas').service('service').recurrentes();
  },
  async setRecurrente(ctx) {
    const { data } = ctx.request.body;
    ctx.body = await strapi.plugin('causas').service('service').setRecurrente(data);
  },
  async setCasacion(ctx) {
      const {data} = ctx.request.body;
      ctx.body = await strapi.plugin('causas').service('service').setCasacion(data); 
  },
  async uploadFile(ctx) {
      const { files } = ctx.request.files;
      ctx.body = await strapi.plugin('causas').service('service').uploadFile(files);
  }
});

export default controller;
