import { useState, useEffect } from 'react';
import { Grid, Typography, TextInput } from '@strapi/design-system';
import { useGetOptions } from '../../hooks/useGetOptions';
import { FastField, useFormikContext, ErrorMessage, FieldProps } from 'formik';
import CreatableSelect from 'react-select/creatable';
import Select from 'react-select';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { reactSelectStyles as styles, reactSelectTheme as theme } from '../ui/ReactSelect';
import ModalDemandado from '../ModalDemandado';
import { createAbogado } from '../../services';

const PartesProcesales = () => {
  const { getOptions } = useGetOptions();
  const { values, setFieldValue } = useFormikContext<FormValuesJuicio>();
  const [isLoading, setLoading] = useState(false);
  const [abogados, setAbogados] = useState<OptionsType>([]);
  const [open, setOpen] = useState(false);

  const toggle = { open, setOpen };

  /**
   * Crea un nuevo abogado y lo agrega a la lista de abogados disponibles
   * @param {string} inputValue - Nombre del nuevo abogado a crear
   * @param {string} key - Clave del campo en el formulario donde se guardará el abogado (ej: 'abogado_actor' o 'abogado_demandado')
   * @returns {Promise<void>}
   */
  const handleCreateAbogado = async (inputValue: string, key: string) => {
    setLoading(true);
    try {
      const nuevoAbogado = await createAbogado(inputValue);
      if (nuevoAbogado) {
        setFieldValue(key, nuevoAbogado);
        setAbogados((prev) => [...prev, nuevoAbogado]);
      }
    } catch (error) {
      console.error('PartesProcesales.tsx ~ onCreateOption={ ~ error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const loadAbogados = getOptions('abogados');
      const abogados = await loadAbogados('');
      setAbogados(abogados);
    })();
  }, []);

  return (
    <Fieldset>
      <legend>Partes procesales</legend>
      <Grid.Root gap={5}>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Actor (Demandante)
            </Typography>
            <FastField name="actor">
              {({ field, meta }: FieldProps) => (
                <>
                  <TextInput
                    placeholder="Nombre del contribuyente y su representación legal"
                    style={{ fontSize: '1.2rem' }}
                    {...field}
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
              Abogado del actor
            </Typography>
            <CreatableSelect
              name="abogado_actor"
              value={values.abogado_actor?.value ? values.abogado_actor : null}
              isClearable
              isDisabled={isLoading}
              isLoading={isLoading}
              placeholder="Crear o filtrar un abogado"
              formatCreateLabel={(inputValue) => `Agregar "${inputValue}"`}
              options={abogados}
              onChange={(newValue: any) => {
                if (newValue) {
                  setFieldValue('abogado_actor', newValue);
                } else {
                  setFieldValue('abogado_actor', { label: '', value: '' });
                }
              }}
              onCreateOption={(inputValue) => handleCreateAbogado(inputValue, 'abogado_actor')}
              theme={theme}
              styles={styles}
            />
            <ErrorMessage
              name="abogado_actor"
              component="span"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Demandado
            </Typography>
            <Select
              name="demandado"
              value={values.demandado}
              placeholder="Administración la Tributaria"
              onFocus={(e: React.FocusEvent<any>) => {
                e.preventDefault();
                setOpen(true);
              }}
              theme={theme}
              styles={styles}
            />
            <ErrorMessage
              name="demandado"
              component="span"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
        <Grid.Item xs={12} col={6}>
          <GroupInput>
            <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
              Abogado del demandado
            </Typography>
            <CreatableSelect
              name="abogado_demandado"
              value={values.abogado_demandado?.value ? values.abogado_demandado : null}
              isClearable
              isDisabled={isLoading}
              isLoading={isLoading}
              placeholder="Crear o filtrar un abogado"
              formatCreateLabel={(inputValue) => `Agregar "${inputValue}"`}
              options={abogados}
              onChange={(newValue: any) => {
                if (newValue) {
                  setFieldValue('abogado_demandado', newValue);
                } else {
                  setFieldValue('abogado_demandado', { label: '', value: '' });
                }
              }}
              onCreateOption={(inputValue) => handleCreateAbogado(inputValue, 'abogado_demandado')}
              theme={theme}
              styles={styles}
            />
            <ErrorMessage
              name="abogado_demandado"
              render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
            />
          </GroupInput>
        </Grid.Item>
      </Grid.Root>
      <ModalDemandado {...toggle} />
    </Fieldset>
  );
};

export default PartesProcesales;
