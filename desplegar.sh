#!/usr/bin/env bash
# Despliegue de Mi Tienda Express en Supabase. Se puede ejecutar varias veces sin dañar nada.
set -euo pipefail

cd "$(dirname "$0")"

paso() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
error() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# 1. Archivo de llaves
paso "1/9 Revisando el archivo .env"
[ -f .env ] || error "No encontré el archivo .env. Copia .env.example a .env y llena las llaves."

# 2. Cargar y validar las 5 variables
paso "2/9 Cargando las llaves"
set -a
# shellcheck disable=SC1091
source .env
set +a
for variable in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET SUPER_ADMIN_TELEGRAM_ID SUPABASE_PROJECT_ID SUPABASE_DB_PASSWORD; do
  [ -n "${!variable:-}" ] || error "Falta el valor de $variable en el archivo .env"
done
echo "✔ Las 5 llaves tienen valor."

# 3. CLI de Supabase
paso "3/9 Buscando el CLI de Supabase"
if command -v supabase >/dev/null 2>&1; then
  SUPABASE="supabase"
elif command -v npx >/dev/null 2>&1; then
  SUPABASE="npx --yes supabase"
else
  echo "No encontré el CLI de Supabase. Instálalo así:"
  echo "  • macOS:   brew install supabase/tap/supabase"
  echo "  • Windows: scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase"
  echo "  • Linux / cualquiera con Node.js: npm install -g supabase  (o usa npx supabase)"
  error "Instala el CLI y vuelve a ejecutar ./desplegar.sh"
fi
echo "✔ Usando: $SUPABASE"

# 4. Sesión
paso "4/9 Verificando la sesión de Supabase"
if ! $SUPABASE projects list >/dev/null 2>&1; then
  echo "Se abrirá el navegador para iniciar sesión en Supabase..."
  $SUPABASE login
fi
echo "✔ Sesión activa."

# 5. Vincular el proyecto
paso "5/9 Vinculando el proyecto $SUPABASE_PROJECT_ID"
$SUPABASE link --project-ref "$SUPABASE_PROJECT_ID" -p "$SUPABASE_DB_PASSWORD"

# 6. Migraciones y semilla
paso "6/9 Aplicando migraciones y datos semilla"
if ! $SUPABASE db push --include-seed -p "$SUPABASE_DB_PASSWORD"; then
  echo "⚠️  Si el error menciona una extensión (unaccent, pg_net o pg_cron), actívala en"
  echo "    Supabase → Database → Extensions y vuelve a ejecutar este script."
  echo "⚠️  Si tu CLI no reconoce --include-seed, ejecuta 'supabase db push' y luego pega"
  echo "    el contenido de supabase/seed.sql en el SQL Editor de Supabase (ver README)."
  error "No se pudieron aplicar las migraciones."
fi

# 7. Secretos de la función (los SUPABASE_* son reservados y no se envían)
paso "7/9 Guardando los secretos del bot"
$SUPABASE secrets set \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  TELEGRAM_WEBHOOK_SECRET="$TELEGRAM_WEBHOOK_SECRET" \
  SUPER_ADMIN_TELEGRAM_ID="$SUPER_ADMIN_TELEGRAM_ID" \
  --project-ref "$SUPABASE_PROJECT_ID"

# 8. Desplegar la función
paso "8/9 Desplegando la función bot"
if ! $SUPABASE functions deploy bot --no-verify-jwt --project-ref "$SUPABASE_PROJECT_ID"; then
  echo "Reintentando sin Docker (--use-api)..."
  $SUPABASE functions deploy bot --no-verify-jwt --use-api --project-ref "$SUPABASE_PROJECT_ID"
fi

# 9. Webhook, comandos, tareas programadas y dueños semilla (lo hace Supabase, no tu red)
paso "9/9 Configurando el webhook de Telegram y las tareas automáticas"
curl -sS -X POST "https://$SUPABASE_PROJECT_ID.supabase.co/functions/v1/bot/configurar" \
  -H "x-secreto-tareas: $TELEGRAM_WEBHOOK_SECRET"
echo

printf '\n\033[1;32m✅ Listo. Abre Telegram y escríbele /start a @Mi_Tienda_Express_Bot\033[0m\n'
