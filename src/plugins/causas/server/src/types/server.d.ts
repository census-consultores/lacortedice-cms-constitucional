type CreateJuez = {
  data: {
    nombre: string;
    juez_tribunales: {
      connect: string | null;
    };
  };
};
type CreateCausa = {
  data: {
    juicio: string;
    estado_del_juicio: {
      connect: string | null;
    };
    fecha_de_emision: Date;
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
    file_pdf: number;
  };
};
type CreateCasacion = {
  data: {
    causa: {
      connect: string | null;
    };
    instancia: string;
    fecha_de_emision?: Date;
    recurrente: {
      connect: Array<string>;
    };
    antecedentes: string;
    causal_invocada: {
      connect: Array<string>;
    };
    argumentos_del_recurrente: '';
    argumentos_contraparte: '';
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
    file_pdf: number;
  };
};
