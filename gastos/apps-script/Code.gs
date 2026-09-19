const SPREADSHEET_ID = '1yOX3FL_KemWqDT9IBNcBLm3pC63U42-j4to-yC-0Hfk';
const SHEET_MOVIMIENTOS = 'MOVIMIENTOS';
const SHEET_REGLAS = 'REGLAS';
const SHEET_INGRESOS = 'INGRESOS';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  if (action === 'list') return json_({
    ok:true,
    movimientos:listMovimientos_(Number(e.parameter.limit || 300)),
    ingresos:listIngresos_(Number(e.parameter.incomeLimit || 100))
  });
  if (action === 'sync') return json_(syncGmail_());
  return json_({ ok:true, service:'Mis Gastos', version:'0.4.0' });
}

function doPost(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'add') {
    const payload = JSON.parse(e.parameter.payload || '{}');
    return json_({ ok:true, movimiento:addMovimiento_(payload) });
  }

  if (action === 'add_income') {
    const monto = Number(String(e.parameter.monto || '0').replace(/[^0-9]/g,''));
    if (!monto || monto <= 0) return json_({ ok:false, error:'Monto inválido' });
    const ingreso = addIngreso_({
      fecha:e.parameter.fecha || new Date(),
      tipo:String(e.parameter.tipo || 'SUELDO').toUpperCase(),
      descripcion:String(e.parameter.descripcion || 'Sueldo').trim(),
      monto,
      moneda:'CLP',
      fuente:'MANUAL',
      periodo:String(e.parameter.periodo || '').trim(),
      estado:'CONFIRMADO'
    });
    return json_({ ok:true, ingreso });
  }

  if (action === 'update') {
    const id = String(e.parameter.id || '').trim();
    if (!id) return json_({ ok:false, error:'Falta ID del movimiento' });

    const patch = {
      comercio:String(e.parameter.comercio || '').trim(),
      categoria:String(e.parameter.categoria || '').trim(),
      subcategoria:String(e.parameter.subcategoria || '').trim()
    };

    const movimiento = actualizarMovimiento_(id, patch);
    if (!movimiento) return json_({ ok:false, error:'Movimiento no encontrado' });

    if (String(e.parameter.aprender || '') === '1' && patch.comercio && patch.categoria) {
      guardarRegla_(patch.comercio, 'Comercio', patch.categoria, patch.subcategoria, movimiento.banco || '');
    }
    return json_({ ok:true, movimiento });
  }

  if (action === 'shortcut') {
    const tipo = String(e.parameter.tipo || 'COMPRA').toUpperCase();
    const comercio = String(e.parameter.comercio || '').trim();
    const banco = String(e.parameter.banco || '').trim();
    const monto = Number(String(e.parameter.monto || '0').replace(/[^0-9]/g,''));

    if (!monto || monto <= 0) return json_({ ok:false, error:'Monto inválido' });

    const tipoValido = ['COMPRA','PAGO','TRANSFERENCIA','GIRO'].includes(tipo) ? tipo : 'COMPRA';
    let descripcion = String(e.parameter.descripcion || '').trim();

    if (!descripcion) {
      if (tipoValido === 'TRANSFERENCIA') descripcion = banco ? 'Transferencia Banco ' + banco.replace(/^Banco\s+/i,'') : 'Transferencia';
      else if (tipoValido === 'PAGO') descripcion = 'Pago ' + (comercio || 'realizado');
      else if (tipoValido === 'GIRO') descripcion = banco ? 'Giro Banco ' + banco.replace(/^Banco\s+/i,'') : 'Giro';
      else descripcion = 'Compra ' + (comercio || 'realizada');
    }

    let categoria = String(e.parameter.categoria || '').trim();
    if (!categoria) {
      if (tipoValido === 'TRANSFERENCIA') categoria = 'Transferencias';
      else if (tipoValido === 'GIRO') categoria = 'Efectivo';
      else categoria = clasificarConReglas_({comercio:comercio || descripcion, descripcion, banco});
    }

    const movimiento = addMovimiento_({
      descripcion,
      comercio: comercio || descripcion,
      monto,
      moneda:'CLP',
      categoria,
      banco,
      tipo:tipoValido,
      fuente:'ATAJO_IPHONE'
    });

    return json_({ ok:true, movimiento });
  }

  if (action === 'scotia_notification') {
    const texto = String(e.parameter.texto || '').trim();
    if (!texto) return json_({ ok:false, error:'Notificación vacía' });

    const parsed = parseScotiaNotification_(texto);
    if (!parsed.ok) return json_(parsed);

    if (existeMovimientoSimilar_(parsed.movimiento)) {
      return json_({ ok:true, duplicado:true, movimiento:parsed.movimiento });
    }

    const movimiento = addMovimiento_(parsed.movimiento);
    return json_({ ok:true, duplicado:false, movimiento });
  }

  if (action === 'salary_callback') {
    const props = PropertiesService.getScriptProperties();
    const expected = String(props.getProperty('SALARY_CALLBACK_TOKEN') || '');
    const token = String(e.parameter.token || '');
    if (!expected || token !== expected) return json_({ ok:false, error:'No autorizado' });

    const fileId = String(e.parameter.file_id || '');
    const messageId = String(e.parameter.message_id || '');
    const status = String(e.parameter.status || '').toLowerCase();

    if (fileId) limpiarArchivoSueldoTemporal_(fileId);
    if (messageId) props.deleteProperty('SALARY_PENDING_' + messageId);

    if (status !== 'ok') {
      return json_({ ok:false, error:String(e.parameter.error || 'No se pudo procesar la liquidación') });
    }

    const monto = Number(String(e.parameter.monto || '0').replace(/[^0-9]/g,''));
    if (!monto || monto <= 0) return json_({ ok:false, error:'Monto líquido inválido' });
    if (existeIngresoMensaje_(messageId)) return json_({ ok:true, duplicado:true });

    const fecha = e.parameter.fecha ? new Date(e.parameter.fecha) : new Date();
    const periodo = String(e.parameter.periodo || Utilities.formatDate(fecha,'America/Santiago','yyyy-MM'));

    const ingreso = addIngreso_({
      fecha,
      tipo:'SUELDO',
      descripcion:'Sueldo Carabineros',
      monto,
      moneda:'CLP',
      fuente:'REMUNERACIONES_GMAIL',
      mensajeId:messageId,
      periodo,
      estado:'CONFIRMADO'
    });

    return json_({ ok:true, ingreso });
  }

  return json_({ ok:false, error:'Acción no soportada' });
}

function ss_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }

function listMovimientos_(limit) {
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  const last=sh.getLastRow();
  if(last<2) return [];
  limit=Math.max(1,Math.min(Number(limit||300),1000));
  const start=Math.max(2,last-limit+1);
  const values=sh.getRange(start,1,last-start+1,16).getValues().reverse();
  return values.map(r=>({
    id:r[0],fecha:r[1],hora:r[2],descripcion:r[3],comercio:r[4],monto:r[5],moneda:r[6],
    categoria:r[7],subcategoria:r[8],banco:r[9],cuenta:r[10],tipo:r[11],cuotas:r[12],
    fuente:r[13],mensajeId:r[14],estado:r[15]
  }));
}

function listIngresos_(limit) {
  const sh=ss_().getSheetByName(SHEET_INGRESOS);
  if(!sh || sh.getLastRow()<2) return [];
  const last=sh.getLastRow();
  limit=Math.max(1,Math.min(Number(limit||100),500));
  const start=Math.max(2,last-limit+1);
  return sh.getRange(start,1,last-start+1,10).getValues().reverse().map(r=>({
    id:r[0],fecha:r[1],tipo:r[2],descripcion:r[3],monto:r[4],moneda:r[5],
    fuente:r[6],mensajeId:r[7],periodo:r[8],estado:r[9]
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
  return {id,fecha:fecha.toISOString(),descripcion:row[3],comercio:row[4],monto:row[5],categoria:row[7],subcategoria:row[8],banco:row[9],cuenta:row[10],tipo:row[11],fuente:row[13],estado:row[15]};
}

function addIngreso_(m) {
  const sh=ss_().getSheetByName(SHEET_INGRESOS);
  if(!sh) throw new Error('Falta hoja INGRESOS');
  const fecha=m.fecha ? new Date(m.fecha) : new Date();
  const id=m.id || Utilities.getUuid();
  const periodo=m.periodo || Utilities.formatDate(fecha,'America/Santiago','yyyy-MM');
  const row=[
    id,fecha,m.tipo||'SUELDO',m.descripcion||'Sueldo',Number(m.monto||0),m.moneda||'CLP',
    m.fuente||'MANUAL',m.mensajeId||'',periodo,m.estado||'CONFIRMADO'
  ];
  sh.appendRow(row);
  return {id,fecha:fecha.toISOString(),tipo:row[2],descripcion:row[3],monto:row[4],moneda:row[5],fuente:row[6],periodo:row[8],estado:row[9]};
}

function existeIngresoMensaje_(messageId) {
  if(!messageId) return false;
  const sh=ss_().getSheetByName(SHEET_INGRESOS);
  if(!sh || sh.getLastRow()<2) return false;
  return sh.getRange(2,8,sh.getLastRow()-1,1).createTextFinder(messageId).matchEntireCell(true).findNext() !== null;
}

function actualizarMovimiento_(id, patch) {
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  const last=sh.getLastRow();
  if(last<2) return null;
  const ids=sh.getRange(2,1,last-1,1).getValues().flat().map(String);
  const idx=ids.indexOf(String(id));
  if(idx<0) return null;
  const row=idx+2;

  if(patch.comercio) sh.getRange(row,5).setValue(patch.comercio);
  if(patch.categoria) sh.getRange(row,8).setValue(patch.categoria);
  sh.getRange(row,9).setValue(patch.subcategoria || '');

  const r=sh.getRange(row,1,1,16).getValues()[0];
  return {
    id:r[0],fecha:r[1],hora:r[2],descripcion:r[3],comercio:r[4],monto:r[5],moneda:r[6],
    categoria:r[7],subcategoria:r[8],banco:r[9],cuenta:r[10],tipo:r[11],cuotas:r[12],
    fuente:r[13],mensajeId:r[14],estado:r[15]
  };
}

function guardarRegla_(patron, campo, categoria, subcategoria, banco) {
  const sh=ss_().getSheetByName(SHEET_REGLAS);
  if(!sh) return;
  const p=String(patron||'').trim();
  if(!p) return;

  const generico = /^(?:merpago\*?comerci|mercado\s*pago|webpay|transbank|sumup)$/i.test(p.replace(/\s+/g,' ').trim());
  if(generico) return;

  const last=sh.getLastRow();
  if(last>=2){
    const vals=sh.getRange(2,1,last-1,7).getValues();
    const existe=vals.some(r =>
      String(r[0]||'').trim().toLowerCase()===p.toLowerCase() &&
      String(r[1]||'').trim().toLowerCase()===String(campo||'').toLowerCase()
    );
    if(existe) return;
  }
  sh.appendRow([p,campo||'Comercio',categoria||'Otros',subcategoria||'',banco||'',100,'Sí']);
}

function existeMensaje_(messageId) {
  if(!messageId) return false;
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  if(sh.getLastRow()<2) return false;
  return sh.getRange(2,15,sh.getLastRow()-1,1).createTextFinder(messageId).matchEntireCell(true).findNext() !== null;
}

function parseScotiaNotification_(texto) {
  const t = texto.replace(/\s+/g,' ').trim();
  const m = t.match(/Se\s+realiz[oó]\s+compra\s+con\s+tu\s+tarjeta\s+de\s+(d[eé]bito|cr[eé]dito)\s+x{2,}(\d{4})\s+por\s+\$\s*([0-9.]+)\s+en\s+(.+?)(?=\.\s*Si\s+desconoces|$)/i);
  if (!m) return { ok:false, error:'Formato de notificación Scotia no reconocido' };

  const tipoTarjeta = /cr[eé]dito/i.test(m[1]) ? 'Crédito' : 'Débito';
  const ultimos4 = m[2];
  const monto = Number(m[3].replace(/\./g,''));
  const comercio = m[4].trim().replace(/[\s.]+$/,'');

  if (!monto || monto <= 0 || !comercio) return { ok:false, error:'No se pudo extraer monto o comercio' };

  const descripcion = 'Compra ' + comercio;
  return {
    ok:true,
    movimiento:{
      descripcion,
      comercio,
      monto,
      moneda:'CLP',
      categoria:clasificarConReglas_({comercio,descripcion,banco:'Scotiabank'}),
      banco:'Scotiabank',
      cuenta:tipoTarjeta + ' ' + ultimos4,
      tipo:'COMPRA',
      fuente:'NOTIFICACION_IPHONE',
      estado:'CONFIRMADO'
    }
  };
}

function existeMovimientoSimilar_(m) {
  const sh=ss_().getSheetByName(SHEET_MOVIMIENTOS);
  const last=sh.getLastRow();
  if(last<2) return false;
  const start=Math.max(2,last-30);
  const values=sh.getRange(start,1,last-start+1,16).getValues();
  const now=Date.now();

  return values.some(r=>{
    const fecha=r[1] instanceof Date ? r[1].getTime() : new Date(r[1]).getTime();
    const comercio=String(r[4]||'').trim().toLowerCase();
    const monto=Number(r[5]||0);
    const banco=String(r[9]||'').trim().toLowerCase();
    const cuenta=String(r[10]||'').trim().toLowerCase();
    const fuente=String(r[13]||'').trim().toUpperCase();

    return fuente==='NOTIFICACION_IPHONE' &&
      banco==='scotiabank' &&
      monto===Number(m.monto) &&
      comercio===String(m.comercio||'').trim().toLowerCase() &&
      cuenta===String(m.cuenta||'').trim().toLowerCase() &&
      !isNaN(fecha) && Math.abs(now-fecha) < 10*60*1000;
  });
}

function limpiarArchivoSueldoTemporal_(fileId) {
  const props = PropertiesService.getScriptProperties();
  try {
    const file = DriveApp.getFileById(fileId);
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (_err) {}
    file.setTrashed(true);
  } catch (_err) {}
  props.deleteProperty('SALARY_TEMP_' + fileId);
}

function limpiarArchivosSueldoTemporales_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();

  Object.keys(all).forEach(key => {
    if (!key.startsWith('SALARY_TEMP_')) return;
    const timestamp = Number(all[key] || 0);
    if (!timestamp || now - timestamp < 6 * 60 * 60 * 1000) return;
    const fileId = key.substring('SALARY_TEMP_'.length);
    limpiarArchivoSueldoTemporal_(fileId);
  });

  Object.keys(all).forEach(key => {
    if (!key.startsWith('SALARY_PENDING_')) return;
    let data = {};
    try { data = JSON.parse(all[key] || '{}'); } catch (_err) {}
    if (!data.timestamp || now - Number(data.timestamp) >= 6 * 60 * 60 * 1000) {
      props.deleteProperty(key);
    }
  });
}

function instalar() {
  syncGmail_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncGmail_')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncGmail_').timeBased().everyHours(1).create();
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

function probarSincronizacionSueldo() {
  const resultado = probarSueldoRapido_();
  console.log(JSON.stringify(resultado));
  return resultado;
}

function autorizarDrive() {
  // Verifica permiso de escritura real: leer 'Mi unidad' no comprueba createFile.
  const nombre = 'mis-gastos-prueba-permiso-' + Utilities.getUuid() + '.txt';
  const archivo = DriveApp.createFile(nombre, 'Prueba temporal de autorización de Mis Gastos');
  try {
    console.log('Permiso de escritura en Drive confirmado');
    return 'PERMISO_DRIVE_ESCRITURA_OK';
  } finally {
    archivo.setTrashed(true);
  }
}
