#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="mis-gastos-salary-pdf"
REGION="${REGION:-southamerica-west1}"
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud no está instalado en este Codespace."
  exit 1
fi

if [ -z "${PROJECT_ID}" ] || [ "${PROJECT_ID}" = "(unset)" ]; then
  read -r -p "Google Cloud Project ID: " PROJECT_ID
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

echo "Habilitando servicios necesarios..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com >/dev/null

echo "Configurando secretos privados..."
read -r -s -p "Clave del PDF de liquidación (no se mostrará): " PDF_PASSWORD
echo
if [ -z "${PDF_PASSWORD}" ]; then
  echo "ERROR: La clave no puede estar vacía."
  exit 1
fi

SERVICE_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

upsert_secret () {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
  fi
}

upsert_secret "mis-gastos-pdf-password" "${PDF_PASSWORD}"
upsert_secret "mis-gastos-service-token" "${SERVICE_TOKEN}"
unset PDF_PASSWORD

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding mis-gastos-pdf-password \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

gcloud secrets add-iam-policy-binding mis-gastos-service-token \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

echo "Desplegando Cloud Run..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gcloud run deploy "${SERVICE_NAME}" \
  --source "${SCRIPT_DIR}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-secrets="PDF_PASSWORD=mis-gastos-pdf-password:latest,SERVICE_TOKEN=mis-gastos-service-token:latest" \
  --memory=512Mi \
  --cpu=1 \
  --min=0 \
  --max=2 \
  --quiet

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"

echo
echo "=============================================="
echo "DESPLIEGUE COMPLETADO"
echo "SALARY_PDF_SERVICE_URL=${SERVICE_URL}"
echo "SALARY_PDF_SERVICE_TOKEN=${SERVICE_TOKEN}"
echo "=============================================="
echo
echo "Guarda ambos valores en Apps Script > Project Settings > Script Properties."
echo "El token se muestra una sola vez. No lo pegues en GitHub."
