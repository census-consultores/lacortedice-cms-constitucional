import { useFetchClient } from '@strapi/strapi/admin';

/**
 * Hook personalizado para obtener y filtrar opciones para componentes de selección
 * @returns {Object} Objeto con la función getOptions para cargar opciones
 * @returns {Function} getOptions - Función que retorna un array de opciones filtradas
 * @example
 * const { getOptions } = useGetOptions();
 * // Usar en un componente AsyncSelect
 * <AsyncSelect loadOptions={getOptions('tribunales')} />
 */
export const useGetOptions = () => {
  const { get } = useFetchClient();

  /**
   * Crea una función que obtiene y filtra opciones para componentes de selección
   * @param {string} endpoint - Endpoints disponibles:
   * - `tribunales`: Lista de tribunales
   * - `jueces`: Lista de jueces (requiere ID del tribunal)
   * - `estados-de-juicio`: Estados posibles de un juicio
   * - `abogados`: Lista de abogados
   * - `recurrentes`: Lista de recurrentes
   * - `tipos-de-accion`: Tipos de acción legal
   * - `decisiones`: Decisiones posibles del tribunal
   * - `categorias`: Categorías de causas
   * - `subcategorias`: Subcategorías de causas
   * @param {string} [id=''] - ID opcional para filtrar las opciones
   * @returns {Function} Función asíncrona que recibe un valor de búsqueda y retorna opciones filtradas
   * @example
   * const loadOptions = getOptions('tribunales', '123');
   * const options = await loadOptions('buscar');
   */
  const getOptions = (endpoint: string, id = '') => {
    return async (inputValue: string) => {
      try {
        const { data } = await get(`/causas/${endpoint}/${id}`);
        if (!data) throw new Error('No hubo resultados');

        const options = data
          .filter((item: ResponseToOptions) => {
            const text = item.nombre || item.juicio || '';
            return text.toLowerCase().includes(inputValue.toLowerCase());
          })
          .map((item: ResponseToOptions) => {
            const labelText = item.nombre || item.juicio || '';
            return {
              id: item.id,
              value: item.documentId,
              label: item.sigla ? `${item.sigla} - ${labelText}` : labelText,
            };
          });
        return options;
      } catch (error) {
        console.error('Error fetching options:', error);
        return [];
      }
    };
  };

  return { getOptions };
};
