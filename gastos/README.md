# Mis Gastos

Frontend en GitHub Pages + backend Google Apps Script + Google Sheets.

## Hoja
Control de Gastos:
https://docs.google.com/spreadsheets/d/1yOX3FL_KemWqDT9IBNcBLm3pC63U42-j4to-yC-0Hfk/edit

## Publicación
1. Crear/abrir un proyecto de Google Apps Script.
2. Copiar `apps-script/Code.gs` y `apps-script/Gmail.gs`.
3. Implementar > Nueva implementación > Aplicación web.
4. Ejecutar como: yo.
5. Acceso: según el nivel de privacidad deseado.
6. Copiar la URL que termina en `/exec` y pegarla en `app.js` como `GAS_URL`.

## Funciones V0.1
- Lectura de Gmail de los últimos 30 días.
- Detección genérica de correos de compra/cargo/transferencia.
- Deduplicación por Gmail Message ID.
- Clasificación básica.
- Alta manual de gastos.
- Dashboard mensual simple.
