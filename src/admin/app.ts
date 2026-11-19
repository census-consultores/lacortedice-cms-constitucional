import type { StrapiApp } from '@strapi/strapi/admin';

/**
 * Admin Panel · La Corte Dice Tributaria
 * Rediseño editorial v3.0 — Paleta marca madre: NEGRO + DORADO
 *
 * Alineado con el rediseño del admin del webapp SvelteKit.
 * Tokens:
 *   --ink        #111111
 *   --ink-900    #0A0A0A (sidebar)
 *   --gold       #B48A47
 *   --gold-bright #C9A560
 *   --gold-deep  #8E6B2F
 *   --paper      #FDFCF8
 *   --cream      #F5F2E9
 *   --line       #E9E4D6
 *   --muted      #706E5E (WCAG AA)
 * Tipografía:  Fraunces (serif editorial) + Inter (sans UI) + JetBrains Mono.
 */
export default {
  config: {
    locales: ['es'],
    translations: {
      es: {
        'Auth.form.welcome.title': 'Bienvenido',
        'Auth.form.welcome.subtitle': 'Panel Editorial · La Corte Dice',
        'HomePage.header.title': 'Hola, {name}',
        'HomePage.header.subtitle':
          'Panel de administración editorial de La Corte Dice Tributaria',
        'app.components.LeftMenu.navbrand.title': 'La Corte Dice',
        'app.components.LeftMenu.navbrand.subtitle': 'Tributaria · Admin',
        'Settings.application.strpiVersion': 'Versión',
        'Settings.application.edition': 'Edición'
      }
    },
    theme: {
      light: {
        colors: {
          // ─── Primarios · Dorado marca ───
          primary100: '#faf3df',
          primary200: '#f4ebd8',
          primary300: '#e4cf8c',
          primary400: '#c9a560',
          primary500: '#b48a47',
          primary600: '#8e6b2f',
          primary700: '#6b511f',

          buttonPrimary500: '#111111',
          buttonPrimary600: '#0a0a0a',

          // ─── Estados semánticos (cálidos editoriales) ───
          success100: '#ecf5ee',
          success200: '#d5e8d2',
          success500: '#3e7a47',
          success600: '#2f5e38',
          success700: '#244829',

          warning100: '#fbf2ea',
          warning200: '#efdfc9',
          warning500: '#b8823a',
          warning600: '#8c4216',
          warning700: '#6b2e0e',

          danger100: '#fbf2f0',
          danger200: '#efcfc9',
          danger500: '#9a3a2f',
          danger600: '#7a2d24',
          danger700: '#5e221c',

          // ─── Neutros · escala papel/crema/tinta ───
          neutral0: '#ffffff',
          neutral100: '#fdfcf8', // paper
          neutral150: '#f5f2e9', // cream
          neutral200: '#e9e4d6', // line
          neutral300: '#d7d0bd',
          neutral400: '#9a958a',
          neutral500: '#706e5e', // muted
          neutral600: '#4a4a48', // body
          neutral700: '#2a2a2a',
          neutral800: '#1c1c1c',
          neutral900: '#111111', // ink

          // ─── Alternativos (hover/acento) ───
          alternative100: '#faf3df',
          alternative200: '#f4ebd8',
          alternative500: '#c9a560',
          alternative600: '#b48a47',
          alternative700: '#8e6b2f',

          // ─── Secundarios · negro profundo (sidebar) ───
          secondary100: '#e8e6e0',
          secondary200: '#2a2a2a',
          secondary500: '#1c1c1c',
          secondary600: '#111111',
          secondary700: '#0a0a0a'
        }
      }
    },
    tutorials: false,
    notifications: { release: false },
    head: {
      title: 'La Corte Dice Tributaria · Admin'
    }
  },
  bootstrap(app: StrapiApp) {
    const style = document.createElement('style');
    style.id = 'lacorte-admin-v3-editorial';
    style.textContent = `
      /* ═══════════════════════════════════════════════════════════
         LA CORTE DICE TRIBUTARIA · STRAPI ADMIN v3.0
         Rediseño editorial — Negro + Dorado (marca madre)
         Alineado con webapp SvelteKit /admin
         ═══════════════════════════════════════════════════════════ */

      /* ─── FONT IMPORT ─── */
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

      /* ─── GLOBAL TOKENS ─── */
      :root {
        --lc-ink: #111111;
        --lc-ink-900: #0a0a0a;
        --lc-ink-800: #1c1c1c;
        --lc-ink-700: #2a2a2a;
        --lc-gold: #b48a47;
        --lc-gold-bright: #c9a560;
        --lc-gold-deep: #8e6b2f;
        --lc-gold-soft: #f4ebd8;
        --lc-paper: #fdfcf8;
        --lc-cream: #f5f2e9;
        --lc-line: #e9e4d6;
        --lc-line-soft: #f0ece0;
        --lc-body: #4a4a48;
        --lc-muted: #706e5e;
      }

      /* ─── GLOBAL TYPOGRAPHY ─── */
      *, *::before, *::after {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      body {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        background: var(--lc-paper) !important;
      }
      ::selection {
        background: var(--lc-gold-soft) !important;
        color: var(--lc-ink) !important;
      }

      /* ═══════════════════════════════════════════
         SIDEBAR · NEGRO PROFUNDO CON ACENTOS DORADOS
         ═══════════════════════════════════════════ */

      nav[aria-label="Content"],
      aside[class*="LeftMenu"],
      [class*="LeftMenu"] {
        background: var(--lc-ink-900) !important;
        border-right: 1px solid var(--lc-ink-700) !important;
      }

      /* Brand / logo area */
      nav[aria-label="Content"] header,
      aside header,
      [class*="LeftMenu"] header {
        border-bottom: 1px solid var(--lc-ink-800) !important;
        padding: 22px 18px !important;
        margin-bottom: 6px !important;
      }

      /* Brand title — Fraunces serif */
      [class*="LeftMenu"] header span,
      [class*="LeftMenu"] header p,
      nav[aria-label="Content"] header span {
        font-family: 'Fraunces', Georgia, serif !important;
        color: #ffffff !important;
        font-weight: 600 !important;
        font-size: 15.5px !important;
        letter-spacing: 0.2px !important;
      }

      /* Nav links — base */
      nav[aria-label="Content"] a,
      nav[aria-label="Content"] button[class*="Nav"] {
        color: #c7c2b4 !important;
        font-weight: 400 !important;
        font-size: 13.5px !important;
        border-radius: 0 !important;
        margin: 1px 0 !important;
        padding: 9px 22px !important;
        transition: all 0.13s cubic-bezier(0.4, 0, 0.2, 1) !important;
        border-left: 2px solid transparent !important;
      }
      nav[aria-label="Content"] a span,
      nav[aria-label="Content"] a p {
        color: inherit !important;
        font-size: 13.5px !important;
        font-weight: inherit !important;
      }

      /* Nav — hover */
      nav[aria-label="Content"] a:hover {
        background: rgba(255, 255, 255, 0.02) !important;
        color: #ffffff !important;
        border-left-color: var(--lc-ink-700) !important;
      }

      /* Nav — active */
      nav[aria-label="Content"] a[aria-current="page"] {
        background: linear-gradient(90deg, rgba(180, 138, 71, 0.12), transparent 70%) !important;
        color: #ffffff !important;
        font-weight: 500 !important;
        border-left-color: var(--lc-gold) !important;
      }

      /* Nav icons */
      nav[aria-label="Content"] svg {
        color: currentColor !important;
        opacity: 0.85 !important;
      }
      nav[aria-label="Content"] a[aria-current="page"] svg {
        opacity: 1 !important;
        color: var(--lc-gold) !important;
      }

      /* Sidebar dividers */
      nav[aria-label="Content"] [class*="Divider"],
      nav[aria-label="Content"] hr {
        border-color: var(--lc-ink-800) !important;
        margin: 12px 18px !important;
      }

      /* Strapi footer (discreet) */
      nav[aria-label="Content"] + div,
      aside footer,
      [class*="LeftMenu"] footer {
        opacity: 0.3 !important;
        transition: opacity 0.2s !important;
      }
      nav[aria-label="Content"] + div:hover,
      aside footer:hover {
        opacity: 0.55 !important;
      }

      /* Collapse button */
      [class*="CollapseButton"],
      nav[aria-label="Content"] ~ button {
        background: var(--lc-ink-800) !important;
        border-color: var(--lc-ink-700) !important;
        color: #c7c2b4 !important;
      }
      [class*="CollapseButton"]:hover {
        background: rgba(180, 138, 71, 0.15) !important;
        color: var(--lc-gold-bright) !important;
      }

      /* ═══════════════════════════════════════════
         MAIN CONTENT · PAPEL CÁLIDO
         ═══════════════════════════════════════════ */

      #strapi main,
      main[class*="Main"] {
        background: var(--lc-paper) !important;
      }

      /* Page header */
      main header,
      [class*="HeaderLayout"] {
        background: #ffffff !important;
        border-bottom: 1px solid var(--lc-line) !important;
        box-shadow: none !important;
      }

      /* ═══════════════════════════════════════════
         TIPOGRAFÍA EDITORIAL
         ═══════════════════════════════════════════ */

      h1 {
        font-family: 'Fraunces', Georgia, serif !important;
        color: var(--lc-ink) !important;
        font-weight: 600 !important;
        letter-spacing: -0.5px !important;
        font-size: 1.85rem !important;
      }
      h2 {
        font-family: 'Fraunces', Georgia, serif !important;
        color: var(--lc-ink) !important;
        font-weight: 600 !important;
        letter-spacing: -0.3px !important;
      }
      h3, h4, h5, h6 {
        font-family: 'Fraunces', Georgia, serif !important;
        color: var(--lc-ink) !important;
        font-weight: 600 !important;
        letter-spacing: -0.2px !important;
      }

      p, span, label, div {
        color: var(--lc-body);
      }

      [class*="SubNav"] span,
      [class*="subtitle"],
      [class*="description"] {
        color: var(--lc-muted) !important;
      }

      /* ═══════════════════════════════════════════
         CARDS · BORDES SUTILES, HOVER DORADO
         ═══════════════════════════════════════════ */

      [class*="ContentBox"],
      [class*="Box-"],
      [role="tabpanel"],
      [class*="ContentLayout"] > div > div {
        border-radius: 10px !important;
        border: 1px solid var(--lc-line) !important;
        background: #ffffff !important;
      }
      [class*="shadow"],
      [class*="ContentBox"] {
        box-shadow: 0 1px 2px rgba(17, 17, 17, 0.04) !important;
      }
      [class*="ContentBox"]:hover {
        border-color: var(--lc-gold) !important;
        box-shadow: 0 6px 24px -10px rgba(17, 17, 17, 0.18), 0 2px 8px rgba(17, 17, 17, 0.06) !important;
      }

      /* ═══════════════════════════════════════════
         TABLAS · CABECERA CREMA, HOVER DORADO SUAVE
         ═══════════════════════════════════════════ */

      table {
        border-radius: 10px !important;
        overflow: hidden !important;
        border-collapse: separate !important;
        border-spacing: 0 !important;
        border: 1px solid var(--lc-line) !important;
      }
      table thead {
        background: var(--lc-cream) !important;
      }
      table thead th {
        background: transparent !important;
        font-weight: 600 !important;
        font-size: 10.5px !important;
        text-transform: uppercase !important;
        letter-spacing: 2px !important;
        color: var(--lc-muted) !important;
        padding: 14px 18px !important;
        border-bottom: 1px solid var(--lc-line) !important;
        white-space: nowrap !important;
      }
      table tbody tr {
        transition: all 0.13s ease !important;
        border-bottom: 1px solid var(--lc-line-soft) !important;
      }
      table tbody tr:hover {
        background: rgba(180, 138, 71, 0.03) !important;
      }
      table tbody tr:last-child {
        border-bottom: none !important;
      }
      table tbody td {
        padding: 14px 18px !important;
        font-size: 13.5px !important;
        color: var(--lc-body) !important;
        vertical-align: middle !important;
      }
      table thead th:first-child,
      table tbody td:first-child {
        width: 48px !important;
        padding-left: 18px !important;
      }
      table input[type="checkbox"] {
        accent-color: var(--lc-gold) !important;
        width: 16px !important;
        height: 16px !important;
        border-radius: 3px !important;
      }

      /* ═══════════════════════════════════════════
         FORMULARIOS · FOCUS DORADO
         ═══════════════════════════════════════════ */

      input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]),
      textarea,
      select,
      [class*="ReactSelect__control"],
      [role="combobox"] {
        border-radius: 6px !important;
        border: 1px solid var(--lc-line) !important;
        background: #ffffff !important;
        font-size: 14px !important;
        color: var(--lc-ink) !important;
        transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
        padding: 10px 14px !important;
      }
      input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]):focus,
      textarea:focus,
      select:focus,
      [class*="ReactSelect__control--is-focused"] {
        border-color: var(--lc-gold) !important;
        box-shadow: 0 0 0 3px rgba(180, 138, 71, 0.12) !important;
        background: #ffffff !important;
        outline: none !important;
      }
      input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]):hover,
      textarea:hover,
      select:hover {
        border-color: #c7c0ad !important;
      }

      label {
        font-weight: 500 !important;
        font-size: 12.5px !important;
        color: var(--lc-ink) !important;
        margin-bottom: 6px !important;
        letter-spacing: 0.2px !important;
        text-transform: uppercase !important;
      }
      [class*="Hint"],
      [class*="Description"] p {
        font-size: 12px !important;
        color: var(--lc-muted) !important;
        margin-top: 4px !important;
      }
      label span[class*="required"] {
        color: #9a3a2f !important;
      }
      input:disabled,
      textarea:disabled,
      select:disabled {
        background: var(--lc-cream) !important;
        color: var(--lc-muted) !important;
        cursor: not-allowed !important;
        border-color: var(--lc-line) !important;
      }

      /* ═══════════════════════════════════════════
         BOTONES
         ═══════════════════════════════════════════ */

      /* Primary — negro editorial */
      button[class*="Primary"],
      button[type="submit"],
      a[class*="primary"] {
        background: var(--lc-ink) !important;
        color: #ffffff !important;
        border-radius: 6px !important;
        font-weight: 500 !important;
        font-size: 13.5px !important;
        letter-spacing: 0.2px !important;
        padding: 10px 18px !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
        border: 1px solid var(--lc-ink) !important;
        box-shadow: none !important;
      }
      button[class*="Primary"]:hover,
      button[type="submit"]:hover {
        background: var(--lc-ink-900) !important;
        transform: none !important;
        box-shadow: 0 4px 14px -4px rgba(17, 17, 17, 0.25) !important;
      }
      button[class*="Primary"]:active,
      button[type="submit"]:active {
        transform: translateY(0) !important;
      }

      /* Secondary/outline */
      button[class*="Secondary"],
      button[class*="Tertiary"] {
        border-radius: 6px !important;
        font-weight: 500 !important;
        font-size: 13.5px !important;
        transition: all 0.15s ease !important;
        border: 1px solid var(--lc-line) !important;
        background: #ffffff !important;
        color: var(--lc-ink) !important;
      }
      button[class*="Secondary"]:hover,
      button[class*="Tertiary"]:hover {
        border-color: var(--lc-ink) !important;
        background: #ffffff !important;
      }

      /* Danger */
      button[class*="Danger"] {
        border-radius: 6px !important;
        background: #9a3a2f !important;
        border-color: #9a3a2f !important;
        color: #ffffff !important;
      }
      button[class*="Danger"]:hover {
        background: #7a2d24 !important;
      }

      button[aria-label]:not([type="submit"]) {
        border-radius: 6px !important;
        transition: all 0.13s ease !important;
      }

      /* ═══════════════════════════════════════════
         TABS · UNDERLINE DORADO
         ═══════════════════════════════════════════ */

      [role="tablist"] {
        border-bottom: 1px solid var(--lc-line) !important;
        gap: 0 !important;
        background: transparent !important;
        padding: 0 4px !important;
      }
      [role="tab"] {
        font-weight: 500 !important;
        font-size: 13.5px !important;
        padding: 14px 20px !important;
        border-bottom: 2px solid transparent !important;
        margin-bottom: -1px !important;
        transition: all 0.15s ease !important;
        color: var(--lc-muted) !important;
        background: transparent !important;
        border-radius: 0 !important;
      }
      [role="tab"]:hover {
        color: var(--lc-ink) !important;
        background: transparent !important;
      }
      [role="tab"][aria-selected="true"] {
        color: var(--lc-ink) !important;
        border-bottom-color: var(--lc-gold) !important;
        font-weight: 600 !important;
        background: transparent !important;
      }

      /* ═══════════════════════════════════════════
         BADGES / CHIPS
         ═══════════════════════════════════════════ */

      [class*="Badge"],
      [class*="Tag"],
      [class*="Status"] {
        border-radius: 20px !important;
        font-weight: 600 !important;
        font-size: 10.5px !important;
        letter-spacing: 0.3px !important;
        padding: 3px 10px !important;
        text-transform: uppercase !important;
      }

      /* ═══════════════════════════════════════════
         BREADCRUMBS
         ═══════════════════════════════════════════ */

      nav[aria-label="breadcrumbs"],
      [class*="Breadcrumbs"] {
        font-size: 12.5px !important;
      }
      nav[aria-label="breadcrumbs"] span,
      nav[aria-label="breadcrumbs"] a {
        color: var(--lc-muted) !important;
      }
      nav[aria-label="breadcrumbs"] a:hover {
        color: var(--lc-ink) !important;
      }
      nav[aria-label="breadcrumbs"] [aria-current] {
        color: var(--lc-ink) !important;
        font-weight: 500 !important;
      }

      /* ═══════════════════════════════════════════
         LOGIN · FONDO NEGRO + CARD PAPEL
         ═══════════════════════════════════════════ */

      [class*="login"],
      [class*="Login"],
      [class*="AuthPage"],
      main:has(form[method="POST"]) {
        background:
          radial-gradient(ellipse at top, rgba(180, 138, 71, 0.08) 0%, transparent 60%),
          linear-gradient(145deg, #0a0a0a 0%, #111111 60%, #1c1c1c 100%) !important;
        min-height: 100vh !important;
      }
      [class*="login"] > div,
      [class*="Login"] > div,
      main:has(form[method="POST"]) > div {
        background: var(--lc-paper) !important;
        border-radius: 12px !important;
        box-shadow:
          0 20px 60px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(180, 138, 71, 0.15) !important;
        backdrop-filter: blur(10px) !important;
      }

      form[method="POST"] input {
        border-radius: 6px !important;
        padding: 12px 16px !important;
        font-size: 14px !important;
        border: 1px solid var(--lc-line) !important;
        background: #ffffff !important;
      }
      form[method="POST"] input:focus {
        background: #ffffff !important;
        border-color: var(--lc-gold) !important;
        box-shadow: 0 0 0 3px rgba(180, 138, 71, 0.12) !important;
      }

      /* Submit — negro sólido */
      form[method="POST"] button[type="submit"] {
        background: var(--lc-ink) !important;
        color: #ffffff !important;
        border-radius: 6px !important;
        font-weight: 500 !important;
        font-size: 14px !important;
        padding: 12px 24px !important;
        border: none !important;
        box-shadow: 0 4px 14px rgba(17, 17, 17, 0.3) !important;
        transition: all 0.2s ease !important;
        letter-spacing: 0.3px !important;
      }
      form[method="POST"] button[type="submit"]:hover {
        background: var(--lc-ink-900) !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 8px 24px rgba(17, 17, 17, 0.4) !important;
      }

      /* Login titulo — Fraunces */
      [class*="login"] h1,
      [class*="Login"] h1 {
        font-family: 'Fraunces', Georgia, serif !important;
        color: var(--lc-ink) !important;
        font-weight: 600 !important;
        font-size: 1.65rem !important;
        letter-spacing: -0.5px !important;
      }
      [class*="login"] [class*="subtitle"],
      [class*="Login"] [class*="subtitle"],
      [class*="login"] h2,
      [class*="Login"] h2 {
        color: var(--lc-muted) !important;
        font-weight: 400 !important;
        font-family: 'Inter', sans-serif !important;
      }

      form[method="POST"] a {
        color: var(--lc-gold-deep) !important;
        font-weight: 500 !important;
      }
      form[method="POST"] a:hover {
        color: var(--lc-ink) !important;
      }

      /* ═══════════════════════════════════════════
         DASHBOARD HOME
         ═══════════════════════════════════════════ */

      [class*="HomeHeader"] {
        background: transparent !important;
      }
      [class*="HomeHeader"] h1 {
        font-family: 'Fraunces', Georgia, serif !important;
        color: var(--lc-ink) !important;
        font-size: 1.85rem !important;
        font-weight: 600 !important;
        letter-spacing: -0.5px !important;
      }
      [class*="HomeHeader"] + div [class*="ContentBox"],
      [class*="HomeHeader"] ~ div [class*="Box"] {
        border-left: 3px solid var(--lc-gold) !important;
        border-radius: 10px !important;
        transition: all 0.2s ease !important;
      }
      [class*="HomeHeader"] + div [class*="ContentBox"]:hover,
      [class*="HomeHeader"] ~ div [class*="Box"]:hover {
        border-left-color: var(--lc-gold-bright) !important;
        transform: translateY(-1px) !important;
      }

      /* ═══════════════════════════════════════════
         MODALES
         ═══════════════════════════════════════════ */

      [class*="ModalOverlay"],
      [data-radix-portal] [class*="overlay"],
      [class*="Overlay"] {
        background: rgba(10, 10, 10, 0.55) !important;
        backdrop-filter: blur(4px) !important;
      }
      [class*="ModalContent"],
      [role="dialog"],
      [class*="Dialog"] {
        border-radius: 12px !important;
        box-shadow:
          0 20px 60px rgba(0, 0, 0, 0.2),
          0 0 0 1px rgba(17, 17, 17, 0.06) !important;
        overflow: hidden !important;
      }
      [role="dialog"] header,
      [class*="Dialog"] header {
        border-bottom: 1px solid var(--lc-line) !important;
        padding: 20px 24px !important;
      }
      [role="dialog"] footer,
      [class*="Dialog"] footer {
        border-top: 1px solid var(--lc-line) !important;
        padding: 16px 24px !important;
        background: var(--lc-cream) !important;
      }

      /* ═══════════════════════════════════════════
         PAGINACIÓN
         ═══════════════════════════════════════════ */

      [class*="Pagination"] button,
      [class*="pagination"] button {
        border-radius: 6px !important;
        font-weight: 500 !important;
        font-size: 13px !important;
        min-width: 36px !important;
        height: 36px !important;
        transition: all 0.13s ease !important;
      }
      [class*="Pagination"] button[aria-current="page"],
      [class*="pagination"] button[aria-current="page"] {
        background: var(--lc-ink) !important;
        color: #ffffff !important;
        font-weight: 600 !important;
        border: 1px solid var(--lc-ink) !important;
      }
      [class*="Pagination"] button:hover,
      [class*="pagination"] button:hover {
        background: var(--lc-cream) !important;
        color: var(--lc-ink) !important;
      }

      /* ═══════════════════════════════════════════
         ALERTAS Y NOTIFICACIONES
         ═══════════════════════════════════════════ */

      [role="alert"],
      [class*="Notification"] {
        border-radius: 8px !important;
        font-size: 13.5px !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08) !important;
      }
      [role="alert"][class*="success"],
      [class*="Notification"][class*="success"] {
        border-left: 3px solid #3e7a47 !important;
      }

      /* ═══════════════════════════════════════════
         EMPTY STATES
         ═══════════════════════════════════════════ */

      [class*="EmptyState"],
      [class*="NoContent"],
      [class*="EmptyBody"] {
        padding: 56px 24px !important;
      }
      [class*="EmptyState"] svg {
        width: 44px !important;
        height: 44px !important;
        color: var(--lc-line) !important;
        margin-bottom: 14px !important;
      }
      [class*="EmptyState"] p {
        color: var(--lc-muted) !important;
        font-size: 14px !important;
      }

      /* ═══════════════════════════════════════════
         SCROLLBAR
         ═══════════════════════════════════════════ */

      ::-webkit-scrollbar {
        width: 7px;
        height: 7px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: var(--lc-line);
        border-radius: 4px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: #c7c0ad;
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: var(--lc-line) transparent;
      }

      /* ═══════════════════════════════════════════
         TOOLTIPS
         ═══════════════════════════════════════════ */

      [role="tooltip"],
      [class*="Tooltip"] {
        background: var(--lc-ink) !important;
        color: #ffffff !important;
        border-radius: 4px !important;
        font-size: 11.5px !important;
        font-weight: 500 !important;
        font-family: 'JetBrains Mono', monospace !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
        padding: 5px 10px !important;
      }

      /* ═══════════════════════════════════════════
         DRAG & DROP
         ═══════════════════════════════════════════ */

      [class*="DragHandle"],
      [class*="drag"] svg {
        color: var(--lc-line) !important;
        transition: color 0.13s !important;
      }
      [class*="DragHandle"]:hover,
      [class*="drag"]:hover svg {
        color: var(--lc-gold) !important;
      }

      /* ═══════════════════════════════════════════
         RICH TEXT EDITOR
         ═══════════════════════════════════════════ */

      [class*="Editor"],
      .ck-editor,
      [class*="RichText"] {
        border-radius: 8px !important;
        overflow: hidden !important;
      }
      .ck-editor .ck-toolbar {
        background: var(--lc-cream) !important;
        border-bottom: 1px solid var(--lc-line) !important;
      }

      /* ═══════════════════════════════════════════
         MEDIA LIBRARY
         ═══════════════════════════════════════════ */

      [class*="AssetCard"],
      [class*="MediaCard"] {
        border-radius: 8px !important;
        border: 1px solid var(--lc-line) !important;
        overflow: hidden !important;
        transition: all 0.2s ease !important;
      }
      [class*="AssetCard"]:hover,
      [class*="MediaCard"]:hover {
        border-color: var(--lc-gold) !important;
        box-shadow: 0 4px 12px rgba(180, 138, 71, 0.12) !important;
      }

      /* ═══════════════════════════════════════════
         TOGGLES / SWITCHES
         ═══════════════════════════════════════════ */

      [class*="Toggle"][role="checkbox"],
      [class*="Switch"] {
        border-radius: 14px !important;
      }

      /* ═══════════════════════════════════════════
         LINKS (no-nav)
         ═══════════════════════════════════════════ */

      a:not(nav a):not([class*="Button"]):not([class*="primary"]) {
        color: var(--lc-gold-deep) !important;
        transition: color 0.13s ease !important;
      }
      a:not(nav a):not([class*="Button"]):not([class*="primary"]):hover {
        color: var(--lc-ink) !important;
      }

      /* ═══════════════════════════════════════════
         OCULTAR ELEMENTOS DE STRAPI (marketing)
         ═══════════════════════════════════════════ */

      [class*="GuidedTour"],
      [class*="guided-tour"],
      [class*="NPS"],
      [class*="Onboarding"],
      [class*="onboarding"],
      a[href="/admin/marketplace"],
      a[href*="marketplace"] {
        display: none !important;
      }

      /* ═══════════════════════════════════════════
         ANIMACIONES GLOBALES
         ═══════════════════════════════════════════ */

      [class*="ContentLayout"],
      [class*="Main"] > div {
        animation: lcFadeIn 0.25s ease-out;
      }
      @keyframes lcFadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      *:focus-visible {
        outline: 2px solid var(--lc-gold) !important;
        outline-offset: 2px !important;
        border-radius: 3px;
      }

      /* ═══════════════════════════════════════════
         SEARCH BAR
         ═══════════════════════════════════════════ */

      [class*="Searchbar"] input,
      input[type="search"],
      input[name="search"] {
        border-radius: 6px !important;
        background: #ffffff !important;
        border: 1px solid var(--lc-line) !important;
        padding: 10px 16px 10px 40px !important;
      }
      [class*="Searchbar"] input:focus,
      input[type="search"]:focus,
      input[name="search"]:focus {
        background: #ffffff !important;
        border-color: var(--lc-gold) !important;
        box-shadow: 0 0 0 3px rgba(180, 138, 71, 0.12) !important;
      }

      /* ═══════════════════════════════════════════
         FILTER CHIPS
         ═══════════════════════════════════════════ */

      [class*="FilterPopover"],
      [class*="Popover"] {
        border-radius: 10px !important;
        border: 1px solid var(--lc-line) !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08) !important;
      }
      [class*="FilterTag"],
      button[class*="filter"] {
        border-radius: 20px !important;
        font-size: 11.5px !important;
        background: var(--lc-gold-soft) !important;
        border: 1px solid rgba(180, 138, 71, 0.25) !important;
        color: var(--lc-gold-deep) !important;
        font-weight: 600 !important;
      }

      /* ═══════════════════════════════════════════
         CONTENT TYPE BUILDER
         ═══════════════════════════════════════════ */

      [class*="ComponentList"] > div,
      [class*="FieldList"] > div {
        border-radius: 6px !important;
        margin-bottom: 3px !important;
        transition: background 0.13s ease !important;
      }
      [class*="ComponentList"] > div:hover,
      [class*="FieldList"] > div:hover {
        background: var(--lc-cream) !important;
      }

      /* ═══════════════════════════════════════════
         SIDEBAR RIGHT (EDIT VIEW)
         ═══════════════════════════════════════════ */

      [class*="RightLinksSection"],
      [class*="InformationBox"],
      [class*="RelationBox"] {
        border-radius: 10px !important;
        border: 1px solid var(--lc-line) !important;
        background: #ffffff !important;
      }

      /* ═══════════════════════════════════════════
         LOADING STATES
         ═══════════════════════════════════════════ */

      [class*="Loading"] svg,
      [class*="Loader"] svg {
        color: var(--lc-gold) !important;
      }
      [class*="NProgress"],
      [class*="progress"] {
        background: var(--lc-gold) !important;
      }

      /* ═══════════════════════════════════════════
         CÓDIGO / MONO
         ═══════════════════════════════════════════ */

      code, kbd, pre, samp {
        font-family: 'JetBrains Mono', ui-monospace, monospace !important;
        font-size: 12.5px !important;
      }

      /* ═══════════════════════════════════════════
         PRINT
         ═══════════════════════════════════════════ */

      @media print {
        nav[aria-label="Content"],
        aside[class*="LeftMenu"],
        [class*="LeftMenu"] {
          display: none !important;
        }
        #strapi main {
          background: white !important;
        }
      }
    `;
    document.head.appendChild(style);

    // Favicon dinámico (monograma dorado)
    const existingFavicon = document.querySelector('link[rel="icon"]');
    if (existingFavicon) existingFavicon.remove();

    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/svg+xml';
    favicon.href =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
          '<rect width="100" height="100" rx="14" fill="#0a0a0a"/>' +
          '<text x="50" y="68" text-anchor="middle" font-family="Georgia, serif" ' +
          'font-size="56" font-weight="600" fill="#b48a47">LC</text>' +
          '</svg>'
      );
    document.head.appendChild(favicon);
  }
};
