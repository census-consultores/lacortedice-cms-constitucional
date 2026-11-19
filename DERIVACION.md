# CMS derivado por materia (laboral / civil)

Este repositorio es una derivación de `lacortedice-cms` (Strapi 5, CMS de La
Corte Dice Tributaria) para servir de backend a un extractor de otra materia
(`lacortedice-extractor-laboral` / `lacortedice-extractor-civil`). Se despliega
como un Strapi **independiente**, con su propio Postgres, para no mezclar
materias con el buscador tributario.

## Qué cambió respecto al CMS tributario

- `causa`: `acto_impugnado` → **`pretensiones`**, `otros_actos_administrativos`
  → **`excepciones`** (y sus etiquetas en el plugin `causas`); nueva relación
  `apelacion` (oneToOne).
- **`apelacion`** (nuevo content-type, `/api/apelaciones`): espejo de `casacion`
  para la sentencia de la Sala de la Corte Provincial — `causa`, `instancia`,
  `fecha_de_emision`, `antecedentes`, `recurrentes`, `causal_invocadas`,
  `argumentos_del_recurrente`, `argumentos_contraparte`, `decision_final` →
  `decision-final-apelacion`, `medidas_adicionales`, `voto_salvado`,
  `argumento_juez_salvado`, `jurisprudencia_mencionada`,
  `criterio_sala_para_resolver`, `observaciones`, `juez`, `jueces`, `file_pdf`,
  `fecha_inicio_apel`, `fecha_sentencia_apel`, `duracion_dias_apel`.
- **`decision-final-apelacion`** (nuevo catálogo, `/api/decisiones-finales-apelacion`):
  Confirma / Revoca / Reforma / Declara la nulidad.
- `juez`: relación inversa `apelaciones`.
- `data/materia/{laboral,civil}.json` + `scripts/seed-materia.js`: siembra
  idempotente de decisiones, tipos de procedimiento, estados del juicio,
  categorías (24 padres + subcategorías, desde `prompts/catalogo.txt` del
  extractor) y judicaturas.

Lo que **no** cambió: plugins `admin-panel`, `analytics-ingest` y `causas`,
correos, push, tribuna, campañas, juegos. Varios textos de producto (correos,
pantallas del admin) siguen diciendo "tributaria": son de la capa de producto y
se cambian cuando se decida la marca de cada materia.

## Puesta en marcha

1. Render: Postgres nuevo + Web Service (Node 20, `pnpm install && pnpm build`,
   `pnpm start`) con las mismas variables que el CMS tributario
   (`DATABASE_URL` o `DATABASE_*`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`,
   `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, SMTP de Titan si se usan correos).
   Strapi crea las tablas al arrancar.
2. Primer arranque: crear el usuario admin en `/admin` y un **API token Full
   access** para el worker (`STRAPI_API_TOKEN` del extractor).
3. Sembrar catálogos (con las variables de la base en el entorno):
   ```bash
   node scripts/seed-materia.js laboral            # o civil
   node scripts/seed-materia.js laboral --tribunales judicaturas.json   # nombres de JUDICATURAS del extractor
   ```
4. Apuntar el extractor: `STRAPI_URL`, `STRAPI_API_TOKEN`, `DATABASE_URL`
   (misma base: el worker crea ahí sus tablas `worker_*`).
