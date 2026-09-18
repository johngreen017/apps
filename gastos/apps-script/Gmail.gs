function syncGmail_() {
  const query = 'newer_than:30d';
  const threads = GmailApp.search(query,0,100);
  let procesados=0, agregados=0, descartados=0;

  threads.forEach(thread=>{
    thread.getMessages().forEach(msg=>{
      procesados++;
      const id=msg.getId();
      if(existeMensaje_(id)) return;
      const parsed=parseBankMail_(msg);
      if(!parsed){ descartados++; return; }
      parsed.mensajeId=id;
      parsed.fuente='GMAIL';
      addMovimiento_(parsed);
      agregados++;
    });
  });
  return {ok:true,procesados,agregados,descartados};
}

function parseBankMail_(msg) {
  const subject=(msg.getSubject()||'').trim();
  const from=(msg.getFrom()||'').toLowerCase();
  const body=stripHtml_(msg.getBody()||'');
  const text=(subject+'\n'+body).replace(/\s+/g,' ').trim();
  const s=subject.toLowerCase();
  const t=text.toLowerCase();

  // Modo estricto: SOLO se aceptan correos cuyo asunto parece una transacción real.
  // Se prioriza precisión sobre cobertura para evitar que ofertas entren como gastos.
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

  // Bloqueos explícitos para publicidad, cobranza y resúmenes.
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

  // La transacción debe tener un monto explícito.
  const moneyMatches=[...text.matchAll(/(?:CLP\s*|\$\s*)([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{4,})/gi)];
  if(!moneyMatches.length) return null;

  // El cuerpo además debe contener evidencia transaccional, no solo un precio.
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

  // Elegir el monto más cercano a texto transaccional; si no, usar el primero.
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

  const comercio=extraerComercio_(text);
  const tipo=/transferencia|env[ií]o\s+o\s+recepci[oó]n\s+de\s+dinero/i.test(subject) ? 'TRANSFERENCIA' :
             (/giro|retiro/i.test(subject) ? 'GIRO' :
             (/pago|recibo de apple/i.test(subject) ? 'PAGO' : 'COMPRA'));
  let categoria=clasificar_(comercio||subject);
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

function clasificar_(text) {
  const t=(text||'').toLowerCase();
  const reglas=[
    ['Combustible',['copec','shell','petrobras','aramco']],
    ['Supermercado',['lider','jumbo','tottus','unimarc','santa isabel']],
    ['Transporte',['uber','cabify','didi','metro']],
    ['Alimentación',['restaurant','restaurante','mcdonald','burger','starbucks','pedidosya','rappi']],
    ['Salud',['farmacia','cruz verde','salcobrand','ahumada','clinica','clínica']],
    ['Ropa',['zara','h&m','falabella','ripley','paris']],
    ['Suscripciones',['netflix','spotify','disney','youtube','icloud','apple.com/bill']]
  ];
  for(const [cat,keys] of reglas) if(keys.some(k=>t.includes(k))) return cat;
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