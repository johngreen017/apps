function syncGmail_() {
  const query = 'newer_than:30d';
  const threads = GmailApp.search(query,0,100);
  let procesados=0, agregados=0;

  threads.forEach(thread=>{
    thread.getMessages().forEach(msg=>{
      procesados++;
      const id=msg.getId();
      if(existeMensaje_(id)) return;
      const parsed=parseBankMail_(msg);
      if(!parsed) return;
      parsed.mensajeId=id;
      parsed.fuente='GMAIL';
      addMovimiento_(parsed);
      agregados++;
    });
  });
  return {ok:true,procesados,agregados};
}

function parseBankMail_(msg) {
  const subject=msg.getSubject()||'';
  const body=stripHtml_(msg.getBody()||'');
  const text=(subject+'\n'+body).replace(/\s+/g,' ');
  const lower=text.toLowerCase();

  const moneyMatch = text.match(/(?:\$|CLP\s*)\s*([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{4,})/i);
  if(!moneyMatch) return null;

  const señales=['compra','cargo','pago','transacci','transferencia','giro','débito','debito','tarjeta'];
  if(!señales.some(s=>lower.includes(s))) return null;

  const monto=Number(moneyMatch[1].replace(/\./g,''));
  const banco=detectarBanco_(msg.getFrom()+' '+text);
  const comercio=extraerComercio_(text);
  return {
    fecha:msg.getDate(),
    descripcion:subject,
    comercio:comercio||subject,
    monto,
    moneda:'CLP',
    categoria:clasificar_(comercio||subject),
    banco,
    tipo: lower.includes('transferencia') ? 'TRANSFERENCIA' : 'GASTO'
  };
}

function detectarBanco_(text) {
  const t=text.toLowerCase();
  const reglas=[
    ['Santander','santander'],['Banco de Chile','banco de chile'],['BCI','bci'],
    ['BancoEstado','bancoestado'],['CMR Falabella','falabella'],['Scotiabank','scotiabank'],
    ['Itaú','itau'],['Mercado Pago','mercado pago'],['Tenpo','tenpo']
  ];
  const hit=reglas.find(r=>t.includes(r[1]));
  return hit ? hit[0] : '';
}

function extraerComercio_(text) {
  const patrones=[
    /(?:comercio|establecimiento|en)\s*[:\-]?\s*([A-Z0-9* ._-]{3,40})/i,
    /(?:compra|cargo)\s+(?:en\s+)?([A-Z0-9* ._-]{3,40})/i
  ];
  for(const p of patrones){const m=text.match(p);if(m)return m[1].trim();}
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

function stripHtml_(html){return html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ');}