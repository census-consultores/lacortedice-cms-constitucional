import { Box } from '@strapi/design-system';
import InformacionGeneral from './InformacionGeneral';
import Observaciones from './Observaciones';

const FormJuicioSinSentencia = () => (
    <Box width="100%">
        <InformacionGeneral />
        <Observaciones />
    </Box>
);
export default FormJuicioSinSentencia;