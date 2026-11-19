import { getFetchClient } from '@strapi/strapi/admin';

const createCasacion = async (body: CreateCasacion): Promise<any | undefined> => {
    const { post } = getFetchClient();
    try{
        const { data } = await post('causas/crear-casacion', {
            data: body
        });
        return data;
    }catch(error){
        throw new Error('Error al crear casación: ' + error);
    }
}
export default createCasacion;