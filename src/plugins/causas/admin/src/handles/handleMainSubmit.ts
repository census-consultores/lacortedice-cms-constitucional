import { FormikHelpers } from 'formik';
import { createInstancia, createCasacion } from '../services';
import { uploadFile } from '../services/media';
/**
 * Maneja el envío del formulario principal para los procesos de "instancia" (juicio) o "casación" (apelación).
 *
 * Dependiendo de la pestaña activa, esta función procesa los valores del formulario como `FormValuesJuicio` o `FormValuesCasacion`,
 * construye el objeto de datos correspondiente e intenta crear un nuevo registro mediante la llamada a la API adecuada.
 * En caso de éxito, actualiza el estado de la UI para reflejar la operación exitosa. En caso de error, establece mensajes de error en el estado del formulario.
 *
 * @param values - Los valores del formulario, ya sea para "juicio" (instancia) o "casación" (apelación).
 * @param action - Helpers de Formik para manipular el estado del formulario, como establecer valores o errores.
 * @param activeTab - La pestaña actualmente activa, determina qué proceso ejecutar ("instancia" u otro).
 * @param setSuccess - Setter de estado de React para indicar si la operación fue exitosa.
 * @param setNewCasacion - Setter de estado de React para actualizar la opción de nueva casación (solo se usa para "instancia").
 *
 * @remarks
 * - Para "instancia", construye un objeto `CreateInstancia` y llama a `createInstancia`.
 * - Para "casación", construye un objeto `CreateCasacion` y llama a `createCasacion`.
 * - Maneja y registra errores, actualizando el estado del formulario con mensajes de error.
 */
export const handleMainSubmit = async (
  values: FormValuesJuicio | FormValuesCasacion | FormValuesJuicioSS,
  action: FormikHelpers<FormValuesJuicio | FormValuesCasacion | FormValuesJuicioSS>,
  activeTab: string,
  setSuccess: React.Dispatch<React.SetStateAction<boolean>>,
  setNewCasacion: React.Dispatch<React.SetStateAction<NewCasacionOption>>,
  isSentencia?: boolean
) => {
  if (activeTab === 'instancia') {
    if (isSentencia) {
      // Proceso para FormValuesJuicio
      const valuesJuicio = values as FormValuesJuicio;
      const dataJuicio: CreateInstancia = {
        juicio: valuesJuicio.juicio,
        estado_del_juicio: {
          connect: valuesJuicio.estado_del_juicio?.value || null,
        },
        fecha_de_emision: valuesJuicio.fecha_de_emision
          ? new Date(valuesJuicio.fecha_de_emision).toLocaleDateString('en-CA')
          : null,
        causa_tribunal: {
          connect: valuesJuicio.causa_tribunal?.value || null,
        },
        juez: {
          connect: valuesJuicio.juez?.value || null,
        },
        causa_jueces: {
          connect: valuesJuicio.otros_jueces?.map((item) => item.value) || [],
        },
        resumen_del_caso: valuesJuicio.resumen_del_caso,
        actor: valuesJuicio.actor,
        abogado_actor: {
          connect: valuesJuicio.abogado_actor?.value || null,
        },
        entidad_demandada: {
          connect: valuesJuicio.demandado?.value || null,
        },
        abogado_demandado: {
          connect: valuesJuicio.abogado_demandado?.value || null,
        },
        tipo_de_accion: {
          connect: valuesJuicio.tipo_de_accion?.value || null,
        },
        cuantia: valuesJuicio.cuantia
          ? parseFloat(valuesJuicio.cuantia.replace(/\./g, '').replace(',', '.'))
          : 0,
        detalle_de_cuantia: valuesJuicio.detalle_cuantia,
        pretensiones: valuesJuicio.pretensiones,
        excepciones: valuesJuicio.excepciones,
        categorias: {
          connect: [
            ...(valuesJuicio.categoria?.map((item) => item.value) || []),
            ...(valuesJuicio.subcategoria?.map((item) => item.value) || []),
          ],
        },
        objeto_de_controversia: valuesJuicio.objeto_de_controversia,
        antecedentes: valuesJuicio.antecedentes,
        pruebas_del_actor: valuesJuicio.pruebas_del_actor,
        pruebas_del_demandado: valuesJuicio.pruebas_del_demandado,
        argumentos_del_actor: valuesJuicio.argumentos_del_actor,
        argumentos_del_demandado: valuesJuicio.argumentos_del_demandado,
        decision_final: {
          connect: valuesJuicio.decision_final?.value || null,
        },
        medidas_adicionales: valuesJuicio.medidas_adicionales,
        voto_salvado: {
          connect: valuesJuicio.voto_salvado?.value || null,
        },
        argumento_juez_salvado: valuesJuicio.argumento_juez_salvado,
        jurisprudencia_mencionada: valuesJuicio.jurisprudencia_mencionada,
        criterio_sala_para_resolver: valuesJuicio.criterio_sala_para_resolver,
        observaciones: valuesJuicio.observaciones,
      };
      const file = await uploadFile(valuesJuicio.file);
      dataJuicio.file_pdf = file.id;
      try {
        const response = await createInstancia(dataJuicio);
        setNewCasacion &&
          setNewCasacion({
            juicio: {
              label: response?.juicio ?? '',
              value: response?.documentId ?? '',
            },
            tribunal: {
              label: response?.causa_tribunal?.nombre ?? '',
              value: response?.causa_tribunal?.documentId ?? '',
            },
          });
        setSuccess(true);
      } catch (error: any) {
        console.error(error);
        action.setValues({
          ...valuesJuicio,
          error_message: error.message || 'Error al crear la instancia',
          isOpen: true,
        });
      }
    } else {
      const valuesJuicioSS = values as FormValuesJuicioSS;
      const dataJuicioSS = {
        juicio: valuesJuicioSS.juicio,
        estado_del_juicio: {
          connect: valuesJuicioSS.estado_del_juicio?.value || null,
        },
        causa_tribunal: {
          connect: valuesJuicioSS.causa_tribunal?.value || null,
        },
        observaciones: valuesJuicioSS.observaciones,
      };
      try {
        const response = await createInstancia(dataJuicioSS);
        setSuccess(true);
      } catch (error: any) {
        console.error(error);
        action.setValues({
          ...valuesJuicioSS,
          error_message: error.message || 'Error al crear la instancia',
          isOpen: true,
        });
      }
    }
  } else {
    // Proceso para FormValuesCasacion
    const valuesCasacion = values as FormValuesCasacion;
    const dataCasacion: CreateCasacion = {
      causa: {
        connect: valuesCasacion.juicio?.value || null,
      },
      instancia: valuesCasacion.instancia,
      fecha_de_emision: valuesCasacion.fecha_de_emision
        ? new Date(valuesCasacion.fecha_de_emision).toLocaleDateString('en-CA')
        : null,
      juez: {
        connect: valuesCasacion.juez?.value || null,
      },
      jueces: {
        connect: valuesCasacion.otros_jueces?.map((item) => item.value) || [],
      },
      recurrentes: {
        connect: valuesCasacion.recurrentes?.map((item) => item.value) || [],
      },
      antecedentes: valuesCasacion.antecedentes,
      causal_invocadas: {
        connect: valuesCasacion.causal_invocada?.map((item) => item.value) || [],
      },
      argumentos_del_recurrente: valuesCasacion.argumentos_del_recurrente,
      argumentos_contraparte: valuesCasacion.argumentos_contraparte,
      decision_final: {
        connect: valuesCasacion.decision_final?.value || null,
      },
      medidas_adicionales: valuesCasacion.medidas_adicionales,
      voto_salvado: {
        connect: valuesCasacion.voto_salvado?.value || null,
      },
      argumento_juez_salvado: valuesCasacion.argumento_juez_salvado,
      jurisprudencia_mencionada: valuesCasacion.jurisprudencia_mencionada,
      criterio_sala_para_resolver: valuesCasacion.criterio_sala_para_resolver,
      observaciones: valuesCasacion.observaciones,
    };
    const file = await uploadFile(valuesCasacion.file);
    dataCasacion.file_pdf = file.id;
    try {
      const response = await createCasacion(dataCasacion);
      if (response) {
        setSuccess(true);
      }
    } catch (error: any) {
      console.error(error);
      action.setValues({
        ...valuesCasacion,
        error_message: error.message || 'Error al crear la casación',
        isOpen: true,
      });
    }
  }
};
