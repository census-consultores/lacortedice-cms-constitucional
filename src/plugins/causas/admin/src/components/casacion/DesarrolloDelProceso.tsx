import { Grid, Typography, TextInput, Textarea } from '@strapi/design-system';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { ErrorMessage, FastField, FieldProps } from 'formik';

const DesarrolloDelProceso = () => (
    <Fieldset>
        <legend>Desarrollo del Proceso</legend>
        <Grid.Root gap={5}>
            <Grid.Item xs={12} col={6}>
                <GroupInput>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                        Argumentos del recurrente - Normativa aplicada
                    </Typography>
                    <FastField name="argumentos_del_recurrente">
                        {({ field }: FieldProps) => (
                            <Textarea
                                placeholder="Fundamentos del Recurso de Casación. 
Normas legales utilizadas en la argumentación."
                                style={{ fontSize: '1.2rem' }}
                                {...field}
                            />
                        )}
                    </FastField>
                    <ErrorMessage
                        name="argumentos_del_recurrente"
                        component="span"
                        render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
                    />
                </GroupInput>
            </Grid.Item>
            <Grid.Item xs={12} col={6}>
                <GroupInput>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                        Argumentos de la contra parte - Normativa aplicada
                    </Typography>
                    <FastField name="argumentos_contraparte">
                        {({ field }: FieldProps) => (
                            <Textarea
                                placeholder="Argumentos de la parte demandante en la casación.
Normas legales utilizadas en la argumentación."
                                style={{ fontSize: '1.2rem' }}
                                {...field}
                            />
                        )}
                    </FastField>
                </GroupInput>
            </Grid.Item>
            {/* <Grid.Item xs={12}>
                <GroupInput>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                        Análisis del Tribunal de Casación
                    </Typography>
                    <FastField name="analisis_del_tribunal">
                        {({ field }: FieldProps) => (
                            <Textarea
                                placeholder="Argumentos del tribunal para resolver el caso"
                                style={{ fontSize: '1.2rem' }}
                                {...field}
                            />
                        )}
                    </FastField>
                    <ErrorMessage
                        name="analisis_del_tribunal"
                        component="span"
                        render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
                    />
                </GroupInput>
            </Grid.Item> */}
        </Grid.Root>
    </Fieldset >
)
export default DesarrolloDelProceso