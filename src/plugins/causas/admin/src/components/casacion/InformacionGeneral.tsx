import { useEffect, useState, useRef } from 'react';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { Grid, Typography, TextInput, Textarea, DatePicker } from '@strapi/design-system';
import { useFormikContext, ErrorMessage, FastField, FieldProps } from 'formik';
import {
  ReactSelect as Select,
  ReactAsyncSelect as AsyncSelect,
  reactSelectStyles as styles,
  reactSelectTheme as theme,
} from '../ui/ReactSelect';
//import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { useFetchClient } from '@strapi/strapi/admin';
import { useGetOptions } from '../../hooks/useGetOptions';
import { initialValuesCasacion } from '../../config/formik.initial';
import { createJuez, createRecurrente } from '../../services';
import { CNJ_ID } from '../../config/constants';

const InformacionGeneral = () => {
  const { values, setFieldValue } = useFormikContext<FormValuesCasacion>();
  const { get } = useFetchClient();
  const { getOptions } = useGetOptions();
  const [causas, setCausas] = useState<ResponseCausa[]>([]);
  const [juicios, setJuicios] = useState<OptionsType>([]);
  const [jueces, setJueces] = useState<OptionsType>([]);
  const [otrosJueces, setOtrosJueces] = useState<OptionsType>([]);
  const [isDisabled, setDisabled] = useState(true);
  const [recurrente, setRecurrente] = useState<OptionsType>([]);
  const [isLoading, setLoading] = useState(false);
  const otrosJuecesRef = useRef<any>(null);

  const handleJuicioChange = (selectedOption: OptionType) => {
    const causa = causas.find((causa: ResponseCausa) => causa.juicio === selectedOption.label);
    if (!causa) return;

    const buildTribunal: OptionType = {
      label: causa.causa_tribunal.nombre,
      value: causa.causa_tribunal.documentId,
    };

    setFieldValue('juicio', selectedOption);
    setFieldValue('causa_tribunal', buildTribunal);
  };

  const handleJuecesChange = (selectedOption: OptionType | null) => {
    if (selectedOption) {
      otrosJuecesRef.current?.clearValue();
      setFieldValue('juez', selectedOption);
      const otrosJueces: OptionsType = jueces.filter(
        (juez: OptionType) => juez.value !== selectedOption.value
      );
      setOtrosJueces(otrosJueces);
    } else {
      setFieldValue('juez', initialValuesCasacion.juez);
      setFieldValue('otros_jueces', initialValuesCasacion.otros_jueces);
      otrosJuecesRef.current?.clearValue();
      setOtrosJueces([]);
    }
  };

  const handleCreateJuez = async (inputValue: string) => {
    setLoading(true);
    try {
      const nuevoJuez = await createJuez(inputValue, CNJ_ID);
      if (nuevoJuez) {
        setFieldValue('juez', nuevoJuez);
        setJueces((prevJuez) => [...prevJuez, nuevoJuez]);
        handleJuecesChange(nuevoJuez);
      }
    } catch (error: any) {
      console.error('InformacionGeneral.tsx ~ onCreateOption={ ~ error:', error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleOtrosJuecesChange = (selectedOption: OptionsType) => {
    if (selectedOption) {
      setFieldValue('otros_jueces', selectedOption);
    } else {
      setFieldValue('otros_jueces', []);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await get('causas/causas');
        setCausas(data);
        const juicios = data.map((causa: ResponseCausa) => ({
          label: causa.juicio,
          value: causa.documentId,
        }));
        setJuicios(juicios);
      } catch (error) {
        console.error('🚀 ~ InformacionGeneral.tsx ~ error:', error);
      }
      /**
       * Carga la lista de jueces de la Corte Nacional de Justicia
       * @param {string} 'jueces' - Endpoint a consultar para obtener los jueces
       * @param {string} 'id4r9k8b2sv4gn5ib9lsk92k' - ID del documento de la Corte Nacional de Justicia
       */
      const loadJueces = getOptions('jueces', CNJ_ID);
      const jueces = await loadJueces('');
      setJueces(jueces);

      const loadRecurrente = getOptions('recurrente');
      const recurrente = await loadRecurrente('');
      setRecurrente(recurrente);
    })();
  }, []);

  return (
    <Fieldset>
      <legend>Información general</legend>
      <Grid.Root gap={5}>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Select
              label="No. de juicio"
              name="juicio"
              options={juicios}
              placeholder="Seleccionar número de juicio"
              onSelectChange={(selectedOption: any) => handleJuicioChange(selectedOption)}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Instancia
            </Typography>
            <TextInput name="instancia" value={values.instancia} disabled />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Fecha de emisión
            </Typography>
            <FastField name="fecha_de_emision">
              {({ field, form, meta }: FieldProps) => (
                <>
                  <DatePicker
                    {...field}
                    selected={field.value}
                    onChange={(date: Date) => form.setFieldValue(field.name, date)}
                    style={{ fontSize: '1.2rem' }}
                  />
                  {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
                </>
              )}
            </FastField>
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Tribunal contensioso
            </Typography>
            <TextInput
              value={values.causa_tribunal?.label}
              placeholder="Tribunal que emitió la sentencia"
              disabled
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Juez ponente
            </Typography>
            <CreatableSelect
              name="juez"
              value={values.juez?.value ? values.juez : null}
              isClearable
              isLoading={isLoading}
              placeholder={
                isDisabled ? 'Seleccionar un tribunal para habilitar' : 'Crear o filtrar un juez'
              }
              noOptionsMessage={() => 'Seleccionar tribunal para mostrar lista'}
              formatCreateLabel={(inputValue) => `Agregar "${inputValue}"`}
              options={jueces}
              onChange={(selectedOption: any) => handleJuecesChange(selectedOption)}
              onCreateOption={(inputValue: string) => handleCreateJuez(inputValue)}
              theme={theme}
              styles={styles}
            />
            <ErrorMessage
              name="juez"
              component="span"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Select
              ref={otrosJuecesRef}
              name="otros_jueces"
              label="Otros jueces que intervinieron"
              placeholder={
                isDisabled ? 'Seleccionar un juez para habilitar' : 'Seleccionar uno o más jueces'
              }
              options={otrosJueces}
              isMulti={true}
              onSelectChange={(selectedOption) => handleOtrosJuecesChange(selectedOption)}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Recurrentes
            </Typography>
            <CreatableSelect
              name="recurrentes"
              value={values.recurrentes ? values.recurrentes : null}
              isClearable
              isMulti
              isDisabled={isLoading}
              isLoading={isLoading}
              placeholder="Crear o filtrar un recurrente"
              formatCreateLabel={(inputValue) => `Agregar "${inputValue}"`}
              options={recurrente}
              onChange={(newValue: any) => {
                if (newValue) {
                  setFieldValue('recurrentes', newValue);
                } else {
                  setFieldValue('recurrentes', null);
                }
              }}
              onCreateOption={async (inputValue) => {
                setLoading(true);
                const nuevoRecurrente = await createRecurrente(inputValue);
                if (nuevoRecurrente) {
                  setFieldValue('recurrentes', [...values.recurrentes, nuevoRecurrente]);
                  setRecurrente((prev) => [...prev, nuevoRecurrente]);
                }
                setLoading(false);
              }}
              theme={theme}
              styles={styles}
            />
            <ErrorMessage
              name="recurrentes"
              component="span"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Antecedentes del caso en casación
            </Typography>
            <FastField name="antecedentes">
              {({ field }: FieldProps) => (
                <Textarea
                  placeholder="Quién interpuso la demanda y contra qué resolución administrativa.
Decisión del Tribunal Distrital en primera instancia."
                  style={{ fontSize: '1.2rem' }}
                  {...field}
                />
              )}
            </FastField>
            <ErrorMessage
              name="antecedentes"
              component="span"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12}>
          <GroupInput>
            <AsyncSelect
              label="Causal Invocada"
              name="causal_invocada"
              loadOptions={getOptions('causal-invocada')}
              isMulti={true}
              placeholder="Elegir una o varias causales"
            />
          </GroupInput>
        </Grid.Item>
      </Grid.Root>
    </Fieldset>
  );
};
export default InformacionGeneral;
