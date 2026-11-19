import { getFetchClient } from '@strapi/strapi/admin';

/**
 * Crea un nuevo abogado en el sistema
 * @param {string} inputValue - Nombre del abogado a crear
 * @returns {Promise<{value: string, label: string} | undefined>} Objeto con el ID y nombre del abogado creado, o undefined si hay error
 */
const createAbogado = async (inputValue: string): Promise<{value: string, label: string} | undefined> => {
  const { post } = getFetchClient();
  try{
    const {data} = await post('causas/crear-abogado', {
      data: {
        nombre: inputValue,
      }
    })
    return { value: data.documentId, label: data.nombre };
  }catch(error){
    throw new Error('Error al crear abogados: ' + error);
  }
}
export default createAbogado