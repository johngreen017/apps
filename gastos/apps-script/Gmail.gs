function syncGmail_() {
  const query = 'newer_than:45d';
  const threads = GmailApp.search(query,0,150);
  let procesados=0, agregados=0, descartados=0;
  let sueldosAgregados=0, sueldosPendientes=0;

  threads.forEach(thread=>{
    thread.getMessages().forEach(msg=>{
      procesados++;
      const id=msg.getId();

      if(esCorreoRemuneraciones_(msg)){
        if(existeIngresoMensaje_(id)) return;
        const sueldo=procesarCorreoSueldo_(msg);
        if(sueldo.ok && sueldo.ingreso){
          addIngreso_(sueldo.ingreso);
          sueldosAgregados++;
        } else if(sueldo.pendiente){
          sueldosPendientes++;
        }
        return;
      }

      if(existeMensaje_(id)) return;
      const parsed=parseBankMail_(msg);
      if(!parsed){ descartados++; return; }
      parsed.mensajeId=id;
      parsed.fuente='GMAIL';
      addMovimiento_(parsed);
      agregados++;
    });
  });

  return {
    ok:true,
    procesados,
    agregados,
    descartados,
    sueldosAgregados,
    sueldosPendientes
  };
}

function esCorreoRemuneraciones_(msg){
  const subject=String(msg.getSubject()||'');
  const from=String(msg.getFrom()||'');
  const body=stripHtml_(msg.getBody()||'');
  const text=(subject+' '+from+' '+body).toLowerCase();

  return (
    /remuneraciones/i.test(from) &&
    /liquidaci[oó]n\s+de\s+sueldo|departamento\s+remuneraciones\s+p\.?9|carabineros\s+de\s+chile/i.test(text)
  ) || (
    /liquidaci[oó]n\s+de\s+sueldo/i.test(subject) &&
    /departamento\s+remuneraciones|carabineros\s+de\s+chile/i.test(text)
  );
}

function procesarCorreoSueldo_(msg){
  limpiarArchivosSueldoTemporales_();

  const props=PropertiesService.getScriptProperties();
  const messageId=msg.getId();
  const pendingKey='SALARY_PENDING_' + messageId;
  const pendingRaw=props.getProperty(pendingKey);

  if(pendingRaw){
    try{
      const pending=JSON.parse(pendingRaw);
      if(pending.timestamp && Date.now()-Number(pending.timestamp) < 6*60*60*1000){
        return {ok:false,pendiente:true,error:'Liquidación enviada a procesamiento'};
      }
    }catch(_err){}
    props.deleteProperty(pendingKey);
  }

  const attachments=msg.getAttachments({includeInlineImages:false,includeAttachments:true})
    .filter(a=>/pdf/i.test(String(a.getContentType()||'')) || /\.pdf$/i.test(String(a.getName()||'')));

  if(!attachments.length){
    return {ok:false,pendiente:true,error:'Correo de remuneraciones sin PDF adjunto'};
  }

  return enviarLiquidacionGithub_(attachments[0], msg);
}

function enviarLiquidacionGithub_(blob,msg){
  const props=PropertiesService.getScriptProperties();
  const githubToken=String(props.getProperty('GITHUB_SALARY_TOKEN')||'');
  const callbackToken=String(props.getProperty('SALARY_CALLBACK_TOKEN')||'');

  if(!githubToken || !callbackToken){
    return {ok:false,pendiente:true,error:'Integración GitHub de liquidaciones no configurada'};
  }

  let file=null;
  try{
    const fecha=msg.getDate();
    const periodo=Utilities.formatDate(fecha,'America/Santiago','yyyy-MM');
    const safeName='mis-gastos-liquidacion-' + Utilities.getUuid() + '.pdf';

    file=DriveApp.createFile(blob.copyBlob()).setName(safeName);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId=file.getId();
    props.setProperty('SALARY_TEMP_' + fileId, String(Date.now()));
    props.setProperty('SALARY_PENDING_' + msg.getId(), JSON.stringify({
      timestamp:Date.now(),
      fileId:fileId
    }));

    const payload={
      event_type:'salary_pdf',
      client_payload:{
        file_id:fileId,
        message_id:msg.getId(),
        fecha_iso:fecha.toISOString(),
        periodo:periodo
      }
    };

    const response=UrlFetchApp.fetch(
      'https://api.github.com/repos/johngreen017/johngreen017.github.io/dispatches',
      {
        method:'post',
        contentType:'application/json',
        headers:{
          Authorization:'Bearer ' + githubToken,
          Accept:'application/vnd.github+json',
          'X-GitHub-Api-Version':'2022-11-28'
        },
        payload:JSON.stringify(payload),
        muteHttpExceptions:true
      }
    );

    const code=response.getResponseCode();
    if(code!==204){
      props.deleteProperty('SALARY_PENDING_' + msg.getId());
      limpiarArchivoSueldoTemporal_(fileId);
      return {ok:false,pendiente:true,error:'GitHub no aceptó el procesamiento (HTTP '+code+')'};
    }

    return {ok:false,pendiente:true,dispatched:true,error:'Liquidación enviada a procesamiento'};
  }catch(err){
    if(file){
      try{ limpiarArchivoSueldoTemporal_(file.getId()); }catch(_err){}
    }
    props.deleteProperty('SALARY_PENDING_' + msg.getId());
    return {ok:false,pendiente:true,error:'No se pudo enviar la liquidación a GitHub Actions: ' + String(err && err.message ? err.message : err)};
  }
}

function parseBankMail_(msg) {
  const subject=(msg.getSubject()||'').trim();
  const from=(msg.getFrom()||'').toLowerCase();
  const body=stripHtml_(msg.getBody()||'');
  const text=(subject+'\n'+body).replace(/\s+/g,' ').trim();
  const t=text.toLowerCase();

  const subjectTransactionPatterns=[
    /comprobante\s+de\s+compra/i,
    /comprobante\s+de\s+pago/i,
    /aviso\s+de\s+compra/i,
    /notificaci[oó]n\s+de\s+compra/i,
    /compra\s+(?:realizada|aprobada|autorizada|efectuada)/i,
    /cargo\s+(?:realizado|aprobado|autorizado|efectuado)/i,
    /pago\s+(?:realizado|aprobado|autorizado|efectuado)/i,
    /aviso\s+de\s+transferencia/i,
    /aviso\s+de\s+env[ií]o\s+o\s+recepci[oó]n\s+de\s+dinero/i,
    /transferencia\s+(?:realizada|enviada|recibida|efectuada)/i,
    /notificaci[oó]n\s+de\s+giro/i,
    /giro\s+(?:realizado|efectuado)/i,
    /retiro\s+(?:realizado|efectuado)/i,
    /tu\s+recibo\s+de\s+apple/i,
    /recibo\s+de\s+pago/i
  ];

  if(!subjectTransactionPatterns.some(p=>p.test(subject))) return null;

  const rejectSubjectPatterns=[
    /oferta|promoci[oó]n|descuento|beneficio|dcto\.?|\boff\b|cashback/i,
    /cuotas?\s+sin\s+inter[eé]s/i,
    /estrena|nuevo\s+nissan|jeep|iphone\s+\d+/i,
    /seguro.*sin\s+costo/i,
    /cartola|estado\s+de\s+cuenta|resumen\s+mensual/i,
    /ponte\s+al\s+d[ií]a|opciones\s+para\s+ponerte\s+al\s+d[ií]a|ya\s+venci[oó]/i,
    /selecci[oó]n|recomendad[oa]|para\s+ti/i
  ];
  if(rejectSubjectPatterns.some(p=>p.test(subject))) return null;

  const promoBodyWords=[
    'hasta 40%','hasta un 40%','% dcto','% dto','% off','beneficios exclusivos',
    'bases legales','vigencia de la promoción','aprovecha','cupón','código promocional',
    'sorteo','premio','solo por hoy','financiamiento desde','simula tu crédito'
  ];
  if(promoBodyWords.some(w=>t.includes(w))) return null;

  const moneyMatches=[...text.matchAll(/(?:CLP\s*|\$\s*)([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{4,})/gi)];
  if(!moneyMatches.length) return null;

  const bodyTransactionPatterns=[
    /se\s+(?:ha\s+)?realiz(?:ó|o)/i,
    /realizaste/i,
    /hemos\s+registrado/i,
    /monto\s+(?:de|por)/i,
    /por\s+un\s+monto/i,
    /tarjeta\s+(?:terminada\s+en|\*{2,})/i,
    /cuenta\s+(?:terminada\s+en|\*{2,})/i,
    /fecha\s+de\s+(?:la\s+)?transacci[oó]n/i,
    /n[uú]mero\s+de\s+operaci[oó]n/i,
    /c[oó]digo\s+de\s+autorizaci[oó]n/i,
    /comercio\s*:/i,
    /destinatari[oa]\s*:/i,
    /transferencia\s+electr[oó]nica/i
  ];

  const specialReceipt=/comprobante\s+de\s+compra|tu\s+recibo\s+de\s+apple/i.test(subject);
  if(!specialReceipt && !bodyTransactionPatterns.some(p=>p.test(text))) return null;

  const banco=detectarBanco_(from+' '+text);
  const allowedNonBankReceipt = /comprobante\s+de\s+compra|tu\s+recibo\s+de\s+apple/i.test(subject);
  if(!banco && !allowedNonBankReceipt) return null;

  let monto=Number(moneyMatches[0][1].replace(/\./g,''));
  for(const m of moneyMatches){
    const start=Math.max(0,m.index-140);
    const end=Math.min(text.length,m.index+m[0].length+140);
    const context=text.slice(start,end);
    if(bodyTransactionPatterns.some(p=>p.test(context))){
      monto=Number(m[1].replace(/\./g,''));
      break;
    }
  }
  if(!monto || monto<=0) return null;

  const comercio=limpiarComercio_(extraerComercio_(text));
  const tipo=/transferencia|env[ií]o\s+o\s+recepci[oó]n\s+de\s+dinero/i.test(subject) ? 'TRANSFERENCIA' :
             (/giro|retiro/i.test(subject) ? 'GIRO' :
             (/pago|recibo de apple/i.test(subject) ? 'PAGO' : 'COMPRA'));

  let categoria=clasificarConReglas_({comercio:comercio||subject,descripcion:subject,banco});
  if(tipo==='TRANSFERENCIA') categoria='Transferencias';
  if(tipo==='GIRO') categoria='Efectivo';
  if(/recibo de apple/i.test(subject)) categoria='Suscripciones';

  return {
    fecha:msg.getDate(),
    descripcion:subject,
    comercio:comercio||subject,
    monto,
    moneda:'CLP',
    categoria,
    banco,
    tipo
  };
}

function detectarBanco_(text) {
  const t=text.toLowerCase();
  const reglas=[
    ['Santander',['santander','santander.cl']],
    ['Banco de Chile',['banco de chile','bancochile','bancochile.cl']],
    ['BCI',[' bci ','bci.cl','@bci']],
    ['BancoEstado',['bancoestado','bancoestado.cl']],
    ['CMR Falabella',['cmr','bancofalabella','bancofalabella.cl']],
    ['Scotiabank',['scotiabank','scotiabankchile']],
    ['Itaú',['itau','itaú','itau.cl']],
    ['Mercado Pago',['mercado pago','mercadopago']],
    ['Tenpo',['tenpo','tenpo.cl']]
  ];
  const hit=reglas.find(r=>r[1].some(k=>t.includes(k)));
  return hit ? hit[0] : '';
}

function extraerComercio_(text) {
  const patrones=[
    /(?:comercio|establecimiento)\s*[:\-]?\s*([A-Z0-9ÁÉÍÓÚÑ* ._&/-]{3,50})/i,
    /(?:compra|cargo)\s+(?:realizada\s+)?(?:en\s+)?([A-Z0-9ÁÉÍÓÚÑ* ._&/-]{3,50})/i,
    /(?:en|a favor de)\s+([A-Z0-9ÁÉÍÓÚÑ* ._&/-]{3,50})\s+(?:por|monto|con)/i
  ];
  for(const p of patrones){
    const m=text.match(p);
    if(m) return m[1].replace(/\s+(por|monto|con).*$/i,'').trim();
  }
  return '';
}

function limpiarComercio_(value) {
  return String(value||'')
    .replace(/\s+/g,' ')
    .replace(/^[\s:;,-]+|[\s:;,-]+$/g,'')
    .trim();
}

function clasificarConReglas_(datos) {
  datos=datos||{};
  const comercio=String(datos.comercio||'');
  const descripcion=String(datos.descripcion||'');
  const banco=String(datos.banco||'');

  try{
    const sh=ss_().getSheetByName(SHEET_REGLAS);
    if(sh && sh.getLastRow()>=2){
      const rows=sh.getRange(2,1,sh.getLastRow()-1,7).getValues()
        .filter(r=>String(r[6]||'').trim().toLowerCase()!=='no' && String(r[0]||'').trim())
        .sort((a,b)=>Number(b[5]||0)-Number(a[5]||0));

      for(const r of rows){
        const patron=normalizarTexto_(r[0]);
        const campo=String(r[1]||'').trim().toLowerCase();
        const categoria=String(r[2]||'').trim();
        const bancoRegla=normalizarTexto_(r[4]);
        if(!categoria || !patron) continue;
        if(bancoRegla && !normalizarTexto_(banco).includes(bancoRegla)) continue;

        let objetivo=comercio+' '+descripcion;
        if(campo.includes('comercio')) objetivo=comercio;
        else if(campo.includes('descripcion') || campo.includes('descripción')) objetivo=descripcion;
        else if(campo.includes('banco')) objetivo=banco;

        if(normalizarTexto_(objetivo).includes(patron)) return categoria;
      }
    }
  } catch(err) {
    console.log('No se pudieron leer reglas: '+err);
  }

  return clasificar_(comercio+' '+descripcion);
}

function normalizarTexto_(text) {
  return String(text||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9*]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function clasificar_(text) {
  const t=normalizarTexto_(text);
  const reglas=[
    ['Combustible',['copec','shell','aramco','petrobras','terpel']],
    ['Supermercado',['lider','jumbo','tottus','unimarc','santa isabel','acuenta','alvi','mayorista 10']],
    ['Transporte',['uber','cabify','didi','metro','red movilidad','turbus','pullman']],
    ['Alimentación',['restaurant','restaurante','mcdonald','burger king','starbucks','pedidosya','rappi','kfc','subway','dominos','papa johns','juan valdez']],
    ['Salud',['farmacia','cruz verde','salcobrand','ahumada','clinica','integramedica','redsalud','vidaintegra']],
    ['Ropa',['zara','h&m','hm ','falabella','ripley','paris','nike','adidas']],
    ['Suscripciones',['netflix','spotify','disney','youtube','icloud','apple.com/bill','google one','microsoft']],
    ['Hogar',['sodimac','easy','ikea','casaideas']],
    ['Servicios',['enel','aguas andinas','metrogas','entel','movistar','wom','claro','vtr','gtd']],
    ['Educación',['colegio','universidad','instituto','matricula','matrícula']],
    ['Otros',['mercado pago','merpago']]
  ];
  for(const [cat,keys] of reglas) if(keys.some(k=>t.includes(normalizarTexto_(k)))) return cat;
  return 'Otros';
}

function stripHtml_(html){
  return html
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#36;/g,'$');
}

function probarSueldoRapido_() {
  const threads = GmailApp.search('from:remuneraciones@info.carabineros.cl newer_than:90d', 0, 10);
  let revisados = 0;

  for (const thread of threads) {
    const messages = thread.getMessages().slice().reverse();

    for (const msg of messages) {
      revisados++;
      if (!esCorreoRemuneraciones_(msg)) continue;

      const id = msg.getId();
      if (existeIngresoMensaje_(id)) {
        return {ok:true,revisados,estado:'YA_REGISTRADO',messageId:id};
      }

      const resultado = procesarCorreoSueldo_(msg);
      return {
        ok:!!resultado.ok,
        revisados,
        estado:resultado.dispatched ? 'ENVIADO_A_GITHUB' : (resultado.pendiente ? 'PENDIENTE' : 'PROCESADO'),
        error:resultado.error || '',
        messageId:id
      };
    }
  }

  return {ok:false,revisados,estado:'NO_ENCONTRADO',error:'No se encontró correo de Remuneraciones'};
}
