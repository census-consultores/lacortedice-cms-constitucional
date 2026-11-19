import { getFetchClient } from '@strapi/strapi/admin';

/**
 * Crea un nuevo recurrente en el sistema
 * @param {string} inputValue - Nombre del recurrente a crear
 * @returns {Promise<{value: string, label: string} | undefined>} Objeto con el ID y nombre del recurrente creado, o undefined si hay error
 */
const createRecurrente = async (inputValue: string) => {
  const { post } = getFetchClient();
  try{
    const { data } = await post('causas/crear-recurrente', {
      data: {
        nombre: inputValue,
      }
    })
    return { value: data.documentId, label: data.nombre };
  }catch(error){
    throw new Error('Error al crear recurrentes: ' + error);
  }
}
export default createRecurrente