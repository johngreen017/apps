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

// La clave solo se conserva en esta sesión, nunca en el repositorio.
let accessKey = sessionStorage.getItem("mg_access_key") || "";
function pedirClavePrivada(){
  const value = window.prompt("Clave privada de Mis Gastos (se guarda solo durante esta sesión):");
  if(!value) return false;
  accessKey=value.trim();
  sessionStorage.setItem("mg_access_key",accessKey);
  return true;
}
async function api(params={}, options={}){
  if(!apiReady()) throw new Error("Apps Script no configurado");
  const post = async ()=>{
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
    sessionStorage.removeItem("mg_access_key");
    if(!pedirClavePrivada()) throw new Error("Necesitas tu clave privada para consultar Mis Gastos.");
    data=await post();
  }
  if(data && data.ok===false) throw new Error(data.error || "Error");
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

populateCategorySelects();
$("category").value="Otros";
apiReady();
refresh().catch(err=>{
  console.error(err);
  $("lastUpdate").textContent="No se pudieron cargar los movimientos";
});