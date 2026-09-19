const GAS_URL = "https://script.google.com/macros/s/AKfycbx1FyxYYdoiC43fOPc1zBuuM0YYHU-bJx4_XmnWDZKi9aRMa0xK0RAkqb7o8ckAHb2L7g/exec";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const categories = [
  "Alimentación","Supermercado","Transporte","Combustible","Hogar","Salud",
  "Educación","Ropa","Suscripciones","Servicios","Transferencias","Efectivo","Otros"
];

let allRows = [];
let allIncomes = [];
let allStatements = [];

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
  return allIncomes.filter(r=>String(r.estado||"").toUpperCase()==="CONFIRMADO");
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
  $("salaryNotice").classList.toggle("hidden", incomeTotal>0 || allIncomes.some(r=>String(r.estado||"").toUpperCase()==="PENDIENTE" && String(r.tipo||"").toUpperCase()==="SUELDO"));
  renderPendingSalaries();
}

function renderPendingSalaries(){
  const pending=allIncomes.filter(r=>String(r.estado||"").toUpperCase()==="PENDIENTE" &&
    String(r.tipo||"").toUpperCase()==="SUELDO" && String(r.fuente||"")==="REMUNERACIONES_GMAIL");
  const panel=$("pendingSalaryPanel");
  if(!panel)return;
  panel.classList.toggle("hidden",pending.length===0);
  panel.innerHTML=pending.map(r=>`
    <div class="salary-review" data-id="${escapeHtml(r.id)}">
      <p class="eyebrow">SUELDO POR CONFIRMAR</p>
      <h2>${money.format(Number(r.monto||0))}</h2>
      <p class="subtle">Liquidación de ${escapeHtml(String(r.periodo||"").replace(/^(\d{4})-(\d{2})$/,"$2/$1"))}. Este monto no se incluirá en tu saldo disponible hasta que lo confirmes.</p>
      <div class="salary-review-actions">
        <button type="button" class="primary confirm-salary">Confirmar sueldo</button>
        <button type="button" class="ghost discard-salary">No corresponde</button>
      </div>
      <p class="subtle salary-review-status" role="status" aria-live="polite"></p>
    </div>
  `).join("");
  panel.querySelectorAll(".salary-review").forEach(item=>{
    const id=item.dataset.id;
    item.querySelector(".confirm-salary").addEventListener("click",()=>resolverSueldo(id,true,item));
    item.querySelector(".discard-salary").addEventListener("click",()=>resolverSueldo(id,false,item));
  });
}

async function resolverSueldo(id,confirmar,item){
  const row=allIncomes.find(r=>String(r.id)===id);
  if(!row)return;
  const question=confirmar ?
    "¿Confirmas que recibiste el sueldo de "+money.format(Number(row.monto||0))+" correspondiente a "+String(row.periodo||"")+"?" :
    "¿Descartar esta liquidación? No se sumará como ingreso.";
  if(!window.confirm(question))return;
  const buttons=item.querySelectorAll("button");
  buttons.forEach(button=>button.disabled=true);
  const status=item.querySelector(".salary-review-status");
  status.textContent="Guardando decisión…";
  try{
    await api({}, {method:"POST",body:new URLSearchParams({action:confirmar?"confirm_salary":"discard_salary",id})});
    await refresh();
  }catch(error){
    buttons.forEach(button=>button.disabled=false);
    status.textContent="No se pudo guardar: "+error.message;
  }
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
    <div class="swipe-item" data-id="${escapeHtml(r.id)}">
      <button type="button" class="swipe-delete" aria-label="Eliminar movimiento ${escapeHtml(movementName(r))}">Eliminar</button>
      <div class="movement" role="button" tabindex="0" aria-label="${escapeHtml(movementName(r))}. Desliza a la izquierda para eliminar.">
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
    </div>
  `).join("");

  box.querySelectorAll(".swipe-item").forEach(item=>{
    const row=item.querySelector(".movement");
    const del=item.querySelector(".swipe-delete");
    const id=item.dataset.id;
    const width=112;
    let startX=0,startY=0,startOffset=0,offset=0;
    let tracking=false,axis="",dragged=false,suppressClick=false;
    const settle=(open)=>{
      item.classList.remove("swipe-dragging");
      item.classList.toggle("swipe-open",open);
      offset=open ? -width : 0;
      row.style.transform="";
      del.tabIndex=open ? 0 : -1;
      del.setAttribute("aria-hidden",open ? "false" : "true");
    };
    const closeOthers=()=>{
      box.querySelectorAll(".swipe-open").forEach(other=>{
        if(other===item)return;
        other.classList.remove("swipe-open","swipe-dragging");
        const otherRow=other.querySelector(".movement");
        otherRow.style.transform="";
        const otherDel=other.querySelector(".swipe-delete");
        otherDel.tabIndex=-1;
        otherDel.setAttribute("aria-hidden","true");
      });
    };
    del.tabIndex=-1;
    del.setAttribute("aria-hidden","true");
    row.addEventListener("touchstart",event=>{
      if(event.touches.length!==1)return;
      tracking=true;
      axis="";
      dragged=false;
      startX=event.touches[0].clientX;
      startY=event.touches[0].clientY;
      startOffset=item.classList.contains("swipe-open") ? -width : 0;
      offset=startOffset;
    },{passive:true});
    row.addEventListener("touchmove",event=>{
      if(!tracking || event.touches.length!==1)return;
      const dx=event.touches[0].clientX-startX;
      const dy=event.touches[0].clientY-startY;
      if(!axis){
        if(Math.abs(dx)<7 && Math.abs(dy)<7)return;
        axis=Math.abs(dx)>Math.abs(dy)*1.15 ? "horizontal" : "vertical";
        if(axis==="horizontal"){
          closeOthers();
          item.classList.add("swipe-dragging");
        }
      }
      if(axis!=="horizontal")return;
      if(event.cancelable)event.preventDefault();
      dragged=true;
      offset=Math.max(-width-12,Math.min(12,startOffset+dx));
      row.style.transform="translate3d("+offset+"px,0,0)";
    },{passive:false});
    row.addEventListener("touchend",event=>{
      if(!tracking)return;
      tracking=false;
      if(axis==="horizontal" && dragged){
        const dx=event.changedTouches[0].clientX-startX;
        // A short deliberate flick also opens the action.
        const open=offset < -width*0.42 || (dx < -30 && startOffset===0);
        settle(open);
        suppressClick=true;
        window.setTimeout(()=>{suppressClick=false;},350);
      }else item.classList.remove("swipe-dragging");
    },{passive:true});
    row.addEventListener("touchcancel",()=>{
      tracking=false;
      settle(item.classList.contains("swipe-open"));
    },{passive:true});
    row.addEventListener("click",()=>{
      if(suppressClick)return;
      if(item.classList.contains("swipe-open")){settle(false);return;}
      openEditor(id);
    });
    row.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){event.preventDefault();openEditor(id);}
      if(event.key==="ArrowLeft"){event.preventDefault();closeOthers();settle(true);del.focus();}
      if(event.key==="ArrowRight"||event.key==="Escape"){event.preventDefault();settle(false);}
    });
    del.addEventListener("click",()=>eliminarMovimiento(id,item,del));
  });
}

async function eliminarMovimiento(id,item,button){
  const movimiento=allRows.find(r=>String(r.id)===String(id));
  if(!movimiento)return;
  if(!window.confirm("¿Eliminar "+movementName(movimiento)+" por "+money.format(Number(movimiento.monto||0))+"?\\n\\nSe quitará de tus gastos y totales."))return;
  button.disabled=true;
  button.textContent="Eliminando…";
  try{
    await api({}, {method:"POST",body:new URLSearchParams({action:"delete",id})});
    allRows=allRows.filter(r=>String(r.id)!==String(id));
    render();
    await refresh();
  }catch(err){
    button.disabled=false;
    button.textContent="Eliminar";
    window.alert("No se pudo eliminar: "+err.message);
  }
}

function render(){
  renderSummary();
  renderCategoryBars();
  renderBankFilter();
  renderMovements();
  renderStatements();
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
    allStatements=data.estadosCuenta||[];
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


// Los PDF se analizan solamente en el navegador. No se envían sus bytes ni su
// contraseña a Apps Script. El usuario verifica los datos antes de guardarlos.
let pdfReaderPromise=null;
function loadPdfReader(){
  if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(!pdfReaderPromise){
    pdfReaderPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.crossOrigin="anonymous";
      script.onload=()=>{
        if(!window.pdfjsLib){reject(new Error("No se pudo cargar el lector de PDF"));return;}
        window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      script.onerror=()=>reject(new Error("No se pudo cargar el lector de PDF. Puedes ingresar el total y el vencimiento manualmente."));
      document.head.appendChild(script);
    }).catch(error=>{pdfReaderPromise=null;throw error;});
  }
  return pdfReaderPromise;
}
function parseStatementPreview(text){
  const normalize=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  const lines=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const values=new Set(),dates=new Set();
  const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,
    julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
  const label=/\b(?:monto\s+total\s+a\s+pagar|total\s+(?:facturado|a\s+pagar)|pago\s+total)\b/;
  const amount=/(?:CLP\s*|\$\s*)([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d{3,})(?![\d.,])/gi;
  for(let i=0;i<lines.length;i++){
    const line=normalize(lines[i]);
    const next=normalize(lines[i+1]||"");
    if(label.test(line)&&!/minim|dolar|usd|\buf\b|anterior|cuotas futuras|cupo/.test(line)){
      const after=line.replace(label,"");
      const found=[...(after.matchAll(amount))];
      const foundNext=found.length ? found : [...(next.matchAll(amount))];
      if(foundNext.length===1)values.add(Number(foundNext[0][1].replace(/\./g,"")));
    }
    if(/fecha\s+de\s+vencimiento|vencimiento|vence\s+el|fecha\s+limite\s+de\s+pago/.test(line)&&!/vencimiento\s+anterior/.test(line)){
      const context=line+" "+next;
      for(const m of context.matchAll(/\b([0-3]?\d)[/-]([01]?\d)[/-](20\d{2})\b/g)){
        const d=new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1])));
        if(d.getUTCDate()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1)dates.add(d.toISOString().slice(0,10));
      }
      for(const m of context.matchAll(/\b([0-3]?\d)\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/g)){
        const d=new Date(Date.UTC(Number(m[3]),months[m[2]]-1,Number(m[1])));
        if(d.getUTCDate()===Number(m[1])&&d.getUTCMonth()===months[m[2]]-1)dates.add(d.toISOString().slice(0,10));
      }
    }
  }
  return {monto:values.size===1?[...values][0]:null,vencimiento:dates.size===1?[...dates][0]:null};
}
function renderStatements(){
  const box=$("statementList");
  if(!box)return;
  const rows=allStatements.filter(r=>r.estado==="PENDIENTE");
  box.innerHTML=rows.length?rows.map(r=>`
    <div class="statement-item">
      <div><strong>${escapeHtml(r.banco)}</strong><p class="subtle">Vence: ${escapeHtml(r.vencimiento)} · Pendiente de pago</p></div>
      <strong>${money.format(Number(r.saldoPendienteCLP||0))}</strong>
    </div>`).join(""):'<p class="subtle">No hay estados de cuenta pendientes registrados.</p>';
}
$("statementPdf").addEventListener("change",async event=>{
  const file=event.target.files&&event.target.files[0];
  if(!file)return;
  const status=$("statementStatus"),password=$("statementPdfPassword").value;
  status.textContent="Leyendo PDF en este dispositivo…";
  $("statementAmount").value="";
  $("statementDue").value="";
  if(file.size>8*1024*1024){status.textContent="El archivo supera 8 MB.";return;}
  if(file.type && file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){status.textContent="Selecciona un archivo PDF.";return;}
  try{
    const pdfjs=await loadPdfReader();
    const bytes=new Uint8Array(await file.arrayBuffer());
    const openPdf=async pwd=>{
      const task=pdfjs.getDocument({data:bytes.slice(),password:pwd||undefined});
      return task.promise;
    };
    let pdf;
    try{pdf=await openPdf(password);}catch(err){
      if(err&&err.name==="PasswordException"){
        const entered=window.prompt("Contraseña del PDF (solo se utiliza en este dispositivo):");
        if(!entered)throw new Error("No se ingresó la contraseña del PDF.");
        pdf=await openPdf(entered);
      }else throw err;
    }
    if(pdf.numPages>25)throw new Error("PDF demasiado largo para esta lectura.");
    const lines=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      // Text items may be separate columns. Each piece stays on its own line;
      // do not assume a monetary total is in the first number on a page.
      for(const item of content.items){if(item.str&&item.str.trim())lines.push(item.str.trim());}
    }
    const parsed=parseStatementPreview(lines.join("\n"));
    if(parsed.monto)$("statementAmount").value=String(parsed.monto);
    if(parsed.vencimiento)$("statementDue").value=parsed.vencimiento;
    status.textContent=parsed.monto&&parsed.vencimiento ?
      "Se encontraron un total y un vencimiento. Compáralos con el PDF antes de guardar." :
      "No se pudieron reconocer ambos datos con seguridad. Escribe el total a pagar y el vencimiento consultando el PDF.";
  }catch(error){
    status.textContent="No se pudo leer automáticamente: "+(error.message||"PDF no compatible")+
      " Puedes completar el total y el vencimiento manualmente.";
  }finally{$("statementPdfPassword").value="";}
});
$("statementForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const banco=$("statementBank").value,monto=$("statementAmount").value,vencimiento=$("statementDue").value;
  if(!banco||!/^\d+$/.test(monto)||Number(monto)<=0||!/^20\d{2}-\d{2}-\d{2}$/.test(vencimiento)){
    $("statementStatus").textContent="Revisa banco, total CLP y vencimiento.";return;
  }
  if(!window.confirm("¿Guardar estado de cuenta de "+banco+" por "+money.format(Number(monto))+
    " con vencimiento "+vencimiento+" como PENDIENTE? Comprueba los datos con tu PDF."))return;
  const button=$("statementSave");
  button.disabled=true;$("statementStatus").textContent="Guardando estado de cuenta…";
  try{
    await api({}, {method:"POST",body:new URLSearchParams({action:"add_statement_manual",banco,monto,vencimiento})});
    $("statementForm").reset();
    $("statementStatus").textContent="Estado de cuenta guardado como pendiente. No se sumó como gasto adicional.";
    await refresh();
  }catch(error){
    $("statementStatus").textContent="No se pudo guardar: "+error.message;
  }finally{button.disabled=false;}
});

populateCategorySelects();
$("category").value="Otros";
apiReady();
refresh().catch(err=>{
  console.error(err);
  $("lastUpdate").textContent="No se pudieron cargar los movimientos";
});