import { useIntl } from 'react-intl';
import { Tabs, Box, Main, Typography } from '@strapi/design-system';
import FormLayout from '../components/FormLayout';
import FormJuicio from '../components/juicio';
import FormCasacion from '../components/casacion';
import { useState } from 'react';
import FormJuicioSinSentencia from '../components/juicioSinSentencia';

/**
 * @see https://design-system.strapi.io/
 */

const HomePage = () => {
  const { formatMessage } = useIntl();
  const [activeTab, setActiveTab] = useState('instancia');
  const [isSentencia, setSentencia] = useState<boolean>(true);
  const [newCasacion, setNewCasacion] = useState<NewCasacionOption>({
    juicio: null,
    tribunal: {
      label: '',
      value: '',
    },
  });

  return (
    <Main maxWidth="1100px" margin="auto">
      <Box padding={6} paddingTop={4}>
        <Box marginBottom={4}>
          <Typography
            variant="beta"
            as="h1"
            style={{
              color: '#111827',
              fontWeight: 700,
              fontSize: '1.5rem',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Registros Legales
          </Typography>
          <Typography
            variant="pi"
            style={{
              color: '#9ca3af',
              fontSize: '0.8rem',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Crear y gestionar instancias y casaciones
          </Typography>
        </Box>
        <Tabs.Root variant="simple" value={activeTab} onValueChange={setActiveTab}>
          <Tabs.List aria-label="tipos de formularios">
            <Tabs.Trigger value="instancia">Instancia</Tabs.Trigger>
            <Tabs.Trigger value="casacion">Casación</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="instancia">
            <FormLayout
              title="Nueva Instancia"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              setNewCasacion={setNewCasacion}
              isSentencia={isSentencia}
              setSentencia={setSentencia}
            >
              {isSentencia ? <FormJuicio /> : <FormJuicioSinSentencia />}
            </FormLayout>
          </Tabs.Content>
          <Tabs.Content value="casacion">
            <FormLayout
              title="Nueva Casación"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              newCasacion={newCasacion}
              setNewCasacion={setNewCasacion}
              isSentencia={isSentencia}
            >
              <FormCasacion />
            </FormLayout>
          </Tabs.Content>
        </Tabs.Root>
      </Box>
    </Main>
  );
};

export default HomePage;
