import { getFetchClient } from '@strapi/strapi/admin';

/**
 * Crea una nueva causa en el sistema
 * @param {CreateInstancia} body - Datos de la causa a crear
 * @returns {Promise<any | undefined>} Respuesta con los datos de la causa creada, o undefined si hay error
 */
const createInstancia = async (
  body: CreateInstancia | CreateInstanciaSS
): Promise<any | undefined> => {
  const { post } = getFetchClient();
  try {
    const { data } = await post('causas/crear-causa', {
      data: body,
    });
    return data;
  } catch (error: any) {
    throw new Error('Error al crear la instancia: ' + error);
  }
};
export default createInstancia;
