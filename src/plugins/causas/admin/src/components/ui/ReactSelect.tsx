import { forwardRef, useEffect, useState } from 'react';
import { useField, ErrorMessage } from 'formik';
import { Box, Typography } from '@strapi/design-system';
import Select, { Theme, StylesConfig, GroupBase } from 'react-select';
import AsyncSelect from 'react-select/async';

export const reactSelectStyles: StylesConfig = {
  control: (provided: any, state: any) => ({
    ...provided,
    borderWidth: 1,
    borderColor: state.isFocused ? '#b49a3a' : '#d1d5db',
    boxShadow: state.isFocused ? '0 0 0 3px rgba(180, 154, 58, 0.15)' : 'none',
    borderRadius: 6,
    minHeight: 40,
    fontSize: '0.875rem',
    fontFamily: "'Inter', sans-serif",
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:hover': {
      borderColor: '#b49a3a',
    },
  }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isSelected ? '#f8f4e3' : state.isFocused ? '#f9fafb' : 'white',
    color: state.isSelected ? '#b49a3a' : '#374151',
    fontSize: '0.875rem',
    fontFamily: "'Inter', sans-serif",
    padding: '8px 12px',
  }),
  placeholder: (styles) => ({ ...styles, fontSize: '0.875rem', color: '#9ca3af' }),
  singleValue: (styles) => ({ ...styles, fontSize: '0.875rem', color: '#1f2937' }),
  multiValue: (styles) => ({
    ...styles,
    backgroundColor: '#f8f4e3',
    borderRadius: 4,
  }),
  multiValueLabel: (styles) => ({
    ...styles,
    color: '#b49a3a',
    fontSize: '0.8rem',
    fontWeight: 500,
  }),
  multiValueRemove: (styles) => ({
    ...styles,
    color: '#c09a2b',
    '&:hover': {
      backgroundColor: '#f3e6b8',
      color: '#b49a3a',
    },
  }),
  menu: (styles) => ({
    ...styles,
    borderRadius: 8,
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  }),
};

export const reactSelectTheme = (theme: Theme) => ({
  ...theme,
  borderRadius: 6,
  colors: {
    ...theme.colors,
    primary25: '#f9fafb',
    primary50: '#f8f4e3',
    primary: '#b49a3a',
  },
});
/**
 * Componente ReactSelect que envuelve el componente Select de react-select
 * para integrarlo con Formik y mantener un estilo consistente
 *
 * @component
 * @param {Object} props - Propiedades del componente
 * @see https://react-select.com/props
 * @param {string} props.name - Nombre del campo en el formulario Formik
 * @param {string} props.label - Etiqueta visible del campo
 * @param {boolean} [props.disabled] - Indica si el campo está deshabilitado
 * @param {boolean} [props.isMulti=false] - Indica si permite selección múltiple
 * @param {OptionType[]} [props.options] - Lista de opciones disponibles
 * @param {Function} [props.onSelectChange] - Función manejadora del cambio de selección
 * @param {React.Ref} ref - Referencia al componente Select subyacente
 * @returns {JSX.Element} Componente Select estilizado y conectado a Formik
 */
export const ReactSelect = forwardRef<any, MainProps>(
  ({ name, label, disabled, isMulti = false, options, onSelectChange, ...props }, ref) => {
    const [field, meta, helpers] = useField(name);
    const { setValue } = helpers;

    return (
      <Box marginBottom="1rem">
        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
          {label}
        </Typography>
        <Select
          ref={ref}
          options={options}
          isClearable
          isMulti={isMulti}
          isDisabled={disabled}
          value={isMulti ? field.value || [] : field.value || null}
          noOptionsMessage={() => 'Opciones no disponible'}
          onChange={(newValue: any) => {
            if (onSelectChange) {
              onSelectChange(newValue);
              return;
            }
            if (isMulti) {
              // newValue puede ser un array o null
              setValue(newValue ?? []);
            } else {
              // newValue puede ser un objeto o null
              setValue(newValue ? newValue : null);
            }
          }}
          theme={reactSelectTheme}
          styles={reactSelectStyles}
          {...props}
        />
        {meta.touched && meta.error ? <span style={{ color: 'red' }}>{meta.error}</span> : null}
      </Box>
    );
  }
);
/**
 * Componente de selección asíncrona que permite cargar opciones dinámicamente
 * @component
 * @see https://react-select.com/props
 * @param {Object} props - Propiedades del componente
 * @param {string} props.name - Nombre del campo en el formulario
 * @param {string} props.label - Etiqueta visible del campo
 * @param {boolean} [props.isMulti=false] - Indica si permite selección múltiple
 * @param {Function} [props.onSelectChange] - Función manejadora del cambio de selección
 * @param {Function} [props.loadOptions] - Función para cargar opciones dinámicamente
 * @param {Object} [props.ref] - Referencia al componente
 * @returns {JSX.Element} Componente de selección asíncrona
 */
export const ReactAsyncSelect = forwardRef<any, MainProps>(
  ({ name, label, isMulti = false, onSelectChange, loadOptions, ...props }, ref) => {
    const [field, meta, helpers] = useField(name);
    const { setValue } = helpers;

    return (
      <Box marginBottom="1rem">
        <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="label">
          {label}
        </Typography>
        <AsyncSelect
          ref={ref}
          cacheOptions
          loadOptions={loadOptions}
          defaultOptions
          isClearable
          isMulti={isMulti}
          value={isMulti ? field.value || [] : field.value || null}
          noOptionsMessage={() => 'Opciones no disponible'}
          onChange={(newValue: any) => {
            if (onSelectChange) {
              onSelectChange(newValue);
              return;
            }
            if (isMulti) {
              // newValue puede ser un array o null
              setValue(newValue ?? []);
            } else {
              // newValue puede ser un objeto o null
              setValue(newValue ? newValue : null);
            }
          }}
          theme={reactSelectTheme}
          styles={reactSelectStyles}
          {...props}
        />
        {meta.touched && meta.error ? <span style={{ color: 'red' }}>{meta.error}</span> : null}
      </Box>
    );
  }
);
