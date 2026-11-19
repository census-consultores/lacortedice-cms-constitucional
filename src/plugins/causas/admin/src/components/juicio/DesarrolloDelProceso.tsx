import { Grid, Typography, Textarea } from '@strapi/design-system';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { FastField, FieldProps } from 'formik';

const DesarrolloDelProceso = () => (
    <Fieldset>
        <legend>Desarrollo del proceso</legend>
        <Grid.Root gap={5}>
            <Grid.Item xs={12}>
                <GroupInput>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                        Objeto de controversia
                    </Typography>
                    <FastField name="objeto_de_controversia">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Escriba un párrafo y especificar glosas, si existen."
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
                        Antecedentes
                    </Typography>
                    <FastField name="antecedentes">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Breve resumen de los hechos previos al litigio."
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
                        Pruebas presentadas por el actor
                    </Typography>
                    <FastField name="pruebas_del_actor">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Lista de pruebas y su finalidad en el proceso."
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
                        Pruebas presentadas por el demandado
                    </Typography>
                    <FastField name="pruebas_del_demandado">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Lista de pruebas y su finalidad en el proceso."
                                    style={{ fontSize: '1.2rem' }}
                                    {...field}
                                />
                                {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
                            </>
                        )}
                    </FastField>
                </GroupInput>
            </Grid.Item><Grid.Item xs={12} col={6}>
                <GroupInput>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                        Argumentos de la parte actora
                    </Typography>
                    <FastField name="argumentos_del_actor">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Principales argumentos. Normativa aplicada."
                                    style={{ fontSize: '1.2rem' }}
                                    {...field}
                                />
                                {meta.touched && meta.error && <span style={{ color: 'red' }}>{meta.error}</span>}
                            </>
                        )}
                    </FastField>
                </GroupInput>
            </Grid.Item><Grid.Item xs={12} col={6}>
                <GroupInput>
                    <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
                        Argumentos de la parte demandada
                    </Typography>
                    <FastField name="argumentos_del_demandado">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Principales argumentos. Normativa aplicada."
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
export default DesarrolloDelProceso