const SPREADSHEET_ID = '1yOX3FL_KemWqDT9IBNcBLm3pC63U42-j4to-yC-0Hfk';
const SHEET_MOVIMIENTOS = 'MOVIMIENTOS';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  if (action === 'list') return json_({ ok:true, movimientos:listMovimientos_(Number(e.parameter.limit || 100)) });
  if (action === 'sync') return json_(syncGmail_());
  return json_({ ok:true, service:'Mis Gastos', version:'0.2.0' });
}

function doPost(e) {
  const action = e.parameter.action;
  if (action === 'add') {
    const payload = JSON.parse(e.parameter.payload || '{}');
    return json_({ ok:true, movimiento:addMovimiento_(payload) });
  }
  return json_({ ok:false, error:'Acción no soportada' });
}

function ss_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }

function listMovimientos_(limit) {
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  const last=sh.getLastRow();
  if(last<2) return [];
  const start=Math.max(2,last-limit+1);
  const values=sh.getRange(start,1,last-start+1,16).getValues().reverse();
  return values.map(r=>({
    id:r[0],fecha:r[1],hora:r[2],descripcion:r[3],comercio:r[4],monto:r[5],moneda:r[6],
    categoria:r[7],subcategoria:r[8],banco:r[9],cuenta:r[10],tipo:r[11],cuotas:r[12],
    fuente:r[13],mensajeId:r[14],estado:r[15]
  }));
}

function addMovimiento_(m) {
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  const fecha=m.fecha ? new Date(m.fecha) : new Date();
  const id=m.id || Utilities.getUuid();
  const row=[
    id, fecha, Utilities.formatDate(fecha,'America/Santiago','HH:mm:ss'),
    m.descripcion||'', m.comercio||'', Number(m.monto||0), m.moneda||'CLP',
    m.categoria||'Otros', m.subcategoria||'', m.banco||'', m.cuenta||'',
    m.tipo||'GASTO', m.cuotas||'', m.fuente||'MANUAL', m.mensajeId||'', m.estado||'CONFIRMADO'
  ];
  sh.appendRow(row);
  return {id,fecha:fecha.toISOString(),descripcion:row[3],comercio:row[4],monto:row[5],categoria:row[7]};
}

function existeMensaje_(messageId) {
  if(!messageId) return false;
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  if(sh.getLastRow()<2) return false;
  return sh.getRange(2,15,sh.getLastRow()-1,1).createTextFinder(messageId).matchEntireCell(true).findNext() !== null;
}

function instalar() {
  // Ejecutar una vez desde Apps Script. Solicita permisos y deja la sincronización automática activa.
  syncGmail_();

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncGmail_')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncGmail_')
    .timeBased()
    .everyHours(1)
    .create();

  PropertiesService.getScriptProperties().setProperty('INSTALADO_EN', new Date().toISOString());
  return 'Instalación completada: Gmail sincroniza automáticamente cada hora.';
}

function desinstalarTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncGmail_')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}