import { Grid, Textarea } from '@strapi/design-system';
import { GroupInput, Fieldset } from '../ui/StyledWrappers';
import { FastField, FieldProps } from 'formik';

const CriterioDelTribunal = () => (
    <Fieldset>
        <legend>Criterio del tribunal para resolver el caso</legend>
        <Grid.Root gap={5}>
            <Grid.Item xs={12}>
                <GroupInput>
                    <FastField name="criterio_sala_para_resolver">
                        {({ field, meta }: FieldProps) => (
                            <>
                                <Textarea
                                    placeholder="Fundamentos utilizados por el tribunal."
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
export default CriterioDelTribunal