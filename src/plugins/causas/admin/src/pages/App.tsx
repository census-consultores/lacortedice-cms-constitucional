import { Page } from '@strapi/strapi/admin';
import { Routes, Route } from 'react-router-dom';
import { DesignSystemProvider, lightTheme } from '@strapi/design-system';
import HomePage from './HomePage';
import { useEffect } from 'react';

const customTheme = {
  ...lightTheme,
  colors: {
    ...lightTheme.colors,
    // Alineado con el frontend (app.css)
    primary100: "#f8f4e3",
    primary200: "#f3e6b8",
    primary300: "#eed98c",
    primary400: "#e2bc34",
    primary500: "#d1a92f",
    primary600: "#c09a2b",
    primary700: "#b49a3a",
    buttonPrimary500: "#b49a3a",
    buttonPrimary600: "#c09a2b",
    neutral100: "#f9fafb",
    neutral200: "#e5e7eb",
    neutral300: "#d1d5db",
    neutral500: "#6b7280",
    neutral600: "#4b5563",
    neutral700: "#374151",
    neutral800: "#1f2937",
    neutral900: "#111827",
  },
};

const App = () => {
  useEffect(() => {
    document.title = 'Registros Legales - La Corte Dice Tributaria';
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
