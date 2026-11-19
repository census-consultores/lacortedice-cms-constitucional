import {
    Grid
} from '@strapi/design-system';
import { Fieldset, GroupInput } from '../ui/StyledWrappers';
import { ReactAsyncSelect as AsyncSelect } from '../ui/ReactSelect';
import { useFormikContext } from 'formik';
import { useGetOptions } from '../../hooks/useGetOptions';

const TipoDeAccion = () => {
    const formik = useFormikContext();
    const { getOptions } = useGetOptions()
    return (
        <Fieldset>
            <legend>Clasificación de las sentencias por tipo de acción</legend>
            <Grid.Root gap={5}>
                <Grid.Item xs={12} col={6}>
                    <GroupInput>
                        <AsyncSelect
                            label="Tipo de acción"
                            name="tipo_de_accion"
                            placeholder="Seleccionar un tipo de acción"
                            loadOptions={getOptions('tipos-de-accion')}
                        />
                    </GroupInput>
                </Grid.Item>
            </Grid.Root>
        </Fieldset>
    )
}

export default TipoDeAccion;