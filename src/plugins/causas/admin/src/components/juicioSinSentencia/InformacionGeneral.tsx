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
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { initialValuesJuicio } from '../../config/formik.initial';

const InformacionGeneral = () => {
  const { getOptions } = useGetOptions();
  const { values, setValues, setFieldValue } = useFormikContext<FormValuesJuicio>();
  const [jueces, setJueces] = useState<OptionsType>([]);
  const [isDisabled, setDisabled] = useState(true);
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
                setFieldValue('causa_tribunal', selectedOption);
              }}
            />
          </GroupInput>
        </Grid.Item>
      </Grid.Root>
    </Fieldset>
  );
};

export default InformacionGeneral;
