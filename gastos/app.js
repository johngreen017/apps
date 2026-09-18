const GAS_URL = "https://script.google.com/macros/s/AKfycbxSthEmInpSZZePa0AuMmWClpnMVqpoq7m3LRXMlEg11llwyk4Ker6U7aNlbRWCTKvQHg/exec";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});

function apiReady(){
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GAS_URL);
  $("setup").classList.toggle("hidden", ok);
  return ok;
}

async function api(params={}, options={}){
  if(!apiReady()) throw new Error("Apps Script no configurado");
  const u = new URL(GAS_URL);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const res = await fetch(u, options);
  if(!res.ok) throw new Error("Error de conexión");
  return res.json();
}

function render(rows=[]){
  const box=$("movements");
  $("count").textContent=rows.length;
  const now=new Date();
  const monthly=rows.filter(r=>{
    const d=new Date(r.fecha);
    return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
  });
  $("monthTotal").textContent=money.format(monthly.reduce((a,r)=>a+Number(r.monto||0),0));
  if(!rows.length){box.innerHTML='<p class="empty">Aún no hay movimientos.</p>';return;}
  box.innerHTML=rows.slice(0,30).map(r=>`
    <div class="movement">
      <div><strong>${escapeHtml(r.comercio||r.descripcion||"Movimiento")}</strong></div>
      <div class="amount">${money.format(Number(r.monto||0))}</div>
      <div class="meta">${escapeHtml(r.categoria||"Otros")} · ${escapeHtml(r.banco||"")} · ${formatDate(r.fecha)}</div>
    </div>`).join("");
}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function formatDate(v){const d=new Date(v);return isNaN(d)?String(v||""):d.toLocaleDateString("es-CL")}

async function refresh(){
  if(!apiReady()) return;
  const data=await api({action:"list",limit:"100"});
  render(data.movimientos||[]);
}
async function sync(){
  if(!apiReady()) return;
  $("syncBtn").disabled=true;
  try{await api({action:"sync"});await refresh();}finally{$("syncBtn").disabled=false;}
}
$("refreshBtn").addEventListener("click",refresh);
$("syncBtn").addEventListener("click",sync);
$("manualForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!apiReady()) return;
  const payload={
    descripcion:$("description").value.trim(),
    comercio:$("description").value.trim(),
    monto:Number($("amount").value),
    categoria:$("category").value,
    fuente:"MANUAL"
  };
  const body=new URLSearchParams({action:"add",payload:JSON.stringify(payload)});
  await api({}, {method:"POST",body});
  e.target.reset();
  await refresh();
});
apiReady();
refresh().catch(console.error);