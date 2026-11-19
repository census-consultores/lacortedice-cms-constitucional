import { Grid, TextInput, Textarea, Typography } from '@strapi/design-system';
import { Fieldset, GroupInput } from '../ui/StyledWrappers';
import { useFormikContext, FastField, FieldProps } from 'formik';

const ActosImpugnados = () => {
    const formik = useFormikContext<FormValuesJuicio>();
    return (
        <Fieldset>
            <legend>Actos impugnados</legend>
            <Grid.Root gap={5}>
                <Grid.Item xs={12}>
                    <GroupInput>
                        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                            Pretensiones de la parte actora
                        </Typography>
                        <FastField name="pretensiones">
                            {({ field, meta }: FieldProps) => (
                                <>
                                    <Textarea
                                        placeholder="Pretensiones planteadas en la demanda"
                                        style={{ fontSize: '1.2rem' }}
                                        {...field}
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
                            Excepciones de la parte demandada
                        </Typography>
                        <FastField name="excepciones">
                            {({ field, meta }: FieldProps) => (
                                <>
                                    <Textarea
                                        placeholder="Excepciones previas y de fondo propuestas por la parte demandada."
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
}

export default ActosImpugnados;