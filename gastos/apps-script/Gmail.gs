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
  const lower=text.toLowerCase();

  // 1) Excluir publicidad, ofertas, campañas y newsletters.
  const promoWords=[
    'oferta','ofertas','promoción','promocion','descuento','descuentos','beneficio',
    'beneficios','imperdible','aprovecha','hasta un','% dcto','% dto','cashback',
    'cupón','cupon','cyber','black friday','newsletter','novedades','campaña',
    'campana','sorteo','premio','participa','exclusivo para ti','solo por hoy',
    'vigencia','bases legales','suscríbete','suscribete'
  ];
  const hasPromo = promoWords.some(w=>lower.includes(w));

  // 2) Exigir lenguaje que describa un movimiento YA REALIZADO.
  const transactionPatterns=[
    /se\s+(?:ha\s+)?realiz(?:ó|o)\s+(?:una\s+)?compra/i,
    /realizaste\s+(?:una\s+)?compra/i,
    /hemos\s+registrado\s+(?:una\s+)?compra/i,
    /compra\s+(?:realizada|efectuada|aprobada|autorizada)/i,
    /cargo\s+(?:realizado|efectuado|aprobado|autorizado)/i,
    /pago\s+(?:realizado|efectuado|aprobado|autorizado)/i,
    /transacci[oó]n\s+(?:realizada|efectuada|aprobada|autorizada)/i,
    /transferencia\s+(?:realizada|efectuada|enviada|recibida)/i,
    /retiro\s+(?:realizado|efectuado)/i,
    /giro\s+(?:realizado|efectuado)/i,
    /(?:tu|su)\s+tarjeta\s+terminada\s+en\s+\d{4}/i,
    /(?:tarjeta|cuenta)\s+\*{2,}\d{2,4}/i
  ];
  const hasStrongTransactionSignal = transactionPatterns.some(p=>p.test(text));

  // 3) Debe existir un monto claramente monetario.
  const moneyMatches=[...text.matchAll(/(?:CLP\s*|\$\s*)([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{4,})/gi)];
  if(!moneyMatches.length) return null;

  // En publicidad pueden aparecer muchos precios. En una transacción normalmente hay
  // señales fuertes de compra/cargo y un emisor financiero identificable.
  const banco=detectarBanco_(from+' '+text);
  if(!banco) return null;
  if(!hasStrongTransactionSignal) return null;
  if(hasPromo && !/compra\s+(?:realizada|efectuada|aprobada|autorizada)|cargo\s+(?:realizado|efectuado|aprobado|autorizado)|transferencia\s+(?:realizada|efectuada|enviada|recibida)/i.test(text)) return null;

  // Preferir el primer monto cercano a lenguaje transaccional.
  let monto=Number(moneyMatches[0][1].replace(/\./g,''));
  for(const m of moneyMatches){
    const start=Math.max(0,m.index-120);
    const end=Math.min(text.length,m.index+m[0].length+120);
    const context=text.slice(start,end);
    if(transactionPatterns.some(p=>p.test(context))){
      monto=Number(m[1].replace(/\./g,''));
      break;
    }
  }
  if(!monto || monto<=0) return null;

  const comercio=extraerComercio_(text);
  return {
    fecha:msg.getDate(),
    descripcion:subject,
    comercio:comercio||subject,
    monto,
    moneda:'CLP',
    categoria:clasificar_(comercio||subject),
    banco,
    tipo: /transferencia/i.test(text) ? 'TRANSFERENCIA' : (/giro|retiro/i.test(text) ? 'GIRO' : 'GASTO')
  };
}

function detectarBanco_(text) {
  const t=text.toLowerCase();
  const reglas=[
    ['Santander',['santander','santander.cl']],
    ['Banco de Chile',['banco de chile','bancochile','bancochile.cl']],
    ['BCI',['bci','bci.cl']],
    ['BancoEstado',['bancoestado','bancoestado.cl']],
    ['CMR Falabella',['cmr','bancofalabella','falabella.com']],
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
    if(m){
      return m[1].replace(/\s+(por|monto|con).*$/i,'').trim();
    }
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