import * as Yup from 'yup';

export const validationSchemaJuicio = Yup.object().shape({
  juicio: Yup.string()
    .required('Debe ingresar el número de juicio')
    .min(16, 'Debe completar el número de juicio'),
  estado_del_juicio: Yup.object().nullable().required('Debe seleccionar un estado'),
  fecha_de_emision: Yup.string().required('La fecha de emisión es requerida'),
  causa_tribunal: Yup.object().nullable().required('Debe seleccionar un tribunal'),
  juez: Yup.object().nullable().required('Debe seleccionar un juez'),
  resumen_del_caso: Yup.string().required('Debe ingresar el resumen del caso'),
  actor: Yup.string().required('Debe ingresar el nombre del actor'),
  demandado: Yup.object().nullable().required('Debe seleccionar la entidad demandada'),
  tipo_de_accion: Yup.object().nullable().required('Debe seleccionar un tipo de acción'),
  //cuantia: Yup.string().typeError('Debe ingresar un valor numérico para la cuantía'),
  objeto_de_controversia: Yup.string().required('Debe ingresar el objeto de controversia'),
  antecedentes: Yup.string().required('Debe ingresar antecedentes'),
  pruebas_del_actor: Yup.string().required('Debe ingresar lista de pruebas'),
  pruebas_del_demandado: Yup.string().required('Debe ingresar lista de pruebas'),
  argumentos_del_actor: Yup.string().required('Debe ingresar los argumentos'),
  argumentos_del_demandado: Yup.string().required('Debe ingresar los argumentos'),
  decision_final: Yup.object().nullable().required('Debe seleccionar la decisión'),
  criterio_sala_para_resolver: Yup.string().required(
    'Debe ingresar los fundamentos utilizados por el tribunal'
  ),
  file: Yup.mixed().required('El archivo es obligatorio.'),
});
export const validationSchemaJuicioSS = Yup.object().shape({
  juicio: Yup.string()
    .required('Debe ingresar el número de juicio')
    .min(16, 'Debe completar el número de juicio'),
  estado_del_juicio: Yup.object().nullable().required('Debe seleccionar un estado'),
  causa_tribunal: Yup.object().nullable().required('Debe seleccionar un tribunal'),
});

export const validationSchemaCategorización = Yup.object().shape({
  entidad: Yup.object().nullable().required('Debe seleccionar una entidad'),
  categoria: Yup.array().nullable().min(1, 'Debe seleccionar al menos una categoría'),
});

export const validationSchemaCasacion = Yup.object().shape({
  juicio: Yup.object().nullable().required('Debe ingresar el número de juicio'),
  fecha_de_emision: Yup.string().required('La fecha de emisión es requerida'),
  juez: Yup.object().nullable().required('Debe seleccionar un juez'),
  antecedentes: Yup.string().required('Debe ingresar los antecedentes del caso'),
  recurrentes: Yup.array()
    .min(1, 'Debe seleccionar o crear al recurrente')
    .nullable()
    .required('Debe seleccionar o crear al recurrente'),
  causal_invocada: Yup.array()
    .min(1, 'Debe seleccionar una o varias causales')
    .nullable()
    .required('Debe seleccionar una o varias causales'),
  argumentos_del_recurrente: Yup.string().required('Debe ingresar los argumentos del recurrente'),
  decision_final: Yup.object().nullable().required('Debe seleccionar una decisión'),
  criterio_sala_para_resolver: Yup.string().required(
    'Debe ingresar los fundamentos utilizados por la corte'
  ),
  file: Yup.mixed().required('El archivo es obligatorio.'),
});
