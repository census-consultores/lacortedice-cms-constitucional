#!/usr/bin/env bash
# Sincroniza la BD local de Docker (Strapi) con un dump fresco de Render.
# Pensado para trabajar el proyecto en modo DEV.
# Flujo: pg_dump (Render) -> drop local -> create local -> pg_restore.
#
# Requisitos:
#   - docker compose levantado con un servicio postgres (en este repo: `db`).
#   - Variable RENDER_DATABASE_URL definida en .env (o exportada en el shell).
#     Formato: postgresql://USER:PASS@HOST:PORT/DBNAME?sslmode=require
#
# Uso:
#   ./scripts/sync_render_db.sh          # pide confirmación
#   ./scripts/sync_render_db.sh -y       # sin confirmación
#
# Detección automática (no hace falta configurar nada en máquinas nuevas):
#   - Contenedor: docker compose ps -q db, fallback a primer contenedor con
#     imagen postgres*. Override con DB_CONTAINER=...
#   - Usuario y BD: se leen del env del contenedor (POSTGRES_USER / POSTGRES_DB).
#     Override con LOCAL_USER=... LOCAL_DB=...
#
# Nota: si tienes `npm run develop` corriendo localmente (Strapi conectado
# a esta BD), el script igual termina sus conexiones con pg_terminate_backend
# antes del DROP. Aun así, recomiendo detenerlo manualmente para evitar que
# Strapi intente reconectarse a una BD que está siendo recreada.

set -euo pipefail

# ---------- Rutas base ----------
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMPS_DIR_HOST="${PROJECT_DIR}/dumps"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILENAME="render_${TIMESTAMP}.dump"

# ---------- Localizar docker-compose.yml (repo raíz suele estar un nivel arriba) ----------
COMPOSE_FILE=""
for candidate in \
  "${PROJECT_DIR}/docker-compose.yml" \
  "${PROJECT_DIR}/docker-compose.yaml" \
  "${PROJECT_DIR}/../docker-compose.yml" \
  "${PROJECT_DIR}/../docker-compose.yaml"; do
  if [ -f "$candidate" ]; then COMPOSE_FILE="$candidate"; break; fi
done

# ---------- Flags ----------
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Argumento no reconocido: $arg" >&2; exit 1 ;;
  esac
done

# ---------- Colores ----------
if [ -t 1 ]; then
  C_BLUE="\033[1;34m"; C_GREEN="\033[1;32m"; C_YELLOW="\033[1;33m"
  C_RED="\033[1;31m"; C_RESET="\033[0m"
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi
log()  { printf "${C_BLUE}[sync]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}[ok]${C_RESET}   %s\n" "$*"; }
warn() { printf "${C_YELLOW}[warn]${C_RESET} %s\n" "$*"; }
err()  { printf "${C_RED}[err]${C_RESET}  %s\n" "$*" >&2; }

# ---------- Cargar RENDER_DATABASE_URL desde .env si no está exportada ----------
if [ -z "${RENDER_DATABASE_URL:-}" ] && [ -f "${PROJECT_DIR}/.env" ]; then
  RENDER_DATABASE_URL="$(grep -E '^RENDER_DATABASE_URL=' "${PROJECT_DIR}/.env" | tail -n1 | cut -d'=' -f2- || true)"
  RENDER_DATABASE_URL="${RENDER_DATABASE_URL%\"}"
  RENDER_DATABASE_URL="${RENDER_DATABASE_URL#\"}"
  RENDER_DATABASE_URL="${RENDER_DATABASE_URL%\'}"
  RENDER_DATABASE_URL="${RENDER_DATABASE_URL#\'}"
fi

if [ -z "${RENDER_DATABASE_URL:-}" ]; then
  err "Falta RENDER_DATABASE_URL. Añádela a .env:"
  err "  RENDER_DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DBNAME?sslmode=require"
  exit 1
fi

# ---------- Detectar contenedor de Postgres ----------
# Prioridad: $DB_CONTAINER (override) > docker compose service `db` > primer contenedor postgres*.
if [ -z "${DB_CONTAINER:-}" ] && [ -n "$COMPOSE_FILE" ]; then
  CID="$(docker compose -f "$COMPOSE_FILE" ps -q db 2>/dev/null || true)"
  if [ -n "$CID" ]; then
    DB_CONTAINER="$(docker inspect --format '{{.Name}}' "$CID" | sed 's|^/||')"
  fi
fi
if [ -z "${DB_CONTAINER:-}" ]; then
  DB_CONTAINER="$(docker ps --format '{{.Names}}\t{{.Image}}' | awk -F'\t' '$2 ~ /(^|\/)postgres/ {print $1; exit}')"
fi
if [ -z "${DB_CONTAINER:-}" ]; then
  err "No se detectó ningún contenedor Postgres corriendo."
  err "Levanta el servicio (ej: docker compose up -d db) o exporta DB_CONTAINER=<nombre>."
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  err "Contenedor ${DB_CONTAINER} no está corriendo."
  exit 1
fi

# ---------- Detectar usuario y BD desde env del contenedor ----------
# Override con LOCAL_USER / LOCAL_DB exportados.
CONTAINER_ENV="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
if [ -z "${LOCAL_USER:-}" ]; then
  LOCAL_USER="$(echo "$CONTAINER_ENV" | awk -F= '/^POSTGRES_USER=/{print $2; exit}')"
  LOCAL_USER="${LOCAL_USER:-postgres}"
fi
if [ -z "${LOCAL_DB:-}" ]; then
  LOCAL_DB="$(echo "$CONTAINER_ENV" | awk -F= '/^POSTGRES_DB=/{print $2; exit}')"
  LOCAL_DB="${LOCAL_DB:-strapi}"
fi

log "Contenedor: ${DB_CONTAINER}  ·  usuario: ${LOCAL_USER}  ·  BD: ${LOCAL_DB}"

mkdir -p "${DUMPS_DIR_HOST}"

# ---------- Confirmación ----------
cat <<EOF
Se va a:
  1. Hacer pg_dump desde Render (URL en RENDER_DATABASE_URL).
  2. Terminar conexiones activas a la BD local.
  3. DROP DATABASE ${LOCAL_DB} (¡se borra la BD local!).
  4. CREATE DATABASE ${LOCAL_DB} y pg_restore del dump.

Contenedor destino: ${DB_CONTAINER}
Dump quedará en:    ${DUMPS_DIR_HOST}/${DUMP_FILENAME}
EOF

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "¿Continuar? [s/N]: " resp
  case "$resp" in
    s|S|si|Si|SI|y|Y|yes|YES) ;;
    *) echo "Cancelado."; exit 0 ;;
  esac
fi

# ---------- 1. pg_dump desde Render ----------
# Escribimos el dump en /tmp dentro del contenedor (siempre existe) y luego
# lo sacamos al host con `docker cp`. Así no dependemos de tener /dumps montado.
DUMP_PATH_CONTAINER="/tmp/${DUMP_FILENAME}"
DUMP_PATH_HOST="${DUMPS_DIR_HOST}/${DUMP_FILENAME}"

log "Descargando dump desde Render (formato custom)..."
docker exec -e PGURL="$RENDER_DATABASE_URL" "$DB_CONTAINER" \
  bash -c "pg_dump --format=custom --no-owner --no-privileges --verbose --file=${DUMP_PATH_CONTAINER} \"\$PGURL\"" 2> >(grep -v -E '^pg_dump: (saving|reading|dumping|finding|processing)' >&2 || true)

log "Copiando dump al host..."
docker cp "${DB_CONTAINER}:${DUMP_PATH_CONTAINER}" "${DUMP_PATH_HOST}"

if [ ! -f "${DUMP_PATH_HOST}" ]; then
  err "El dump no se generó en ${DUMP_PATH_HOST}"
  exit 1
fi
DUMP_SIZE="$(du -h "${DUMP_PATH_HOST}" | cut -f1)"
ok "Dump descargado: ${DUMP_FILENAME} (${DUMP_SIZE})"

# ---------- 2 + 3 + 4. Terminar conexiones + drop + create + restore ----------
log "Terminando conexiones activas a ${LOCAL_DB}..."
docker exec "$DB_CONTAINER" psql -U "$LOCAL_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${LOCAL_DB}' AND pid <> pg_backend_pid();" >/dev/null

log "DROP DATABASE ${LOCAL_DB}..."
docker exec "$DB_CONTAINER" psql -U "$LOCAL_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS ${LOCAL_DB};" >/dev/null

log "CREATE DATABASE ${LOCAL_DB}..."
docker exec "$DB_CONTAINER" psql -U "$LOCAL_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE ${LOCAL_DB} OWNER ${LOCAL_USER};" >/dev/null

log "Restaurando dump (esto puede tardar)..."
docker exec "$DB_CONTAINER" pg_restore \
  --username="$LOCAL_USER" \
  --dbname="$LOCAL_DB" \
  --no-owner --no-privileges \
  --jobs=4 \
  "${DUMP_PATH_CONTAINER}" || {
    warn "pg_restore terminó con warnings (normal si hay extensiones/roles que no existen). Revisa arriba."
  }
ok "Restore completado."

# Limpiamos el dump del contenedor (en host se conserva).
docker exec "$DB_CONTAINER" rm -f "${DUMP_PATH_CONTAINER}" || true

ok "Listo. BD local sincronizada con Render."
echo "Dump conservado en: ${DUMP_PATH_HOST}"
echo
echo "Si tenías Strapi corriendo (npm run develop), reinícialo para que tome"
echo "el nuevo estado de la BD."
