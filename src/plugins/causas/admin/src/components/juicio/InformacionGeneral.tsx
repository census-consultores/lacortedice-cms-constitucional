import { useRef, useState } from 'react';
import { Grid, Typography, TextInput, Textarea, DatePicker } from '@strapi/design-system';
import { useGetOptions } from '../../hooks/useGetOptions';
import { useFormikContext, ErrorMessage, FastField, FieldProps } from 'formik';
import {
  ReactSelect as Select,
  ReactAsyncSelect as AsyncSelect,
  reactSelectStyles as styles,
  reactSelectTheme as theme,
} from '../ui/ReactSelect';
import { IMaskInputWrapper, IMaskStyledInput } from '../ui/StyledWrappers';
import CreatableSelect from 'react-select/creatable';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { initialValuesJuicio } from '../../config/formik.initial';
import { createJuez } from '../../services';

const InformacionGeneral = () => {
  const { getOptions } = useGetOptions();
  const { values, setValues, setFieldValue } = useFormikContext<FormValuesJuicio>();
  const [jueces, setJueces] = useState<OptionsType>([]);
  const [otrosJueces, setOtrosJueces] = useState<OptionsType>([]);
  const [isLoading, setLoading] = useState(false);
  const [isDisabled, setDisabled] = useState(true);
  const juecesRef = useRef<any>(null);
  const otrosJuecesRef = useRef<any>(null);

  const handleTribunalChange = async (selectedOption: OptionType) => {
    if (selectedOption) {
      setFieldValue('causa_tribunal', selectedOption);
      const loadJueces = getOptions('jueces', selectedOption?.value);
      const jueces = await loadJueces('');
      setJueces(jueces);
      setTimeout(() => {
        setDisabled(false);
        juecesRef.current?.clearValue();
        juecesRef.current?.focus();
      }, 100);
    } else {
      setFieldValue('causa_tribunal', initialValuesJuicio.causa_tribunal);
      setJueces([]);
      juecesRef.current?.clearValue();
      otrosJuecesRef.current?.clearValue();
    }
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
      setFieldValue('juez', initialValuesJuicio.juez);
      setFieldValue('otros_jueces', initialValuesJuicio.otros_jueces);
      otrosJuecesRef.current?.clearValue();
      setOtrosJueces([]);
    }
  };
  const handleCreateJuez = async (inputValue: string) => {
    if (!values.causa_tribunal?.value) {
      return;
    }
    setLoading(true);
    try {
      const nuevoJuez = await createJuez(inputValue, values.causa_tribunal.value);
      if (nuevoJuez) {
        setFieldValue('juez', nuevoJuez);
        setJueces((prevJuez) => [...prevJuez, nuevoJuez]);
        handleJuecesChange(nuevoJuez);
      }
    } catch (error: any) {
      console.error(error);
      setValues({ ...values, error_message: error.message, isOpen: true });
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

  return (
    <Fieldset>
      <legend>Información general de las sentencias del tribunal</legend>
      <Grid.Root gap={5}>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Juicio No.
            </Typography>
            <FastField name="juicio">
              {({ field, meta }: FieldProps) => (
                <>
                  <IMaskInputWrapper>
                    <IMaskStyledInput
                      mask="00000-0000-00000"
                      defaultValue={field.value}
                      placeholder="_____-____-_____"
                      {...field}
                    />
                  </IMaskInputWrapper>
                  {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
                </>
              )}
            </FastField>
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6} marginTop={3}>
          <GroupInput>
            <AsyncSelect
              label="Estado del juicio"
              name="estado_del_juicio"
              placeholder="Seleccionar o filtrar"
              loadOptions={getOptions('estados-de-juicio')}
            />
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
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Instancia
            </Typography>
            <TextInput name="instancia" value={values.instancia} disabled />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={12}>
          <GroupInput>
            <AsyncSelect
              label="Tribunal"
              name="causa_tribunal"
              placeholder="Seleccionar o filtrar un tribunal"
              loadOptions={getOptions('tribunales')}
              onSelectChange={(selectedOption) => {
                handleTribunalChange(selectedOption);
              }}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Juez ponente
            </Typography>
            <CreatableSelect
              ref={juecesRef}
              name="juez"
              value={values.juez?.value ? values.juez : null}
              isClearable
              isDisabled={isDisabled}
              isLoading={isLoading}
              placeholder={
                isDisabled ? 'Seleccionar un tribunal para habilitar' : 'Crear o filtrar un juez'
              }
              formatCreateLabel={(inputValue) => `Agregar "${inputValue}"`}
              noOptionsMessage={() => 'Seleccionar tribunal para mostrar lista'}
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
        <Grid.Item xs={12} col={6} marginTop={3}>
          <GroupInput>
            <Select
              ref={otrosJuecesRef}
              name="otros_jueces"
              label="Otros jueces"
              disabled={isDisabled}
              placeholder={
                isDisabled ? 'Seleccionar un juez para habilitar' : 'Seleccionar uno o más jueces'
              }
              options={otrosJueces}
              isMulti={true}
              onSelectChange={(selectedOption) => handleOtrosJuecesChange(selectedOption)}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={12}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Resumen del caso
            </Typography>
            <FastField name="resumen_del_caso">
              {({ field }: FieldProps) => (
                <Textarea
                  placeholder="Breve descripción de los hechos y controversia."
                  style={{ fontSize: '1.2rem' }}
                  {...field}
                />
              )}
            </FastField>
            <ErrorMessage
              name="resumen_del_caso"
              component="span"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
      </Grid.Root>
    </Fieldset>
  );
};

export default InformacionGeneral;
