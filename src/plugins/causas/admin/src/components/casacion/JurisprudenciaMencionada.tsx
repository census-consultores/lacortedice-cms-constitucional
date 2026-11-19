import { Grid, Typography, TextInput, Textarea } from '@strapi/design-system';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { FastField, FieldProps } from 'formik';

const JurisprudenciaMencionada = () => (
    <Fieldset>
        <legend>Jurisprudencia mencionada en casación</legend>
        <Grid.Root gap={5}>
            <Grid.Item xs={12}>
                <GroupInput>
                    <FastField name="jurisprudencia_mencionada">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Citas relevantes de casos previos en casación."
                                    style={{ fontSize: '1.2rem' }}
                                    {...field}
                                />
                                {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
                            </>
                        )}
                    </FastField>
                </GroupInput>
            </Grid.Item>
        </Grid.Root>
    </Fieldset>
)
export default JurisprudenciaMencionada