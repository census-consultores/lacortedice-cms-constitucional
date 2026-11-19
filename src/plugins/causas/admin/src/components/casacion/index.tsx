import { Box } from '@strapi/design-system';
import InformacionGeneral from './InformacionGeneral';
import DesarrolloDelProceso from './DesarrolloDelProceso';
import DecisionDelTribunal from './DecisionDelTribunal';
import JurisprudenciaMencionada from './JurisprudenciaMencionada';
import CriterioDelTribunal from './CriterioDelTribunal';
import Observaciones from './Observaciones';
const FormCasacion = () => (
  <Box width="100%">
    <InformacionGeneral />
    <DesarrolloDelProceso />
    <DecisionDelTribunal />
    <JurisprudenciaMencionada />
    <CriterioDelTribunal />
    <Observaciones />
  </Box>
);

export default FormCasacion;
