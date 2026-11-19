import { Page } from '@strapi/strapi/admin';
import { Routes, Route } from 'react-router-dom';
import { DesignSystemProvider, lightTheme } from '@strapi/design-system';
import HomePage from './HomePage';
import { useEffect } from 'react';

const customTheme = {
  ...lightTheme,
  colors: {
    ...lightTheme.colors,
    primary100: "#f8f4e3",
    primary200: "#f3e6b8",
    primary300: "#eed98c",
    primary400: "#e2bc34",
    primary500: "#d1a92f",
    primary600: "#c09a2b",
    primary700: "#b49a3a",
    buttonPrimary500: "#b49a3a",
    buttonPrimary600: "#c09a2b",
  },
};

const App = () => {
  useEffect(() => {
    document.title = 'Panel de Usuarios - La Corte Dice Tributaria';
  }, []);

  return (
    <DesignSystemProvider locale="es-ES" theme={customTheme}>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="*" element={<Page.Error />} />
      </Routes>
    </DesignSystemProvider>
  );
};

export { App };
