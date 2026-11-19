# lacortedice-cms-constitucional

CMS (Strapi 5) de La Corte Dice — garantías constitucionales. Derivado de `lacortedice-cms-civil` el 19-nov-2026; `SEED_MATERIA=constitucional` siembra `data/materia/constitucional.json`. El Blueprint de Render es `render.yaml` (base + CMS + worker `lacortedice-extractor-constitucional`).

---

Texto original del CMS civil:


CMS (Strapi 5) de sentencias en materia **Civil y Mercantil**, backend de `lacortedice-extractor-civil`. Ver [DERIVACION.md](DERIVACION.md) para qué cambió respecto al CMS tributario y cómo ponerlo en marcha. Siembra de catálogos: `node scripts/seed-materia.js civil`.

---

# Acerca de La Corte Dice Tributaria

Esta aplicación fue realizada con Strapi 5 como base de desarrollo, facilita la creación de APIs con su arquitectura headless, ofreciendo un panel de administración intuitivo, gestión de contenido flexible, autenticación robusta, API REST y GraphQL integradas, y una extensa personalización mediante plugins. Su enfoque en la experiencia del desarrollador y la escalabilidad lo convierte en la solución ideal para proyectos modernos.

## 📦 Plugins personalizado para registro de causas legales

El sistema incluye una carpeta de plugin personalizada ubicada en:
`src/plugins/causas`

La primera vez ejecuta

```
npm install
```

### `build`

Construye tus cambios

```
npm run build
```

### `watch`

Recarga la vista en el navegador para desarrollo

```
npm run watch
```

# 🚀 Comenzando con Strapi

Strapi viene con una [Interfaz de Línea de Comandos](https://docs.strapi.io/dev-docs/cli) (CLI) completa que te permite crear y gestionar tu proyecto en segundos.

La primera vez ejecuta

```
npm install
```

### `develop`

Inicia tu aplicación Strapi en modo desarrollo

```
npm run develop
# o
yarn develop
```

### `build`

Construye tu panel de administración antes de lanzar a producción. [Aprende más](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# o
yarn build
```

## ⚙️ Despliegue autoalojado

Dependiendo de su preferencia, puede construir soluciones con Docker o instalar PM2 para lanzar aplicaciones basadas en Nodejs. En ambos casos debe terminar ejecutando npm start para producción:

```
npm run start
# o
yarn start
```

## ⚙️ Despliegue en la nube

Strapi te ofrece muchas opciones de despliegue para tu proyecto, incluyendo [Strapi Cloud](https://cloud.strapi.io). Explora la [sección de despliegue de la documentación](https://docs.strapi.io/dev-docs/deployment) para encontrar la mejor solución para tu caso de uso.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

# <sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>

## 📚 Aprende más

- [Centro de recursos](https://strapi.io/resource-center) - Centro de recursos de Strapi.
- [Documentación de Strapi](https://docs.strapi.io) - Documentación oficial de Strapi.
- [Tutoriales de Strapi](https://strapi.io/tutorials) - Lista de tutoriales creados por el equipo principal y la comunidad.
- [Blog de Strapi](https://strapi.io/blog) - Blog oficial de Strapi que contiene artículos creados por el equipo de Strapi y la comunidad.
- [Registro de cambios](https://strapi.io/changelog) - Descubre las actualizaciones del producto Strapi, nuevas características y mejoras generales.

No dudes en revisar el [repositorio de GitHub de Strapi](https://github.com/strapi/strapi). ¡Tus comentarios y contribuciones son bienvenidos!

## ✨ Comunidad

- [Discord](https://discord.strapi.io) - Ven a charlar con la comunidad de Strapi, incluyendo el equipo principal.
- [Foro](https://forum.strapi.io/) - Lugar para discutir, hacer preguntas y encontrar respuestas, mostrar tu proyecto Strapi y recibir retroalimentación o simplemente hablar con otros miembros de la comunidad.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - Una lista curada de cosas increíbles relacionadas con Strapi.

<sub>🤫 ¡Psst! [Strapi está contratando](https://strapi.io/careers).</sub>
