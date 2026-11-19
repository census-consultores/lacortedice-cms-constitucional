import { getFetchClient } from '@strapi/strapi/admin';

/**
 * Crea un nuevo juez en el sistema asociado a un tribunal específico
 * @param {string} inputValue - Nombre del juez a crear
 * @param {string} tribunalID - ID del tribunal al que se asociará el juez
 * @returns {Promise<{value: string, label: string} | undefined>} Objeto con el ID y nombre del juez creado, o undefined si hay error
 */
const createJuez = async (inputValue: string, tribunalID: string) => {
  const { post } = getFetchClient();
  try{
    const { data } = await post('causas/crear-juez', {
      data: {
        nombre: inputValue,
        juez_tribunales: {
         connect:[tribunalID]
        }
      },
    })
    return { value: data.documentId, label: data.nombre };
  }catch(error){
    throw new Error('Error al crear jueces: ' + error);
  }
}
export default createJuez