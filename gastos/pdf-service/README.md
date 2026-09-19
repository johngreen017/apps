# Despliegue del lector privado de liquidaciones

Este servicio abre únicamente la liquidación de sueldo cifrada, extrae el monto líquido y devuelve solo ese monto a Apps Script.

## Despliegue desde Codespaces

Desde la raíz del repositorio:

```bash
cd gastos/pdf-service
chmod +x deploy-cloud-run.sh
gcloud auth login
./deploy-cloud-run.sh
```

El script:
1. usa/solicita tu Google Cloud Project ID;
2. habilita Cloud Run, Cloud Build, Secret Manager y Artifact Registry;
3. pide la clave del PDF sin mostrarla;
4. genera un token aleatorio;
5. guarda ambos como secretos de Google Cloud;
6. despliega el servicio en `southamerica-west1`;
7. muestra al final dos valores para Apps Script:
   - `SALARY_PDF_SERVICE_URL`
   - `SALARY_PDF_SERVICE_TOKEN`

La clave del PDF nunca debe guardarse en GitHub ni pegarse en el chat.

## Costos

Cloud Run queda con mínimo de 0 instancias y máximo de 2. Para el uso mensual de Mis Gastos el consumo esperado es muy bajo, pero Google Cloud puede exigir una cuenta de facturación activa.
