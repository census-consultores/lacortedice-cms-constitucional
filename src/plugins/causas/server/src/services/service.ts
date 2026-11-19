import type { Core } from '@strapi/strapi';
import {CNJ_ID} from '../../../admin/src/config/constants';

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  async tribunales() {
    return await strapi.documents('api::tribunal.tribunal').findMany({
      fields: ['documentId', 'nombre'],
      filters: {
        documentId: {
          $ne: CNJ_ID
        }
      }
    });
  },
  async allJueces() {
    return await strapi.documents('api::juez.juez').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async jueces(documentId_tribunal: string) {
    return await strapi.documents('api::juez.juez').findMany({
      filters: { juez_tribunales: { documentId: { $eq: documentId_tribunal } } },
      fields: ['documentId', 'nombre'],
    });
  },
  async setJuez(data) {
    // Primero buscar si existe un juez con el mismo nombre
    const existingJuez = await strapi.documents('api::juez.juez').findFirst({
      filters: {
        nombre: {$eq:data.nombre}
      }
    });

    if (existingJuez) {
      // Si existe, solo actualizar juez_tribunales
      return await strapi.documents('api::juez.juez').update({
        documentId: existingJuez.documentId,
        data,
        status: 'published'
      });
    }

    // Si no existe, crear nuevo juez
    return await strapi.documents('api::juez.juez').create({
      data,
      status: 'published',
    });
  },
  async estadosDeJuicio() {
    const data = await strapi.documents('api::estado-del-juicio.estado-del-juicio').findMany({
      fields: ['documentId', 'nombre'],
    });
    return data;
  },
  async abogados() {
    return await strapi.documents('api::abogado.abogado').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async setAbogado(data) {
    return await strapi.documents('api::abogado.abogado').create({
      data,
      status: 'published',
    });
  },
  async entidades() {
    return await strapi.documents('api::entidad.entidad').findMany({
      fields: ['documentId', 'nombre', 'sigla'],
    });
  },
  async categorias(documentId_entidad: string) {
    const categories = await strapi.documents('api::categoria.categoria').findMany({
      filters: { categoria_padre: null, entidad: { documentId: { $eq: documentId_entidad } } },
      fields: ['documentId', 'nombre'],
    });
    return categories;
  },
  async subCategorias(categories: string[]) {
    const subcategories = await Promise.all(
      categories?.map(async (category) => {
        const children = await strapi.entityService.findMany('api::categoria.categoria', {
          filters: {
            categoria_padre: {
              documentId: { $eq: category },
            },
          },
          fields: ['documentId', 'nombre'],
        });
        return children;
      })
    );
    return subcategories;
  },
  async causas() {
    return await strapi.documents('api::causa.causa').findMany({
      fields: ['documentId', 'juicio' ],
      populate: {
        causa_tribunal: {
          fields: ['documentId', 'nombre']
        },
      }
    });
  },
  async setCausa(data: any) {
    const causa = await strapi.documents('api::causa.causa').create({
      data,
      status: 'published',
    });
    const juicio = await strapi.documents('api::causa.causa').findOne({
      documentId:causa.documentId,
      populate: {
        causa_tribunal: {
          fields: ['documentId', 'nombre']
        },
      },
      fields:['documentId', 'juicio' ],
    });
    strapi.log.info('[plugin.causas.setCausa] created', {
      documentId: causa.documentId,
      juicio: causa.juicio
    });
    return {
      ...causa,
      causa_tribunal: juicio.causa_tribunal
    };
  },
  async tiposDeAccion() {
    return await strapi.documents('api::tipo-de-accion.tipo-de-accion').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async decisionFinal() {
    return await strapi.documents('api::decision-final.decision-final').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async decisionFinalCasacion() {
    return await strapi.documents('api::decision-final-casacion.decision-final-casacion').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async causalesInvocadas() {
    return await strapi.documents('api::causal-invocada.causal-invocada').findMany({
      fields: ['documentId', 'nombre'],
      //orderBy: { nombre: 'asc' },
    });
  },
  async recurrentes() {
    return await strapi.documents('api::recurrente.recurrente').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async setRecurrente(data) {
    return await strapi.documents('api::recurrente.recurrente').create({
      data,
      status: 'published',
    });
  },
  async casaciones() {
    return await strapi.documents('api::casacion.casacion').findMany({
      fields: ['documentId', 'nombre'],
    });
  },
  async setCasacion(data: any) {
    return await strapi.documents('api::casacion.casacion').create({
      data,
      status: 'published',
    });
  },
  async uploadFile(file: any) {
    try {
      if (!file) {
        throw new Error("No se ha proporcionado un archivo v\u00e1lido para subir.");
      }
      const uploadedFile = await strapi.plugins.upload.services.upload.upload({
        data: {},
        files: file,
      });

      return uploadedFile;
    } catch (error: any) {
      console.error("Error al subir archivo:", error.message);
      throw new Error('Error al subir el archivo: ' + error.message);
    }
  },
})

export default service;
