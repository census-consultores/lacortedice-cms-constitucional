import { Grid, Typography, TextInput, Textarea } from '@strapi/design-system';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { FastField, FieldProps } from 'formik';
import { ReactAsyncSelect as AsyncSelect } from '../ui/ReactSelect';
import { useGetOptions } from '../../hooks/useGetOptions';

const DecisionDelTribunal = () => {
    const { getOptions } = useGetOptions();
    return (
        <Fieldset>
            <legend>Decisión de la corte</legend>
            <Grid.Root gap={5}>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <AsyncSelect
                            label="Decisión final"
                            name="decision_final"
                            placeholder="Seleccionar de la lista"
                            loadOptions={getOptions('decision-final-casacion')}
                        />
                    </GroupInput>
                </Grid.Item>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                            Medidas adicionales
                        </Typography>
                        <FastField name="medidas_adicionales">
                            {({ field }: FieldProps) => (
                                <TextInput
                                    placeholder="Es opcional en caso de que los jueces mencionen en su sentencia"
                                    size="M"
                                    style={{ fontSize: '1.2rem' }}
                                    {...field}
                                />
                            )}
                        </FastField>
                    </GroupInput>
                </Grid.Item>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <AsyncSelect
                            label="Voto Salvado"
                            name="voto_salvado"
                            placeholder="Seleccionar al juez que presento el voto salvado"
                            loadOptions={getOptions('jueces')}
                        />
                    </GroupInput>
                </Grid.Item>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                            Argumento del Juez sobre el voto salvado
                        </Typography>
                        <FastField name="argumento_juez_salvado">
                            {({ field, meta }: FieldProps) => (
                                <>
                                    <Textarea
                                        placeholder="Argumento del Voto salvado"
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
export default DecisionDelTribunal