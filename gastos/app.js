const GAS_URL = "https://script.google.com/macros/s/AKfycbx1FyxYYdoiC43fOPc1zBuuM0YYHU-bJx4_XmnWDZKi9aRMa0xK0RAkqb7o8ckAHb2L7g/exec";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const categories = [
  "Alimentación","Supermercado","Transporte","Combustible","Hogar","Salud",
  "Educación","Ropa","Suscripciones","Servicios","Transferencias","Efectivo","Otros"
];

let allRows = [];
let allIncomes = [];

function apiReady(){
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GAS_URL);
  $("setup").classList.toggle("hidden", ok);
  return ok;
}

// El acceso se recuerda solamente en los navegadores donde el propietario lo autorice.
// Nunca se publica la clave en GitHub ni se agrega a la URL.
const ACCESS_KEY_NAME="mg_access_key";
const TRUSTED_KEY_NAME="mg_trusted_device_key";
const REMEMBER_ASKED="mg_remember_asked";
function leerGuardado(store,key){
  try{return store.getItem(key)||"";}catch(_){return "";}
}
function borrarGuardado(store,key){
  try{store.removeItem(key);}catch(_){}
}
function escribirGuardado(store,key,value){
  try{store.setItem(key,value);return true;}catch(_){return false;}
}
let accessKey=leerGuardado(localStorage,TRUSTED_KEY_NAME) || leerGuardado(sessionStorage,ACCESS_KEY_NAME);
let awaitingRemember=false;
function pedirClavePrivada(){
  const value=window.prompt("Ingresa la clave privada de Mis Gastos:");
  if(!value || !value.trim()) return false;
  accessKey=value.trim();
  escribirGuardado(sessionStorage,ACCESS_KEY_NAME,accessKey);
  awaitingRemember=true;
  return true;
}
function ofrecerRecordarDispositivo(){
  if(!accessKey || leerGuardado(localStorage,TRUSTED_KEY_NAME)) return;
  // La confirmación solo se ofrece después de que Apps Script haya validado la clave.
  if(!awaitingRemember && leerGuardado(sessionStorage,REMEMBER_ASKED)) return;
  awaitingRemember=false;
  escribirGuardado(sessionStorage,REMEMBER_ASKED,"1");
  if(window.confirm("¿Recordar el acceso en este iPhone o iPad?\\n\\nSi aceptas, no te pediremos la clave al abrir Mis Gastos en este navegador. Elige Cancelar si compartes el dispositivo.")){
    if(!escribirGuardado(localStorage,TRUSTED_KEY_NAME,accessKey)){
      window.alert("Safari no permitió recordar la clave. Se pedirá al iniciar una sesión nueva.");
    }
  }
}
async function api(params={}, options={}){
  if(!apiReady()) throw new Error("Apps Script no configurado");
  const post=async ()=>{
    const body=new URLSearchParams(options.body || "");
    Object.entries(params).forEach(([k,v])=>body.set(k,v));
    if(accessKey) body.set("access_key",accessKey);
    const response=await fetch(GAS_URL,{...options,method:"POST",body});
    if(!response.ok) throw new Error("Error de conexión");
    return response.json();
  };
  let data=await post();
  if(data && data.ok===false && /acceso no autorizado/i.test(data.error||"")){
    accessKey="";
    awaitingRemember=false;
    borrarGuardado(localStorage,TRUSTED_KEY_NAME);
    borrarGuardado(sessionStorage,ACCESS_KEY_NAME);
    if(!pedirClavePrivada()) throw new Error("Necesitas tu clave privada para consultar Mis Gastos.");
    data=await post();
  }
  if(data && data.ok===false){
    if(/acceso no autorizado/i.test(data.error||"")){
      accessKey="";
      awaitingRemember=false;
      borrarGuardado(localStorage,TRUSTED_KEY_NAME);
      borrarGuardado(sessionStorage,ACCESS_KEY_NAME);
    }
    throw new Error(data.error || "Error");
  }
  if(accessKey && !leerGuardado(localStorage,TRUSTED_KEY_NAME)) ofrecerRecordarDispositivo();
  return data;
}

function populateCategorySelects(){
  const options = categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  $("category").innerHTML = options;
  $("editCategory").innerHTML = options;
  $("categoryFilter").innerHTML = '<option value="">Todas las categorías</option>'+options;
}

function movementName(r){
  const desc=String(r.descripcion||"").trim();
  const commerce=String(r.comercio||"").trim();
  let type=String(r.tipo||"").toUpperCase();

  if(type==="GASTO"){
    if(/\bpago\b|recibo de apple|comprobante de pago/i.test(desc)) type="PAGO";
    else if(/\bcompra\b|comprobante de compra|aviso de compra/i.test(desc)) type="COMPRA";
  }

  const cleanCommerce = (() => {
    if(/recibo de apple/i.test(desc)) return "Apple";
    if(/comprobante de compra copec/i.test(desc)) return "Copec";
    const bad =
      !commerce ||
      commerce.length > 60 ||
      /^(cia|ta de|ir a|emos|tura|tos y|eficios)\b/i.test(commerce) ||
      /recuerda que|aviso imp|banca persona/i.test(commerce);
    return bad ? "" : commerce;
  })();

  if(type==="TRANSFERENCIA") return r.banco ? "Transferencia Banco "+String(r.banco).replace(/^Banco\s+/i,"") : "Transferencia";
  if(type==="PAGO") return "Pago "+(cleanCommerce || desc.replace(/^.*?pago\s*/i,"").trim() || "realizado");
  if(type==="COMPRA") return "Compra "+(cleanCommerce || desc.replace(/^.*?compra\s*/i,"").trim() || "realizada");
  if(type==="GIRO") return r.banco ? "Giro Banco "+String(r.banco).replace(/^Banco\s+/i,"") : "Giro";
  return cleanCommerce || desc || "Movimiento";
}

function movementCategory(r){
  const type=String(r.tipo||"").toUpperCase();
  if(type==="TRANSFERENCIA") return "Transferencias";
  if(type==="GIRO") return "Efectivo";
  if(/recibo de apple/i.test(String(r.descripcion||""))) return "Suscripciones";
  return r.categoria||"Otros";
}

function isExpense(r){
  const type=String(r.tipo||"GASTO").toUpperCase();
  return ["COMPRA","PAGO","GASTO"].includes(type);
}

function sameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function sameMonth(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth();
}

function validRows(){
  return allRows.filter(r=>String(r.estado||"").toUpperCase()!=="DESCARTADO");
}

function validIncomes(){
  return allIncomes.filter(r=>String(r.estado||"").toUpperCase()!=="DESCARTADO");
}

function filteredRows(){
  const q=$("searchInput").value.trim().toLowerCase();
  const category=$("categoryFilter").value;
  const bank=$("bankFilter").value;
  const type=$("typeFilter").value;

  return validRows().filter(r=>{
    const haystack=[r.descripcion,r.comercio,r.banco,r.cuenta,movementCategory(r),movementName(r)].join(" ").toLowerCase();
    return (!q || haystack.includes(q)) &&
      (!category || movementCategory(r)===category) &&
      (!bank || String(r.banco||"")===bank) &&
      (!type || String(r.tipo||"").toUpperCase()===type);
  });
}

function renderSummary(){
  const rows=validRows();
  const incomes=validIncomes();
  const now=new Date();

  const monthExpenses=rows.filter(r=>{
    const d=new Date(r.fecha);
    return !isNaN(d) && sameMonth(d,now) && isExpense(r);
  });

  const monthIncomes=incomes.filter(r=>{
    const d=new Date(r.fecha);
    return !isNaN(d) && sameMonth(d,now);
  });

  const todayExpenses=monthExpenses.filter(r=>sameDay(new Date(r.fecha),now));

  const monthTotal=monthExpenses.reduce((a,r)=>a+Number(r.monto||0),0);
  const incomeTotal=monthIncomes.reduce((a,r)=>a+Number(r.monto||0),0);
  const todayTotal=todayExpenses.reduce((a,r)=>a+Number(r.monto||0),0);
  const available=incomeTotal-monthTotal;
  const lastDay=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const daysRemaining=Math.max(1,lastDay-now.getDate()+1);
  const dailyAvailable=available/daysRemaining;

  $("monthIncome").textContent=money.format(incomeTotal);
  $("monthTotal").textContent=money.format(monthTotal);
  $("availableTotal").textContent=money.format(available);
  $("spentPercent").textContent=incomeTotal>0 ? Math.round((monthTotal/incomeTotal)*100)+"%" : "—";
  $("todayTotal").textContent=money.format(todayTotal);
  $("dailyAvailable").textContent=incomeTotal>0 ? money.format(dailyAvailable) : "—";
  $("salaryNotice").classList.toggle("hidden", incomeTotal>0);
}

function renderCategoryBars(){
  const now=new Date();
  const rows=validRows().filter(r=>{
    const d=new Date(r.fecha);
    return !isNaN(d) && sameMonth(d,now) && isExpense(r);
  });

  const totals={};
  rows.forEach(r=>{
    const cat=movementCategory(r);
    totals[cat]=(totals[cat]||0)+Number(r.monto||0);
  });

  const list=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const box=$("categoryBars");
  if(!list.length){
    box.innerHTML='<p class="empty">Aún no hay datos este mes.</p>';
    return;
  }

  const max=list[0][1]||1;
  box.innerHTML=list.slice(0,8).map(([cat,total])=>`
    <div class="category-row">
      <div class="category-name">${escapeHtml(cat)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,(total/max)*100)}%"></div></div>
      <div class="category-value">${money.format(total)}</div>
    </div>
  `).join("");
}

function renderBankFilter(){
  const current=$("bankFilter").value;
  const banks=[...new Set(validRows().map(r=>String(r.banco||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
  $("bankFilter").innerHTML='<option value="">Todos los bancos</option>'+banks.map(b=>`<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if(banks.includes(current)) $("bankFilter").value=current;
}

function renderMovements(){
  const rows=filteredRows().sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  $("visibleCount").textContent=rows.length;
  const box=$("movements");

  if(!rows.length){
    box.innerHTML='<p class="empty">No hay movimientos para estos filtros.</p>';
    return;
  }

  box.innerHTML=rows.slice(0,100).map(r=>`
    <div class="movement" data-id="${escapeHtml(r.id)}" role="button" tabindex="0">
      <div class="title">${escapeHtml(movementName(r))}</div>
      <div class="amount">${money.format(Number(r.monto||0))}</div>
      <div class="meta">
        ${escapeHtml(movementCategory(r))}
        ${r.banco ? " · "+escapeHtml(r.banco) : ""}
        ${r.cuenta ? " · "+escapeHtml(r.cuenta) : ""}
        · ${formatDate(r.fecha)}
        <div><span class="badge">${escapeHtml(String(r.tipo||"GASTO"))}</span></div>
      </div>
    </div>
  `).join("");

  box.querySelectorAll(".movement").forEach(el=>{
    const open=()=>openEditor(el.dataset.id);
    el.addEventListener("click",open);
    el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
  });
}

function render(){
  renderSummary();
  renderCategoryBars();
  renderBankFilter();
  renderMovements();
  $("lastUpdate").textContent="Actualizado "+new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"});
}

function openEditor(id){
  const r=allRows.find(x=>String(x.id)===String(id));
  if(!r) return;
  $("editId").value=r.id;
  $("editCommerce").value=String(r.comercio||"").trim() || movementName(r);
  $("editCategory").value=categories.includes(movementCategory(r)) ? movementCategory(r) : "Otros";
  $("editSubcategory").value=String(r.subcategoria||"");
  $("editLearn").checked=true;
  $("editorTitle").textContent=movementName(r);
  $("editStatus").textContent="";
  $("editorBackdrop").classList.remove("hidden");
  $("editor").classList.remove("hidden");
}

function closeEditor(){
  $("editorBackdrop").classList.add("hidden");
  $("editor").classList.add("hidden");
}

async function refresh(){
  if(!apiReady()) return;
  $("refreshBtn").disabled=true;
  try{
    const data=await api({action:"list",limit:"500",incomeLimit:"100"});
    allRows=data.movimientos||[];
    allIncomes=data.ingresos||[];
    render();
  }finally{
    $("refreshBtn").disabled=false;
  }
}

async function sync(){
  if(!apiReady()) return;
  $("syncBtn").disabled=true;
  $("syncBtn").textContent="Sincronizando…";
  try{
    const result=await api({action:"sync"});
    await refresh();
    if(result.sueldosPendientes>0 && result.sueldosAgregados===0){
      console.info("Hay liquidaciones pendientes de procesamiento.");
    }
  }catch(err){
    alert("No se pudo sincronizar: "+err.message);
  }finally{
    $("syncBtn").disabled=false;
    $("syncBtn").textContent="Sincronizar";
  }
}

function escapeHtml(s=""){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function formatDate(v){
  const d=new Date(v);
  if(isNaN(d)) return String(v||"");
  return d.toLocaleDateString("es-CL",{day:"2-digit",month:"2-digit",year:"2-digit"});
}

["searchInput","categoryFilter","bankFilter","typeFilter"].forEach(id=>{
  $(id).addEventListener(id==="searchInput" ? "input" : "change", renderMovements);
});

$("refreshBtn").addEventListener("click",()=>refresh().catch(err=>alert(err.message)));
$("syncBtn").addEventListener("click",sync);
$("closeEditor").addEventListener("click",closeEditor);
$("editorBackdrop").addEventListener("click",closeEditor);

$("editForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("saveEdit").disabled=true;
  $("editStatus").textContent="Guardando…";
  try{
    const body=new URLSearchParams({
      action:"update",
      id:$("editId").value,
      comercio:$("editCommerce").value.trim(),
      categoria:$("editCategory").value,
      subcategoria:$("editSubcategory").value.trim(),
      aprender:$("editLearn").checked ? "1" : "0"
    });
    await api({}, {method:"POST",body});
    $("editStatus").textContent=$("editLearn").checked
      ? "Guardado. La categoría se recordará para este comercio."
      : "Guardado.";
    await refresh();
    setTimeout(closeEditor,500);
  }catch(err){
    $("editStatus").textContent="Error: "+err.message;
  }finally{
    $("saveEdit").disabled=false;
  }
});

$("incomeForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const body=new URLSearchParams({
    action:"add_income",
    descripcion:$("incomeDescription").value.trim() || "Sueldo",
    monto:String(Number($("incomeAmount").value||0)),
    tipo:$("incomeType").value
  });
  try{
    await api({}, {method:"POST",body});
    e.target.reset();
    $("incomeDescription").value="Sueldo";
    $("incomeType").value="SUELDO";
    await refresh();
  }catch(err){
    alert("No se pudo guardar el ingreso: "+err.message);
  }
});

$("manualForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!apiReady()) return;
  const payload={
    descripcion:$("description").value.trim(),
    comercio:$("description").value.trim(),
    monto:Number($("amount").value),
    categoria:$("category").value,
    tipo:"GASTO",
    fuente:"MANUAL"
  };
  try{
    const body=new URLSearchParams({action:"add",payload:JSON.stringify(payload)});
    await api({}, {method:"POST",body});
    e.target.reset();
    $("category").value="Otros";
    await refresh();
  }catch(err){
    alert("No se pudo guardar: "+err.message);
  }
});

// El cambio de clave solo se solicita desde este formulario y no modifica los datos.
$("changeKeyForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const status=$("changeKeyStatus");
  const btn=$("changeKeyBtn");
  const actual=$("currentAccessKey").value;
  const nueva=$("newAccessKey").value;
  const confirmar=$("confirmAccessKey").value;
  status.textContent="";
  if(nueva!==confirmar){
    status.textContent="La confirmación no coincide con la nueva clave.";
    return;
  }
  if(nueva.length<8||nueva.length>128||nueva.trim()!==nueva){
    status.textContent="La nueva clave debe tener entre 8 y 128 caracteres, sin espacios al principio ni al final.";
    return;
  }
  if(actual===nueva){
    status.textContent="Elige una clave diferente a la actual.";
    return;
  }
  if(!window.confirm("¿Cambiar tu clave privada? Deberás ingresar la nueva clave en tus otros dispositivos.")) return;
  btn.disabled=true;
  status.textContent="Actualizando la clave…";
  const estabaRecordada=Boolean(leerGuardado(localStorage,TRUSTED_KEY_NAME));
  try{
    const body=new URLSearchParams({
      action:"change_access_key",
      access_key:actual,
      new_access_key:nueva
    });
    // Usar fetch directo: api() agrega la clave almacenada, que podría diferir
    // de la clave actual ingresada manualmente.
    const response=await fetch(GAS_URL,{method:"POST",body});
    if(!response.ok) throw new Error("No se pudo conectar al servicio.");
    const result=await response.json();
    if(result.ok!==true||result.changed!==true) throw new Error(result.error||"No se pudo cambiar la clave.");
    accessKey=nueva;
    escribirGuardado(sessionStorage,ACCESS_KEY_NAME,nueva);
    if(estabaRecordada) escribirGuardado(localStorage,TRUSTED_KEY_NAME,nueva);
    borrarGuardado(sessionStorage,REMEMBER_ASKED);
    $("changeKeyForm").reset();
    status.textContent="Clave cambiada. Actualiza la clave en tus otros dispositivos.";
  }catch(error){
    status.textContent=error.message||"No se pudo cambiar la clave.";
  }finally{
    btn.disabled=false;
  }
});

// Navegación visual: todos los accesos apuntan a funciones existentes.
function openNewExpense(){
  const formCard=$("registrarGasto");
  formCard.open=true;
  formCard.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});
  setTimeout(()=>{const field=$("description");if(field)field.focus({preventScroll:true});},350);
}
$("addExpenseBtn").addEventListener("click",openNewExpense);
$("navAddExpense").addEventListener("click",()=>{ $("registrarGasto").open=true; });
document.querySelectorAll(".bottom-nav .nav-item").forEach(link=>{
  link.addEventListener("click",()=>{
    document.querySelectorAll(".bottom-nav .nav-item").forEach(item=>item.classList.toggle("active",item===link));
  });
});

populateCategorySelects();
$("category").value="Otros";
apiReady();
refresh().catch(err=>{
  console.error(err);
  $("lastUpdate").textContent="No se pudieron cargar los movimientos";
});