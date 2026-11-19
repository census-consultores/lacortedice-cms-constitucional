import { getFetchClient } from '@strapi/strapi/admin';

/**
 * Sube un archivo al servidor usando el endpoint de upload del plugin de causas
 * @param {File | null} file - El archivo a subir. Debe ser un objeto File válido o null
 * @returns {Promise<any>} Respuesta del servidor con los datos del archivo subido
 * @throws {Error} Si no se proporciona un archivo válido o si ocurre un error durante la subida
 */
export async function uploadFile(file: File | null) {
  const { post } = getFetchClient();
    const formData = new FormData();
    if (!file) {
      throw new Error("No se ha proporcionado un archivo válido para subir.");
    }
    formData.append("files", file);//nombre de propiedad 'files' es obligatorio
    try{
      const response = await post('causas/upload', formData)
      return response.data[0];
    }catch(error: any){
      console.error("🚀 ~ media.ts:18 ~ uploadFile ~ error:", error.message)
    }
  }