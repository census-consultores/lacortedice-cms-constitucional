//import { useIntl } from 'react-intl';
import React, { useState, useEffect, useRef } from 'react';
//import { getTranslation } from '../utils/getTranslation';
import { Form, FormikProvider, useFormik, ErrorMessage } from 'formik';
import { Grid, Button, Typography, TextInput } from '@strapi/design-system';
import { Upload } from '@strapi/icons';
import { initialValuesJuicio, initialValuesCasacion, initialValuesJuicioSS } from '../config/formik.initial';
import { validationSchemaJuicio, validationSchemaCasacion, validationSchemaJuicioSS } from '../config/formik.schema';
import { GroupInput, Ulparent } from './ui/StyledWrappers';
import { handleMainSubmit } from '../handles/handleMainSubmit';
import ModalError from './ui/ModalError';
import ModalSuccessful from './ui/ModalSuccessful';
import styled from 'styled-components';

const TogglePillGroup = styled.div`
  display: flex;
  flex-direction: row;
  gap: 0;
  align-items: center;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 3px;
  border: 1px solid #e5e7eb;
`;

const TogglePill = styled.button<{ $isActive?: boolean }>`
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  font-family: 'Inter', sans-serif;
  color: ${({ $isActive }) => $isActive ? '#b49a3a' : '#6b7280'};
  font-weight: ${({ $isActive }) => $isActive ? '600' : '400'};
  user-select: none;
  padding: 7px 18px;
  border-radius: 6px;
  background: ${({ $isActive }) => $isActive ? '#ffffff' : 'transparent'};
  box-shadow: ${({ $isActive }) => $isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'};
  transition: all 0.2s ease;
  &:hover {
    color: ${({ $isActive }) => $isActive ? '#b49a3a' : '#374151'};
  }
`;

const FormLayout: React.FC<{
  children: React.ReactNode;
  title: string;
  activeTab: string;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  newCasacion?: NewCasacionOption;
  setNewCasacion: React.Dispatch<React.SetStateAction<NewCasacionOption>>;
  isSentencia?: boolean;
  setSentencia?: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ children, title, activeTab, setActiveTab, newCasacion, setNewCasacion, isSentencia, setSentencia }) => {
  const [isSuccess, setSuccess] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * Configura el hook useFormik para manejar el estado y validación del formulario
   * @param {Object} initialValues - Valores iniciales del formulario basados en el tab activo
   * @param {Object} validationSchema - Esquema de validación basado en el tab activo
   * @param {Function} onSubmit - Función que maneja el envío del formulario
   */
  const formik = useFormik({
    initialValues: activeTab === 'instancia' ? (isSentencia ? initialValuesJuicio : initialValuesJuicioSS) : initialValuesCasacion,
    validationSchema: activeTab === 'instancia' ? (isSentencia ? validationSchemaJuicio : validationSchemaJuicioSS) : validationSchemaCasacion,
    onSubmit: (values, action) =>
      handleMainSubmit(values, action, activeTab, setSuccess, setNewCasacion, isSentencia),
    enableReinitialize: true,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      formik.setFieldValue('file', file);
      setFileName(file.name)
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };
  useEffect(() => {
    if (newCasacion && activeTab === 'casacion') {
      let newInitialCasacion = formik.initialValues as FormValuesCasacion;
      newInitialCasacion.juicio = newCasacion.juicio;
      newInitialCasacion.causa_tribunal = newCasacion.tribunal;
      formik.setValues(newInitialCasacion);
    }
  }, [newCasacion]);

  const valuesJuicio = formik.values as FormValuesJuicio;

  return (
    <FormikProvider value={formik}>
      <Grid.Root gap={6} paddingTop={6}>
        <Grid.Item col={9}>
          <Grid.Root gap={4} alignItems="center" width="100%">
            <Grid.Item col={7}>
              <Typography variant="alpha" as="h2">
                {title}
              </Typography>
            </Grid.Item>
            {activeTab === 'instancia' && setSentencia && (
              <Grid.Item col={5}>
                <TogglePillGroup>
                  <TogglePill
                    type="button"
                    $isActive={isSentencia}
                    onClick={() => setSentencia(true)}
                  >
                    Con Sentencia
                  </TogglePill>
                  <TogglePill
                    type="button"
                    $isActive={!isSentencia}
                    onClick={() => setSentencia(false)}
                  >
                    Sin Sentencia
                  </TogglePill>
                </TogglePillGroup>
              </Grid.Item>
            )}
          </Grid.Root>
        </Grid.Item>
        <Grid.Item col={12}>
          <Form style={{ width: '100%' }}>
            <Grid.Item xs={12} col={12}>
              <Grid.Root gap={5} width="100%">
                <Grid.Item
                  tag="section"
                  xs={12}
                  col={9}
                  background="neutral0"
                  padding={5}
                  shadow="tableShadow"
                  hasRadius
                >
                  {children}
                </Grid.Item>
                <Grid.Item tag="aside" xs={12} col={3} alignItems="flex-start">
                  <Grid.Root
                    padding={5}
                    width="100%"
                    position="sticky"
                    top="16px"
                    background="neutral0"
                    shadow="tableShadow"
                    hasRadius
                  >
                    {(activeTab === 'instancia' && isSentencia) && (
                      <Grid.Item xs={12} col={12} marginTop="20px" marginBottom="20px">
                        <GroupInput>
                          <Typography variant="omega" as="h5" style={{ fontWeight: '600' }}>
                            CATEGORIAS {valuesJuicio.demandado?.label.split('-', 2)[0]}
                          </Typography>
                          <Ulparent>
                            {valuesJuicio.categorias_agrupadas &&
                              valuesJuicio.categorias_agrupadas.length > 0 ? (
                              valuesJuicio.categorias_agrupadas.map((cat) => (
                                <li key={cat.categoria.id}>
                                  {cat.categoria.label}
                                  <ul>
                                    {cat.subcategoria.map((subcat) => (
                                      <li key={subcat.id}>{subcat.label}</li>
                                    ))}
                                  </ul>
                                </li>
                              ))
                            ) : (
                              <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Sin categorías</p>
                            )}
                          </Ulparent>
                        </GroupInput>
                      </Grid.Item>
                    )}
                    {isSentencia && (
                      <Grid.Item xs={12} col={12}>
                        <GroupInput>
                          <Typography variant="omega" as="h5" style={{ fontWeight: '600', marginBottom: '10px' }}>
                            EXPEDIENTE
                          </Typography>
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleChange}
                            style={{ display: "none" }}
                          />
                          <TextInput
                            label="Archivo"
                            name="file"
                            placeholder="Selecciona un archivo"
                            value={fileName}
                            onClick={handleClick}
                            startAction={<Upload />}
                            readOnly
                            style={{ color: fileName !== "" ? '#b49a3a' : undefined }}
                          />
                          <Button type="button" variant="secondary" size="S" onClick={handleClick} style={{ marginTop: '10px', display: 'block' }}>
                            Elegir archivo
                          </Button>
                          <ErrorMessage
                            name="file"
                            component="span"
                            render={(msg: string) => <span style={{ color: 'red' }}>{msg}</span>}
                          />
                        </GroupInput>
                      </Grid.Item>
                    )}
                    <Grid.Item xs={12} col={12} marginTop="20px">
                      <GroupInput>
                        <Typography variant="omega" as="h5" style={{ fontWeight: '600' }}>
                          ACCIÓN
                        </Typography>
                        <Button
                          type="submit"
                          disabled={formik.isSubmitting}
                          size="S"
                          variant={formik.isSubmitting ? 'loading' : 'secondary'}
                          loading={formik.isSubmitting}
                          fullWidth="true"
                          marginTop={4}
                        >
                          {activeTab === 'instancia' ? 'Guardar Instancia' : 'Guardar Casación'}
                        </Button>
                      </GroupInput>
                    </Grid.Item>
                  </Grid.Root>
                </Grid.Item>
              </Grid.Root>
            </Grid.Item>
          </Form>
        </Grid.Item>
      </Grid.Root>
      <ModalSuccessful {...{ isSuccess, activeTab, setActiveTab, setSuccess, setFileName }} />
      <ModalError />
    </FormikProvider>
  );
};

export default FormLayout;
