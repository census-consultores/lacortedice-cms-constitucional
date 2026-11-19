//import { useIntl } from 'react-intl';
//import { getTranslation } from '../utils/getTranslation';

import { Box } from '@strapi/design-system';
import InformacionGeneral from './InformacionGeneral';
import PartesProcesales from './PartesProcesales';
import TipoDeAccion from './TipoDeAccion';
import AspectosEconomicos from './AspectosEconomicos';
import ActosImpugnados from './ActosImpugnados';
import DesarrolloDelProceso from './DesarrolloDelProceso';
import DecisionDelTribunal from './DecisionDelTribunal';
import JurisprudenciaMencionada from './JurisprudenciaMencionada';
import CriterioDelTribunal from './CriterioDelTribunal';
import Observaciones from './Observaciones';

const FormJuicio = () => (
  <Box width="100%">
    <InformacionGeneral />
    <PartesProcesales />
    <TipoDeAccion />
    <AspectosEconomicos />
    <ActosImpugnados />
    <DesarrolloDelProceso />
    <DecisionDelTribunal />
    <JurisprudenciaMencionada />
    <CriterioDelTribunal />
    <Observaciones />
  </Box>
);

export default FormJuicio;
