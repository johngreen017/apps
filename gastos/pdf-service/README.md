# Salary PDF Service

Servicio privado para Mis Gastos. Su única función es abrir la liquidación de sueldo cifrada recibida por Gmail, extraer el monto líquido y devolver solo ese monto a Apps Script.

## Variables privadas

- `PDF_PASSWORD`: clave del PDF. Guardarla como secreto del runtime, nunca en GitHub.
- `SERVICE_TOKEN`: token aleatorio compartido con Apps Script.
- `PORT`: lo define Cloud Run.

## Endpoint

`POST /extract-salary`

Header:
`Authorization: Bearer <SERVICE_TOKEN>`

Body:
`{"pdfBase64":"...","filename":"liquidacion.pdf"}`

Respuesta:
`{"ok":true,"monto":1234567,"moneda":"CLP"}`

El servicio no persiste el PDF, no devuelve el texto completo y no registra la clave ni el contenido de la liquidación.

## Despliegue recomendado

Google Cloud Run con autenticación de aplicación mediante `SERVICE_TOKEN` y `PDF_PASSWORD` inyectada desde Secret Manager. Tras desplegar, configurar en Apps Script las propiedades:

- `SALARY_PDF_SERVICE_URL`
- `SALARY_PDF_SERVICE_TOKEN`

La clave del PDF debe quedar solo en el secreto del servicio, no en Apps Script ni en este repositorio.
