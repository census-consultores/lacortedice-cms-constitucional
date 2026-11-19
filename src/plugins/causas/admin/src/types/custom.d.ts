declare module '@strapi/design-system/*';
declare module '@strapi/design-system';

type OptionType = {
  id?: number;
  parentId?: number;
  label: string;
  value: string;
  children?: OptionType[];
};
type OptionsType = Array<OptionType>;

type GroupType = {
  label: string;
  options: OptionsType;
};

type ValueType = OptionType | OptionsType | null | void;

type LoadOptionsType = (
  inputValue: string
) => Promise<OptionsOrGroups<OptionType, GroupBase<OptionType>>>;

type onSelectChangeType = (
  newValue: SingleValue<OptionType> | MultiValue<OptionType> | null
) => void;

type CreateInstancia = {
  juicio: string;
  estado_del_juicio: {
    connect: string | null;
  };
  fecha_de_emision: string | null;
  causa_tribunal: {
    connect: string | null;
  };
  juez: {
    connect: string | null;
  };
  causa_jueces: {
    connect: Array<string>;
  };
  resumen_del_caso: string;
  actor: string;
  abogado_actor?: {
    connect: string | null;
  };
  entidad_demandada: {
    connect: string | null;
  };
  abogado_demandado?: {
    connect: string | null;
  };
  tipo_de_accion: {
    connect: string | null;
  };
  cuantia?: number;
  detalle_de_cuantia?: string;
  pretensiones?: string;
  excepciones?: string;
  categorias: {
    connect: Array<string>;
  };
  objeto_de_controversia: string;
  antecedentes: string;
  pruebas_del_actor: string;
  pruebas_del_demandado: string;
  argumentos_del_actor: string;
  argumentos_del_demandado: string;
  decision_final: {
    connect: string | null;
  };
  medidas_adicionales?: string;
  voto_salvado?: {
    connect: string | null;
  };
  argumento_juez_salvado?: string;
  jurisprudencia_mencionada?: string;
  criterio_sala_para_resolver: string;
  observaciones?: string;
  file_pdf?: File | null;
};
type CreateInstanciaSS = {
  juicio: string;
  estado_del_juicio: {
    connect: string | null;
  };
  causa_tribunal: {
    connect: string | null;
  };
  observaciones?: string;
  //file_pdf?: File | null;
};
type CreateCasacion = {
  causa: {
    connect: string | null;
  };
  instancia: string;
  fecha_de_emision: string | null;
  juez: {
    connect: string | null;
  };
  jueces: {
    connect: Array<string>;
  };
  recurrentes: {
    connect: Array<string>;
  };
  antecedentes: string;
  causal_invocadas: {
    connect: Array<string>;
  };
  argumentos_del_recurrente: string;
  argumentos_contraparte: string;
  decision_final: {
    connect: string | null;
  };
  medidas_adicionales?: string;
  voto_salvado?: {
    connect: string | null;
  };
  argumento_juez_salvado?: string;
  jurisprudencia_mencionada?: string;
  criterio_sala_para_resolver: string;
  observaciones?: string;
  file_pdf?: File | null;
};
type CategoriesGrouped = {
  categoria: OptionType;
  subcategoria: OptionsType;
};
interface ResponseToOptions {
  id?: number;
  documentId: number;
  nombre: string;
  juicio?: string;
  sigla?: string;
}
interface ResponseCausa {
  id: number;
  documentId: string;
  juicio: string;
  causa_tribunal: {
    id: number;
    documentId: string;
    nombre: string;
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: null;
    locale?: null;
  };
}
type ResponseCreateCausa = {
  id: number;
  documentId: string;
  juicio: string;
  causa_tribunal: {
    id: number;
    documentId: string;
    nombre: string;
  };
};
type NewCasacionOption = {
  juicio: {
    label: string;
    value: string;
  } | null;
  tribunal: {
    label: string;
    value: string;
  } | null;
};
interface CategoryOption extends OptionType {
  children?: CategoryOption[];
}

interface Categorization {
  entidad: OptionType | OptionsType | null;
  categoria: OptionsType | null;
  subcategoria: OptionsType;
}

interface FormValuesJuicio {
  juicio: string;
  instancia: string;
  estado_del_juicio: OptionType | null;
  causa_tribunal: OptionType | null;
  juez: OptionType | null;
  otros_jueces: OptionsType | [];
  fecha_de_emision: Date | null;
  resumen_del_caso: string;
  actor: string;
  abogado_actor: OptionType | null;
  demandado: OptionType | null;
  abogado_demandado: OptionType | null;
  tipo_de_accion: OptionType | null;
  cuantia: string;
  detalle_cuantia: string;
  pretensiones: string;
  excepciones: string;
  categoria: OptionsType;
  subcategoria: OptionsType;
  categorias_agrupadas: CategoriesGrouped[];
  objeto_de_controversia: string;
  antecedentes: string;
  pruebas_del_actor: string;
  pruebas_del_demandado: string;
  argumentos_del_actor: string;
  argumentos_del_demandado: string;
  decision_final: OptionType | null;
  medidas_adicionales: string;
  voto_salvado: OptionType | null;
  argumento_juez_salvado: string;
  jurisprudencia_mencionada: string;
  criterio_sala_para_resolver: string;
  observaciones: string;
  error_message: string;
  isOpen: boolean;
  file: File | null;
}
interface FormValuesJuicioSS
  extends Pick<
    FormValuesJuicio,
    'juicio' | 'instancia' | 'estado_del_juicio' | 'causa_tribunal' | 'observaciones'
  > {}
interface FormValuesCasacion
  extends Pick<
    FormValuesJuicio,
    | 'instancia'
    | 'causa_tribunal'
    | 'fecha_de_emision'
    | 'juez'
    | 'otros_jueces'
    | 'antecedentes'
    | 'decision_final'
    | 'medidas_adicionales'
    | 'voto_salvado'
    | 'argumento_juez_salvado'
    | 'jurisprudencia_mencionada'
    | 'criterio_sala_para_resolver'
    | 'observaciones'
    | 'error_message'
    | 'isOpen'
    | 'file'
  > {
  juicio: OptionType | null;
  recurrentes: OptionsType | [];
  causal_invocada: OptionsType | [];
  argumentos_del_recurrente: string;
  argumentos_contraparte: string;
}

/**
 * Interface que define las propiedades principales para los componentes de formulario
 * @interface MainProps
 * @property {string} name - Nombre del campo en el formulario
 * @property {string} label - Etiqueta visible del campo
 * @property {OptionType} [value] - Valor actual seleccionado (opcional)
 * @property {OptionType[]} [options] - Lista de opciones disponibles (opcional)
 * @property {string} [placeholder] - Texto de placeholder (opcional)
 * @property {boolean} [isMulti] - Indica si permite selección múltiple (opcional)
 * @property {boolean} [disabled] - Indica si el campo está deshabilitado (opcional)
 * @property {LoadOptionsType} [loadOptions] - Función para cargar opciones dinámicamente (opcional)
 * @property {onSelectChangeType} [onSelectChange] - Función manejadora del cambio de selección (opcional)
 * @property {Function} [onBlurTextArea] - Función manejadora del evento blur en textarea (opcional)
 */
interface MainProps {
  name: string;
  label: string;
  value?: OptionType;
  options?: OptionType[];
  placeholder?: string;
  isMulti?: boolean;
  disabled?: boolean;
  loadOptions?: LoadOptionsType;
  onSelectChange?: onSelectChangeType;
  onBlurTextArea?: (event: React.FocusEvent<any>) => void;
}
