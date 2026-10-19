(()=>{
"use strict";
/* ---------- utilidades ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse=s=>{const[y,m,d]=String(s).split("-").map(Number);return new Date(y,(m||1)-1,d||1,12)};
const today=()=>iso(new Date());
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const addMonths=(s,n)=>{const d=parse(s);const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d)};
const daysBetween=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const monthOf=s=>String(s).slice(0,7);
const monthStart=m=>m+"-01";
const monthEnd=m=>{const[y,mm]=m.split("-").map(Number);return iso(new Date(y,mm,0,12))};
const shiftMonth=(m,n)=>monthOf(addMonths(monthStart(m),n));
const MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DIAS=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const monthLabel=m=>{const[y,mm]=m.split("-").map(Number);return MESES[mm-1].replace(/^./,c=>c.toUpperCase())+" "+y};
const fdate=s=>{if(!s)return"—";const d=parse(s);return `${d.getDate()} ${MESES[d.getMonth()].slice(0,3)} ${d.getFullYear()}`};
const fdateShort=s=>{const d=parse(s);return `${d.getDate()} ${MESES[d.getMonth()].slice(0,3)}`};
const r2=n=>Math.round((+n||0)*100)/100;
const NF0=new Intl.NumberFormat("es-CR",{style:"currency",currency:"CRC",maximumFractionDigits:0});
const NF2=new Intl.NumberFormat("es-CR",{style:"currency",currency:"CRC",minimumFractionDigits:2,maximumFractionDigits:2});
const NFC=new Intl.NumberFormat("es-CR",{notation:"compact",maximumFractionDigits:1});
const money=(n,d=0)=>(d?NF2:NF0).format(+n||0);
const hrs=n=>(Math.round((+n||0)*100)/100).toLocaleString("es-CR")+" h";
const mondayOf=s=>{const d=parse(s);const wd=(d.getDay()+6)%7;return addDays(s,-wd)};
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);

const FREQ={diario:{label:"Diario",days:1},semanal:{label:"Semanal",days:7},quincenal:{label:"Quincenal",days:15},mensual:{label:"Mensual",months:1}};
const PAYFREQ={semanal:"Semanal",quincenal:"Quincenal",mensual:"Mensual"};
const CATS=["Alquiler","Servicios públicos","Insumos y materiales","Combustible y transporte","Mantenimiento","Impuestos y patentes","Seguros","Publicidad","Comisiones bancarias","Otros"];
const METODOS=["SINPE Móvil","Transferencia","Efectivo","Tarjeta","Cheque"];
const DEFAULT_CFG={empresa:"Mi empresa",obrero:10.83,patronal:26.83,ins:0,jornada:8,divisorHora:240,recargoExtra:1.5,aguinaldo:8.33,vacaciones:4.17};

/* ---------- estado ---------- */
const COLS=["clientes","cobros","empleados","planillas","turnos","gastos"];
const S={clientes:[],cobros:[],empleados:[],planillas:[],turnos:[],gastos:[],cfg:{...DEFAULT_CFG},
  loaded:new Set(),tab:"resumen",month:monthOf(today()),week:mondayOf(today()),filtroFrec:"todos",buscar:"",draft:null,dbState:"cargando"};
let db=null,downloads=null;
try{const t=localStorage.getItem("ca_tab");if(t)S.tab=t}catch(e){}

/* ---------- datos ---------- */
function handleErr(e){
  const c=e&&e.code;
  if(c==="invalid_argument")toast("No tenés permiso para modificar estos datos.");
  else if(c==="quota_exceeded")toast("La base de datos llegó a su límite. Eliminá registros viejos para seguir.");
  else toast("No se pudo guardar. Revisá la conexión e intentá de nuevo.");
  console.error(e);
}
async function save(col,id,data){
  if(!db){toast("La base de datos no está disponible en esta vista.");return false}
  try{if(id)await db.collection(col).doc(id).set(data);else await db.collection(col).doc(uid()).set(data);return true}
  catch(e){handleErr(e);return false}
}
async function remove(col,id){
  if(!db)return false;
  try{await db.collection(col).doc(id).delete();return true}catch(e){handleErr(e);return false}
}
const byId=(col,id)=>S[col].find(x=>x.id===id);
const cfg=()=>S.cfg;

/* ---------- lógica de cobros ---------- */
function dueDate(c,k){const f=FREQ[c.frecuencia]||FREQ.mensual;return f.months?addMonths(c.inicio,k*f.months):addDays(c.inicio,k*f.days)}
function dueCount(c,until){
  if(!c.inicio||until<c.inicio)return 0;
  const f=FREQ[c.frecuencia]||FREQ.mensual;
  if(f.days)return Math.floor(daysBetween(c.inicio,until)/f.days)+1;
  const s=parse(c.inicio),u=parse(until);
  let m=(u.getFullYear()-s.getFullYear())*12+u.getMonth()-s.getMonth();
  while(m>=0&&dueDate(c,m)>until)m--;
  return m+1;
}
function estadoCliente(c){
  const t=today();
  const activo=c.activo!==false;
  const hasta=(!activo&&c.baja&&c.baja<t)?c.baja:t;
  const monto=+c.monto||0;
  const n=dueCount(c,hasta);
  const esperado=n*monto;
  const pagos=S.cobros.filter(p=>p.clienteId===c.id);
  const pagado=pagos.reduce((a,p)=>a+(+p.monto||0),0);
  const saldo=r2(esperado-pagado);
  const pagados=monto>0?Math.floor((pagado+0.005)/monto):0;
  let estado,proximo=null,vencido=null;
  if(saldo>0.5){vencido=dueDate(c,pagados);estado=saldo>monto+0.5?"atrasado":"pendiente"}
  else estado="aldia";
  if(activo&&monto>0)proximo=dueDate(c,Math.max(pagados,n));
  const periodos=monto>0&&saldo>0?Math.ceil(saldo/monto-0.0001):0;
  const ultimo=pagos.map(p=>p.fecha).sort().pop()||null;
  return {activo,esperado,pagado,saldo,estado,proximo,vencido,periodos,ultimo};
}
const ESTADO_PILL={aldia:'<span class="pill ok">Al día</span>',pendiente:'<span class="pill warn">Pendiente</span>',atrasado:'<span class="pill bad">Atrasado</span>'};

/* ---------- lógica de turnos y planilla ---------- */
function horasTurno(t){
  const[h1,m1]=String(t.inicio||"0:0").split(":").map(Number),[h2,m2]=String(t.fin||"0:0").split(":").map(Number);
  let mins=(h2*60+m2)-(h1*60+m1);if(mins<=0)mins+=1440;
  mins-=(+t.descanso||0);return Math.max(0,mins/60);
}
function horasEmpleado(empId,desde,hasta){
  const porDia={};
  S.turnos.filter(t=>t.empleadoId===empId&&t.fecha>=desde&&t.fecha<=hasta).forEach(t=>{porDia[t.fecha]=(porDia[t.fecha]||0)+horasTurno(t)});
  let ord=0,ext=0,total=0;const j=+cfg().jornada||8;
  Object.values(porDia).forEach(h=>{total+=h;ord+=Math.min(h,j);ext+=Math.max(0,h-j)});
  return {ord:r2(ord),ext:r2(ext),total:r2(total),dias:Object.keys(porDia).length};
}
function calcLinea(l){
  const c=cfg();
  const bruto=r2(l.base+l.extra+(+l.bonos||0));
  const obrero=r2(bruto*c.obrero/100);
  const neto=r2(bruto-obrero-(+l.rebajos||0));
  const patronal=r2(bruto*c.patronal/100);
  const ins=r2(bruto*c.ins/100);
  return {...l,bruto,obrero,neto,patronal,ins,costo:r2(bruto+patronal+ins)};
}
function calcPlanilla(freq,desde,hasta){
  const c=cfg();
  const emps=S.empleados.filter(e=>e.activo!==false&&e.frecuencia===freq).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  return emps.map(e=>{
    const h=horasEmpleado(e.id,desde,hasta);
    let base,valorHora;
    if(e.modo==="hora"){valorHora=+e.tarifaHora||0;base=h.ord*valorHora}
    else{const m=+e.salario||0;base=freq==="mensual"?m:freq==="quincenal"?m/2:m*12/52;valorHora=m/(+c.divisorHora||240)}
    const extra=h.ext*valorHora*(+c.recargoExtra||1.5);
    return calcLinea({empleadoId:e.id,nombre:e.nombre,puesto:e.puesto||"",modo:e.modo||"fijo",horas:h.total,horasExtra:h.ext,valorHora:r2(valorHora),base:r2(base),extra:r2(extra),bonos:0,rebajos:0});
  });
}
function totales(lineas){
  const t={bruto:0,obrero:0,neto:0,patronal:0,ins:0,costo:0,base:0,extra:0,bonos:0,rebajos:0};
  lineas.forEach(l=>Object.keys(t).forEach(k=>t[k]+=+l[k]||0));
  Object.keys(t).forEach(k=>t[k]=r2(t[k]));return t;
}
function periodoDefault(freq){
  const t=today(),d=parse(t);
  if(freq==="semanal"){const m=mondayOf(t);return[m,addDays(m,6)]}
  if(freq==="quincenal"){const m=monthOf(t);return d.getDate()<=15?[m+"-01",m+"-15"]:[m+"-16",monthEnd(m)]}
  const m=monthOf(t);return[monthStart(m),monthEnd(m)];
}

/* ---------- resumen financiero ---------- */
function finanzasMes(m){
  const a=monthStart(m),b=monthEnd(m);
  const cobros=S.cobros.filter(p=>p.fecha>=a&&p.fecha<=b);
  const ingresos=cobros.reduce((s,p)=>s+(+p.monto||0),0);
  const gastos=S.gastos.filter(g=>g.fecha>=a&&g.fecha<=b);
  const gastosTot=gastos.reduce((s,g)=>s+(+g.monto||0),0);
  const plan=S.planillas.filter(p=>p.fechaPago>=a&&p.fechaPago<=b);
  const pt=totales(plan.map(p=>p.totales||{}));
  const egresos=gastosTot+pt.bruto+pt.patronal+pt.ins;
  return {cobros,ingresos,gastos,gastosTot,plan,pt,egresos,resultado:ingresos-egresos};
}

/* ---------- interfaz ---------- */
const ICONS={
  resumen:'<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  clientes:'<path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM8 12a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-6 1.3-6 4v2h6v-2.2c0-1.4.7-2.6 1.8-3.5A9 9 0 0 0 8 14zm8-1c-3 0-7 1.5-7 4.5V20h14v-2.5c0-3-4-4.5-7-4.5z"/>',
  planilla:'<path d="M4 4h16v4H4zm0 6h16v10H4zm3 3v2h4v-2zm0 3v1h7v-1z"/>',
  turnos:'<path d="M7 2v2H4v18h16V4h-3V2h-2v2H9V2zm-1 8h12v10H6zm2 2v2h3v-2zm5 0v2h3v-2z"/>',
  gastos:'<path d="M3 6h18v12H3zm2 2v8h14V8zm7 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>',
  informes:'<path d="M4 20V10h3v10zm6 0V4h3v16zm6 0v-7h3v7z"/>',
  ajustes:'<path d="M12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4zm9 5.4v-2.8l-2.3-.5a7 7 0 0 0-.7-1.7l1.3-2-2-2-2 1.3a7 7 0 0 0-1.7-.7L13.4 3h-2.8l-.5 2.3a7 7 0 0 0-1.7.7l-2-1.3-2 2 1.3 2a7 7 0 0 0-.7 1.7L3 10.6v2.8l2.3.5a7 7 0 0 0 .7 1.7l-1.3 2 2 2 2-1.3a7 7 0 0 0 1.7.7l.5 2.3h2.8l.5-2.3a7 7 0 0 0 1.7-.7l2 1.3 2-2-1.3-2a7 7 0 0 0 .7-1.7z"/>'
};
const TABS=[["resumen","Resumen"],["clientes","Clientes y cobros"],["planilla","Planilla"],["turnos","Turnos"],["gastos","Gastos"],["informes","Informes"],["ajustes","Ajustes"]];

function renderNav(){
  $("#nav").innerHTML=TABS.map(([k,l])=>`<button type="button" data-tab="${k}" ${S.tab===k?'aria-current="page"':""}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[k]}</svg>${l}</button>`).join("");
  $("#brandName").textContent=cfg().empresa||"Mi empresa";
  $("#footRates").textContent=`${cfg().obrero}% obrero · ${cfg().patronal}% patronal`;
  $("#footMode").textContent=S.modo==="local"?"Datos guardados en este navegador":S.modo==="nube"?"Datos sincronizados":"";
}
let renderQueued=false;
function render(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;doRender()})}
function doRender(){
  const a=document.activeElement;const fid=a&&a.id&&$("#view").contains(a)?a.id:null;const sel=fid&&a.selectionStart!=null?[a.selectionStart,a.selectionEnd]:null;
  renderNav();
  const v=VIEWS[S.tab]||VIEWS.resumen;
  $("#view").innerHTML=banner()+v();
  if(fid){const el=document.getElementById(fid);if(el){el.focus();if(sel&&el.setSelectionRange)try{el.setSelectionRange(...sel)}catch(e){}}}
}
function banner(){
  if(S.dbState==="sin-db")return `<div class="banner">Se perdió el acceso a la base de datos. Recargá la página para volver a conectar.</div>`;
  if(S.dbState==="cargando")return `<div class="banner">Cargando registros…</div>`;
  return "";
}
function head(eyebrow,title,actions=""){return `<div class="head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div><div class="row">${actions}</div></div>`}
const exTag=x=>x&&x.ejemplo?'<span class="ex">EJEMPLO</span>':"";
function monthNav(){return `<div class="monthnav"><button class="btn sm" data-act="mes" data-n="-1" aria-label="Mes anterior">‹</button><b>${monthLabel(S.month)}</b><button class="btn sm" data-act="mes" data-n="1" aria-label="Mes siguiente">›</button></div>`}

/* ---------- vistas ---------- */
const VIEWS={};

VIEWS.resumen=()=>{
  const f=finanzasMes(S.month);
  const est=S.clientes.map(c=>({c,e:estadoCliente(c)}));
  const porCobrar=est.reduce((s,x)=>s+Math.max(0,x.e.saldo),0);
  const deudores=est.filter(x=>x.e.saldo>0.5).sort((a,b)=>b.e.saldo-a.e.saldo);
  const t=today(),lim=addDays(t,7);
  const proximos=est.filter(x=>x.e.activo&&x.e.saldo<=0.5&&x.e.proximo&&x.e.proximo<=lim).sort((a,b)=>a.e.proximo.localeCompare(b.e.proximo));
  const turnosHoy=S.turnos.filter(x=>x.fecha===t).sort((a,b)=>a.inicio.localeCompare(b.inicio));
  const prev=shiftMonth(monthOf(t),-1);const fp=finanzasMes(prev);
  const ccss=r2(fp.pt.obrero+fp.pt.patronal);
  const sinDatos=!S.clientes.length&&!S.empleados.length&&!S.gastos.length;
  return head("Panorama de "+monthLabel(S.month).toLowerCase(),cfg().empresa||"Mi empresa",`${monthNav()}<button class="btn primary" data-act="nuevo-pago">Registrar pago</button>`)+
  (sinDatos&&S.dbState==="lista"?`<div class="panel"><div class="empty"><b>Todavía no hay registros</b>Empezá agregando clientes en “Clientes y cobros”, empleados en “Planilla” y gastos en “Gastos”. Si querés ver cómo funciona, cargá datos de ejemplo desde “Ajustes”.</div></div>`:"")+
  `<div class="kpis">
    <div class="kpi"><div class="l">Ingresos del mes</div><div class="v">${money(f.ingresos)}</div><div class="s">${f.cobros.length} pagos recibidos</div></div>
    <div class="kpi"><div class="l">Egresos del mes</div><div class="v">${money(f.egresos)}</div><div class="s">Gastos ${money(f.gastosTot)} · planilla ${money(f.pt.bruto+f.pt.patronal+f.pt.ins)}</div></div>
    <div class="kpi ${f.resultado<0?"neg":"pos"}"><div class="l">Resultado del mes</div><div class="v">${money(f.resultado)}</div><div class="s">Ingresos menos egresos</div></div>
    <div class="kpi ${porCobrar>0?"neg":""}"><div class="l">Por cobrar hoy</div><div class="v">${money(porCobrar)}</div><div class="s">${deudores.length} cliente${deudores.length===1?"":"s"} con saldo</div></div>
  </div>
  <div class="grid2">
    <section class="panel"><header><h2>Cobros pendientes</h2><button class="btn sm ghost" data-tab="clientes">Ver clientes</button></header>
      ${deudores.length?`<div class="list">${deudores.slice(0,8).map(({c,e})=>`<div class="li"><div class="t"><b>${esc(c.nombre)}${exTag(c)}</b><span>Vencido desde ${fdate(e.vencido)} · ${e.periodos} período${e.periodos===1?"":"s"}</span></div><div class="row"><span class="mono">${money(e.saldo)}</span><button class="btn sm" data-act="pago" data-id="${c.id}">Cobrar</button></div></div>`).join("")}</div>`:`<div class="empty"><b>Nadie debe</b>Todos los clientes están al día.</div>`}
    </section>
    <section class="panel"><header><h2>Turnos de hoy</h2><button class="btn sm ghost" data-tab="turnos">Ver semana</button></header>
      ${turnosHoy.length?`<div class="list">${turnosHoy.map(x=>{const e=byId("empleados",x.empleadoId);return `<div class="li"><div class="t"><b>${esc(e?e.nombre:"Empleado eliminado")}</b><span>${esc(x.nota||e?.puesto||"")}</span></div><span class="mono">${esc(x.inicio)}–${esc(x.fin)}</span></div>`}).join("")}</div>`:`<div class="empty"><b>Sin turnos hoy</b>Asigná turnos desde la pestaña Turnos.</div>`}
    </section>
    <section class="panel"><header><h2>Próximos cobros · 7 días</h2></header>
      ${proximos.length?`<div class="list">${proximos.map(({c,e})=>`<div class="li"><div class="t"><b>${esc(c.nombre)}${exTag(c)}</b><span>${FREQ[c.frecuencia]?.label||""} · ${fdate(e.proximo)}</span></div><span class="mono">${money(c.monto)}</span></div>`).join("")}</div>`:`<div class="empty">No hay cobros programados en los próximos 7 días.</div>`}
    </section>
    <section class="panel"><header><h2>Cargas sociales por pagar</h2></header>
      <div class="body" style="display:flex;flex-direction:column;gap:10px">
        <div class="li" style="padding:0;border:none"><div class="t"><b>CCSS de ${monthLabel(prev).toLowerCase()}</b><span>Cuota obrera ${money(fp.pt.obrero)} + patronal ${money(fp.pt.patronal)} · vence ${fdate(monthStart(monthOf(t))).replace(/^1 /,"15 ")}</span></div><span class="mono">${money(ccss)}</span></div>
        <div class="li" style="padding:0;border:none"><div class="t"><b>INS riesgos del trabajo</b><span>Según la póliza (${cfg().ins}% configurado)</span></div><span class="mono">${money(fp.pt.ins)}</span></div>
        <p class="note">Calculado con las planillas guardadas cuya fecha de pago cae en ${monthLabel(prev).toLowerCase()}. La planilla se reporta en SICERE.</p>
      </div>
    </section>
  </div>`;
};

VIEWS.clientes=()=>{
  const q=S.buscar.trim().toLowerCase();
  let rows=S.clientes.map(c=>({c,e:estadoCliente(c)}));
  if(S.filtroFrec!=="todos")rows=rows.filter(x=>x.c.frecuencia===S.filtroFrec);
  if(q)rows=rows.filter(x=>(x.c.nombre+" "+(x.c.servicio||"")).toLowerCase().includes(q));
  const ord={atrasado:0,pendiente:1,aldia:2};
  rows.sort((a,b)=>(a.e.activo===b.e.activo?0:a.e.activo?-1:1)||ord[a.e.estado]-ord[b.e.estado]||a.c.nombre.localeCompare(b.c.nombre));
  const tot=rows.reduce((s,x)=>s+Math.max(0,x.e.saldo),0);
  const recientes=[...S.cobros].sort((a,b)=>(b.fecha+b.creado).localeCompare(a.fecha+a.creado)).slice(0,25);
  const chips=[["todos","Todos"],...Object.entries(FREQ).map(([k,v])=>[k,v.label])];
  return head("Servicios diarios, semanales, quincenales y mensuales","Clientes y cobros",`<button class="btn" data-act="nuevo-cliente">Nuevo cliente</button><button class="btn primary" data-act="nuevo-pago">Registrar pago</button>`)+
  `<section class="panel"><header><div class="chips" role="group" aria-label="Filtrar por frecuencia">${chips.map(([k,l])=>`<button class="chip" data-act="frec" data-k="${k}" aria-pressed="${S.filtroFrec===k}">${l}</button>`).join("")}</div>
    <div style="min-width:200px;flex:1;max-width:280px"><input id="buscar" type="search" placeholder="Buscar cliente o servicio" value="${esc(S.buscar)}" aria-label="Buscar cliente"></div></header>
  ${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Frecuencia</th><th class="n">Cuota</th><th class="n">Pagado</th><th class="n">Saldo</th><th>Próximo cobro</th><th>Estado</th><th></th></tr></thead><tbody>
  ${rows.map(({c,e})=>`<tr><td><b>${esc(c.nombre)}</b>${exTag(c)}<span class="sub">${esc(c.servicio||"")}${c.telefono?" · "+esc(c.telefono):""}</span></td>
    <td><span class="tag">${FREQ[c.frecuencia]?.label||"—"}</span></td>
    <td class="n">${money(c.monto)}</td><td class="n">${money(e.pagado)}</td>
    <td class="n" style="color:${e.saldo>0.5?"var(--bad)":e.saldo<-0.5?"var(--ok)":"inherit"}">${e.saldo<-0.5?"a favor "+money(-e.saldo):money(Math.max(0,e.saldo))}</td>
    <td>${e.saldo>0.5?`<span style="color:var(--bad)">Vencido ${fdateShort(e.vencido)}</span>`:e.proximo?fdate(e.proximo):"—"}</td>
    <td>${e.activo?ESTADO_PILL[e.estado]:'<span class="pill off">Inactivo</span>'}</td>
    <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="pago" data-id="${c.id}">Pago</button><button class="btn sm ghost" data-act="historial" data-id="${c.id}">Historial</button><button class="btn sm ghost" data-act="editar-cliente" data-id="${c.id}">Editar</button></div></td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="4">Total por cobrar (${rows.length} clientes)</td><td class="n">${money(tot)}</td><td colspan="3"></td></tr></tfoot></table></div>`
  :`<div class="empty"><b>${S.clientes.length?"Ningún cliente coincide":"Sin clientes todavía"}</b>${S.clientes.length?"Probá con otro filtro o búsqueda.":"Agregá el primero con “Nuevo cliente”: nombre, servicio, frecuencia de cobro, cuota y fecha de inicio."}</div>`}
  </section>
  <section class="panel"><header><h2>Pagos recientes</h2><span class="hint">Últimos 25</span></header>
  ${recientes.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Método</th><th>Referencia</th><th class="n">Monto</th><th></th></tr></thead><tbody>
  ${recientes.map(p=>{const c=byId("clientes",p.clienteId);return `<tr><td>${fdate(p.fecha)}</td><td>${esc(c?c.nombre:"Cliente eliminado")}${exTag(p)}</td><td>${esc(p.metodo||"")}</td><td>${esc(p.referencia||"")}</td><td class="n">${money(p.monto)}</td><td><button class="btn sm ghost danger" data-act="borrar-pago" data-id="${p.id}">Anular</button></td></tr>`}).join("")}
  </tbody></table></div>`:`<div class="empty">Aquí aparecen los pagos que registrés.</div>`}
  </section>
  <p class="note">Cada cliente genera un cobro al inicio de cada período desde su fecha de inicio: diario cada día, semanal cada 7 días, quincenal cada 15 días y mensual el mismo día de cada mes. El saldo es lo que debió pagar hasta hoy menos lo pagado.</p>`;
};

VIEWS.planilla=()=>{
  const d=S.draft;
  const emps=[...S.empleados].sort((a,b)=>(a.activo===false)-(b.activo===false)||a.nombre.localeCompare(b.nombre));
  const hist=[...S.planillas].sort((a,b)=>b.fechaPago.localeCompare(a.fechaPago)).slice(0,30);
  const c=cfg();
  let draftHtml="";
  if(d){
    const t=totales(d.lineas);
    const dup=S.planillas.find(p=>p.frecuencia===d.frecuencia&&p.desde===d.desde&&p.hasta===d.hasta);
    draftHtml=`<section class="panel"><header><h2>Planilla ${PAYFREQ[d.frecuencia].toLowerCase()} · ${fdate(d.desde)} al ${fdate(d.hasta)}</h2><div class="row"><button class="btn ghost" data-act="cancelar-planilla">Descartar</button><button class="btn primary" data-act="guardar-planilla" ${d.lineas.length?"":"disabled"}>Guardar planilla</button></div></header>
    ${dup?`<div class="body" style="padding-bottom:0"><div class="banner">Ya existe una planilla guardada para este mismo período. Si la guardás de nuevo quedarán dos registros.</div></div>`:""}
    ${d.lineas.length?`<div class="tbl-wrap"><table><thead><tr><th>Empleado</th><th class="n">Horas</th><th class="n">Salario base</th><th class="n">Horas extra</th><th class="n">Bonos</th><th class="n">Bruto</th><th class="n">CCSS obrera ${c.obrero}%</th><th class="n">Rebajos</th><th class="n">Neto a pagar</th><th class="n">Patronal ${c.patronal}%</th><th class="n">INS ${c.ins}%</th></tr></thead><tbody>
    ${d.lineas.map((l,i)=>`<tr><td><b>${esc(l.nombre)}</b><span class="sub">${esc(l.puesto)} · ${l.modo==="hora"?"por hora "+money(l.valorHora):"salario fijo"}</span></td>
      <td class="n">${hrs(l.horas)}</td><td class="n">${money(l.base,2)}</td>
      <td class="n">${money(l.extra,2)}<span class="sub">${hrs(l.horasExtra)}</span></td>
      <td class="n"><input class="cell" id="bon-${i}" data-act="linea" data-i="${i}" data-k="bonos" type="number" min="0" step="0.01" value="${l.bonos||""}" placeholder="0" aria-label="Bonos de ${esc(l.nombre)}"></td>
      <td class="n">${money(l.bruto,2)}</td><td class="n">−${money(l.obrero,2)}</td>
      <td class="n"><input class="cell" id="reb-${i}" data-act="linea" data-i="${i}" data-k="rebajos" type="number" min="0" step="0.01" value="${l.rebajos||""}" placeholder="0" aria-label="Rebajos de ${esc(l.nombre)}"></td>
      <td class="n"><b>${money(l.neto,2)}</b></td><td class="n">${money(l.patronal,2)}</td><td class="n">${money(l.ins,2)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td>Totales</td><td></td><td class="n">${money(t.base,2)}</td><td class="n">${money(t.extra,2)}</td><td class="n">${money(t.bonos,2)}</td><td class="n">${money(t.bruto,2)}</td><td class="n">−${money(t.obrero,2)}</td><td class="n">${money(t.rebajos,2)}</td><td class="n">${money(t.neto,2)}</td><td class="n">${money(t.patronal,2)}</td><td class="n">${money(t.ins,2)}</td></tr></tfoot></table></div>
    <div class="body"><div class="kpis">
      <div class="kpi"><div class="l">Neto a pagar a empleados</div><div class="v">${money(t.neto)}</div></div>
      <div class="kpi"><div class="l">Total a la CCSS</div><div class="v">${money(t.obrero+t.patronal)}</div><div class="s">Obrera ${money(t.obrero)} + patronal ${money(t.patronal)}</div></div>
      <div class="kpi"><div class="l">Costo total del período</div><div class="v">${money(t.costo)}</div><div class="s">Bruto + patronal + INS</div></div>
      <div class="kpi"><div class="l">Provisión aguinaldo y vacaciones</div><div class="v">${money(t.bruto*(c.aguinaldo+c.vacaciones)/100)}</div><div class="s">${c.aguinaldo}% + ${c.vacaciones}% del bruto, para reservar</div></div>
    </div></div>`:`<div class="empty"><b>No hay empleados activos con pago ${PAYFREQ[d.frecuencia].toLowerCase()}</b>Agregá empleados abajo o elegí otra frecuencia.</div>`}
    </section>`;
  }
  const [pd,ph]=periodoDefault("quincenal");
  return head("Pagos semanales, quincenales y mensuales","Planilla",`<button class="btn" data-act="nuevo-empleado">Nuevo empleado</button>`)+
  `<section class="panel"><header><h2>Calcular planilla</h2></header><div class="body"><form id="formPlan" class="row" style="align-items:end;gap:12px">
    <label class="f" style="min-width:150px">Frecuencia<select id="pl-frec">${Object.entries(PAYFREQ).map(([k,v])=>`<option value="${k}" ${k==="quincenal"?"selected":""}>${v}</option>`).join("")}</select></label>
    <label class="f">Desde<input id="pl-desde" type="date" value="${pd}" required></label>
    <label class="f">Hasta<input id="pl-hasta" type="date" value="${ph}" required></label>
    <button class="btn primary" type="submit">Calcular</button></form>
    <p class="hint" style="margin-top:10px">Las horas salen de los turnos registrados. Más de ${c.jornada} h en un día cuentan como extra al ${Math.round(c.recargoExtra*100)}%. Salario fijo: semanal = mensual × 12 ÷ 52; quincenal = mensual ÷ 2; valor hora = mensual ÷ ${c.divisorHora}.</p></div></section>`+
  draftHtml+
  `<section class="panel"><header><h2>Empleados</h2><span class="hint">${emps.filter(e=>e.activo!==false).length} activos</span></header>
  ${emps.length?`<div class="tbl-wrap"><table><thead><tr><th>Nombre</th><th>Puesto</th><th>Pago</th><th class="n">Salario / tarifa</th><th>Ingreso</th><th>Estado</th><th></th></tr></thead><tbody>
  ${emps.map(e=>`<tr><td><b>${esc(e.nombre)}</b>${exTag(e)}</td><td>${esc(e.puesto||"")}</td><td><span class="tag">${PAYFREQ[e.frecuencia]||"—"}</span></td><td class="n">${e.modo==="hora"?money(e.tarifaHora)+" / h":money(e.salario)+" / mes"}</td><td>${fdate(e.ingreso)}</td><td>${e.activo!==false?'<span class="pill ok">Activo</span>':'<span class="pill off">Inactivo</span>'}</td><td><button class="btn sm ghost" data-act="editar-empleado" data-id="${e.id}">Editar</button></td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty"><b>Sin empleados</b>Agregá empleados con su forma de pago (semanal, quincenal o mensual) y salario fijo o tarifa por hora.</div>`}</section>
  <section class="panel"><header><h2>Planillas guardadas</h2></header>
  ${hist.length?`<div class="tbl-wrap"><table><thead><tr><th>Período</th><th>Frecuencia</th><th>Fecha de pago</th><th class="n">Bruto</th><th class="n">Neto</th><th class="n">CCSS</th><th class="n">Costo total</th><th></th></tr></thead><tbody>
  ${hist.map(p=>`<tr><td>${fdateShort(p.desde)} – ${fdate(p.hasta)}${exTag(p)}</td><td><span class="tag">${PAYFREQ[p.frecuencia]}</span></td><td>${fdate(p.fechaPago)}</td><td class="n">${money(p.totales.bruto)}</td><td class="n">${money(p.totales.neto)}</td><td class="n">${money(p.totales.obrero+p.totales.patronal)}</td><td class="n">${money(p.totales.costo)}</td><td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="ver-planilla" data-id="${p.id}">Ver</button><button class="btn sm ghost" data-act="csv-planilla" data-id="${p.id}">CSV</button><button class="btn sm ghost danger" data-act="borrar-planilla" data-id="${p.id}">Eliminar</button></div></td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty">Las planillas que guardés quedan aquí y alimentan los informes y las cargas sociales por pagar.</div>`}</section>`;
};

VIEWS.turnos=()=>{
  const w=S.week,days=[...Array(7)].map((_,i)=>addDays(w,i)),t=today(),j=+cfg().jornada||8;
  const emps=S.empleados.filter(e=>e.activo!==false).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const turnos=S.turnos.filter(x=>x.fecha>=days[0]&&x.fecha<=days[6]);
  let totH=0,totE=0;
  const body=emps.map(e=>{
    const h=horasEmpleado(e.id,days[0],days[6]);totH+=h.total;totE+=h.ext;
    return `<tr><td class="emp"><b>${esc(e.nombre)}</b><span class="sub">${esc(e.puesto||"")}</span></td>${days.map(dd=>{
      const ts=turnos.filter(x=>x.empleadoId===e.id&&x.fecha===dd).sort((a,b)=>a.inicio.localeCompare(b.inicio));
      const dayH=ts.reduce((s,x)=>s+horasTurno(x),0);
      return `<td class="${dd===t?"today-col":""}">${ts.map(x=>`<button class="shift ${dayH>j?"ext":""}" data-act="editar-turno" data-id="${x.id}" title="${esc(x.nota||"")}">${esc(x.inicio)}–${esc(x.fin)}</button>`).join("")}<button class="addc" data-act="nuevo-turno" data-emp="${e.id}" data-fecha="${dd}" aria-label="Agregar turno a ${esc(e.nombre)} el ${fdate(dd)}">+ turno</button></td>`}).join("")}
      <td class="n">${hrs(h.total)}${h.ext?`<span class="sub" style="color:var(--warn)">${hrs(h.ext)} extra</span>`:""}</td></tr>`}).join("");
  return head("Control de turnos y horarios","Turnos",`<button class="btn" data-act="copiar-semana">Copiar semana anterior</button><button class="btn primary" data-act="nuevo-turno">Asignar turno</button>`)+
  `<div class="toolbar"><div class="monthnav"><button class="btn sm" data-act="semana" data-n="-7" aria-label="Semana anterior">‹</button><b>${fdateShort(days[0])} – ${fdate(days[6])}</b><button class="btn sm" data-act="semana" data-n="7" aria-label="Semana siguiente">›</button></div><button class="btn sm ghost" data-act="semana" data-n="0">Esta semana</button></div>
  <section class="panel">${emps.length?`<div class="tbl-wrap"><table class="week"><thead><tr><th class="emp">Empleado</th>${days.map((dd,i)=>`<th class="${dd===t?"today-col":""}">${DIAS[i]} ${parse(dd).getDate()}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>${body}</tbody>
  <tfoot><tr><td class="emp">Semana</td><td colspan="7"></td><td class="n">${hrs(totH)}${totE?`<span class="sub" style="color:var(--warn)">${hrs(totE)} extra</span>`:""}</td></tr></tfoot></table></div>`:`<div class="empty"><b>Sin empleados activos</b>Agregá empleados en la pestaña Planilla para asignarles turnos.</div>`}</section>
  <p class="note">Los turnos en tono ámbar superan la jornada ordinaria de ${j} h ese día; el excedente se paga como hora extra en la planilla. Un turno que termina antes de la hora de inicio se cuenta como turno nocturno que cruza la medianoche.</p>`;
};

VIEWS.gastos=()=>{
  const f=finanzasMes(S.month);
  const g=[...f.gastos].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const porCat={};g.forEach(x=>porCat[x.categoria]=(porCat[x.categoria]||0)+(+x.monto||0));
  const cats=Object.entries(porCat).sort((a,b)=>b[1]-a[1]);const max=cats[0]?cats[0][1]:1;
  return head("Gastos operativos","Gastos",`${monthNav()}<button class="btn primary" data-act="nuevo-gasto">Registrar gasto</button>`)+
  `<div class="grid2"><section class="panel"><header><h2>Por categoría</h2><span class="mono">${money(f.gastosTot)}</span></header><div class="body">
  ${cats.length?`<div class="bars">${cats.map(([k,v])=>`<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div></div><span class="mono" style="text-align:right">${money(v)}</span></div>`).join("")}</div>`:`<div class="empty" style="padding:12px">Sin gastos en ${monthLabel(S.month).toLowerCase()}.</div>`}
  </div></section>
  <section class="panel"><header><h2>Planilla del mes</h2><span class="mono">${money(f.pt.costo)}</span></header><div class="body"><div class="bars">
    <div class="bar"><span>Salarios brutos</span><div class="track"><div class="fill" style="width:${f.pt.costo?f.pt.bruto/f.pt.costo*100:0}%;background:var(--bar-in)"></div></div><span class="mono" style="text-align:right">${money(f.pt.bruto)}</span></div>
    <div class="bar"><span>Cargas patronales</span><div class="track"><div class="fill" style="width:${f.pt.costo?f.pt.patronal/f.pt.costo*100:0}%;background:var(--bar-in)"></div></div><span class="mono" style="text-align:right">${money(f.pt.patronal)}</span></div>
    <div class="bar"><span>INS</span><div class="track"><div class="fill" style="width:${f.pt.costo?f.pt.ins/f.pt.costo*100:0}%;background:var(--bar-in)"></div></div><span class="mono" style="text-align:right">${money(f.pt.ins)}</span></div>
  </div><p class="note" style="margin-top:14px">La planilla se suma sola desde las planillas guardadas. No la registrés también como gasto para no contarla doble.</p></div></section></div>
  <section class="panel"><header><h2>Movimientos de ${monthLabel(S.month).toLowerCase()}</h2></header>
  ${g.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Método</th><th class="n">Monto</th><th></th></tr></thead><tbody>
  ${g.map(x=>`<tr><td>${fdate(x.fecha)}</td><td>${esc(x.descripcion)}${exTag(x)}${x.proveedor?`<span class="sub">${esc(x.proveedor)}</span>`:""}</td><td><span class="tag">${esc(x.categoria)}</span></td><td>${esc(x.metodo||"")}</td><td class="n">${money(x.monto)}</td><td><div class="row" style="flex-wrap:nowrap"><button class="btn sm ghost" data-act="editar-gasto" data-id="${x.id}">Editar</button></div></td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty"><b>Sin gastos este mes</b>Registrá alquiler, servicios, insumos, combustible y demás con “Registrar gasto”.</div>`}</section>`;
};

VIEWS.informes=()=>{
  const f=finanzasMes(S.month);
  const porFrec={};f.cobros.forEach(p=>{const c=byId("clientes",p.clienteId);const k=c?FREQ[c.frecuencia]?.label||"Otros":"Otros";porFrec[k]=(porFrec[k]||0)+(+p.monto||0)});
  const porCat={};f.gastos.forEach(x=>porCat[x.categoria]=(porCat[x.categoria]||0)+(+x.monto||0));
  const meses=[...Array(6)].map((_,i)=>shiftMonth(S.month,i-5)).map(m=>({m,...finanzasMes(m)}));
  const margen=f.ingresos?f.resultado/f.ingresos*100:0;
  return head("Estado de resultados y tendencia","Informes",`${monthNav()}<button class="btn" data-act="csv-mes">Exportar CSV del mes</button>`)+
  `<div class="kpis">
    <div class="kpi"><div class="l">Ingresos</div><div class="v">${money(f.ingresos)}</div></div>
    <div class="kpi"><div class="l">Egresos</div><div class="v">${money(f.egresos)}</div></div>
    <div class="kpi ${f.resultado<0?"neg":"pos"}"><div class="l">Resultado</div><div class="v">${money(f.resultado)}</div></div>
    <div class="kpi"><div class="l">Margen</div><div class="v">${f.ingresos?margen.toFixed(1).replace(".",",")+"%":"—"}</div><div class="s">Resultado ÷ ingresos</div></div>
  </div>
  <section class="panel"><header><h2>Últimos 6 meses</h2><div class="legend"><span><i style="background:var(--bar-in)"></i>Ingresos</span><span><i style="background:var(--bar-out)"></i>Egresos</span></div></header><div class="body chart">${chart(meses)}</div></section>
  <section class="panel"><header><h2>Estado de resultados · ${monthLabel(S.month)}</h2></header><div class="tbl-wrap"><table class="pl"><tbody>
    <tr class="grp"><td colspan="2">Ingresos por servicios</td></tr>
    ${Object.entries(porFrec).map(([k,v])=>`<tr><td>Clientes con cobro ${k.toLowerCase()}</td><td class="n">${money(v)}</td></tr>`).join("")||`<tr><td class="hint">Sin cobros registrados</td><td class="n">${money(0)}</td></tr>`}
    <tr><td><b>Total ingresos</b></td><td class="n"><b>${money(f.ingresos)}</b></td></tr>
    <tr class="grp"><td colspan="2">Planilla</td></tr>
    <tr><td>Salarios brutos</td><td class="n">${money(f.pt.bruto)}</td></tr>
    <tr><td>Cargas sociales patronales (${cfg().patronal}%)</td><td class="n">${money(f.pt.patronal)}</td></tr>
    <tr><td>Póliza INS riesgos del trabajo</td><td class="n">${money(f.pt.ins)}</td></tr>
    <tr class="grp"><td colspan="2">Gastos operativos</td></tr>
    ${Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${money(v)}</td></tr>`).join("")||`<tr><td class="hint">Sin gastos registrados</td><td class="n">${money(0)}</td></tr>`}
    <tr><td><b>Total egresos</b></td><td class="n"><b>${money(f.egresos)}</b></td></tr>
    <tr class="res"><td>Resultado del mes</td><td class="n" style="color:${f.resultado<0?"var(--bad)":"var(--ok)"}">${money(f.resultado)}</td></tr>
  </tbody></table></div></section>
  <p class="note">Base de efectivo: los ingresos son los pagos recibidos en el mes y la planilla se cuenta en su fecha de pago. La provisión de aguinaldo (${cfg().aguinaldo}%) y vacaciones (${cfg().vacaciones}%) se muestra en cada planilla pero no se resta aquí.</p>`;
};
function chart(meses){
  const W=720,H=240,L=58,R=10,T=12,B=28;
  const max=Math.max(1,...meses.flatMap(m=>[m.ingresos,m.egresos]));
  const step=Math.pow(10,Math.floor(Math.log10(max)));const nice=[1,2,2.5,5,10].map(x=>x*step).find(x=>x*4>=max)||step*10;
  const top=nice*4,y=v=>T+(H-T-B)*(1-v/top);
  const gw=(W-L-R)/meses.length,bw=Math.min(26,gw/3.2);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y egresos de los últimos seis meses">`;
  for(let i=0;i<=4;i++){const v=nice*i,yy=y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"/><text x="${L-8}" y="${yy+4}" text-anchor="end">₡${NFC.format(v)}</text>`}
  meses.forEach((m,i)=>{const cx=L+gw*i+gw/2;
    s+=`<rect x="${cx-bw-2}" y="${y(m.ingresos)}" width="${bw}" height="${Math.max(0,y(0)-y(m.ingresos))}" rx="3" fill="var(--bar-in)"><title>Ingresos ${monthLabel(m.m)}: ${money(m.ingresos)}</title></rect>`;
    s+=`<rect x="${cx+2}" y="${y(m.egresos)}" width="${bw}" height="${Math.max(0,y(0)-y(m.egresos))}" rx="3" fill="var(--bar-out)"><title>Egresos ${monthLabel(m.m)}: ${money(m.egresos)}</title></rect>`;
    s+=`<text x="${cx}" y="${H-8}" text-anchor="middle" style="${m.m===S.month?"fill:var(--ink);font-weight:600":""}">${MESES[+m.m.slice(5)-1].slice(0,3)}</text>`});
  return s+"</svg>";
}

VIEWS.ajustes=()=>{
  const c=cfg();const nEj=COLS.reduce((s,k)=>s+S[k].filter(x=>x.ejemplo).length,0);
  return head("Parámetros del sistema","Ajustes","")+
  `<section class="panel"><header><h2>Empresa y cargas sociales</h2></header><div class="body"><form id="formCfg" class="fgrid">
    <label class="f full">Nombre de la empresa<input id="cfg-empresa" value="${esc(c.empresa)}" required></label>
    <label class="f">Cuota obrera CCSS (%)<input id="cfg-obrero" type="number" step="0.01" value="${c.obrero}"></label>
    <label class="f">Cuota patronal CCSS + LPT (%)<input id="cfg-patronal" type="number" step="0.01" value="${c.patronal}"></label>
    <label class="f">Póliza INS riesgos del trabajo (%)<input id="cfg-ins" type="number" step="0.01" value="${c.ins}"><span class="hint">La tarifa depende de la actividad; tomala de la póliza.</span></label>
    <label class="f">Jornada ordinaria diaria (h)<input id="cfg-jornada" type="number" step="0.5" value="${c.jornada}"></label>
    <label class="f">Divisor para valor hora (salario mensual ÷)<input id="cfg-divisorHora" type="number" step="1" value="${c.divisorHora}"></label>
    <label class="f">Recargo hora extra (×)<input id="cfg-recargoExtra" type="number" step="0.05" value="${c.recargoExtra}"></label>
    <label class="f">Provisión aguinaldo (%)<input id="cfg-aguinaldo" type="number" step="0.01" value="${c.aguinaldo}"></label>
    <label class="f">Provisión vacaciones (%)<input id="cfg-vacaciones" type="number" step="0.01" value="${c.vacaciones}"></label>
    <div class="full row" style="justify-content:flex-end"><button class="btn" type="button" data-act="cfg-default">Restablecer tasas 2026</button><button class="btn primary" type="submit">Guardar ajustes</button></div>
  </form>
  <p class="note" style="margin-top:14px">Tasas vigentes desde el 1 de enero de 2026: obrera 10,83% (SEM 5,50%, IVM 4,33%, Banco Popular 1%) y patronal 26,83% (incluye SEM 9,25%, IVM 5,58%, Banco Popular, FODESAF, IMAS, INA y aportes de la Ley de Protección al Trabajador). El sistema no calcula el impuesto sobre la renta de salarios.</p></div></section>
  <section class="panel"><header><h2>Respaldo de datos</h2></header><div class="body" style="display:flex;flex-direction:column;gap:12px">
    ${S.modo==="local"?`<div class="banner">Los datos se guardan solo en este navegador y esta computadora. Si se borra el historial del navegador o se cambia de equipo, se pierden. Descargá un respaldo con frecuencia.</div>`:""}
    <p class="hint">El respaldo es un archivo .json con todos los clientes, pagos, empleados, planillas, turnos, gastos y ajustes. Sirve también para pasar los datos a otra computadora.</p>
    <div class="row"><button class="btn primary" data-act="exportar">Descargar respaldo</button><button class="btn" data-act="importar">Importar respaldo</button></div>
  </div></section>
  <section class="panel"><header><h2>Datos de ejemplo</h2></header><div class="body" style="display:flex;flex-direction:column;gap:12px">
    <p class="hint">Cargá unos clientes, empleados, turnos, pagos y gastos de muestra para ver el sistema funcionando. Quedan marcados con la etiqueta EJEMPLO y se borran todos juntos.</p>
    <div class="row"><button class="btn" data-act="cargar-ejemplo">Cargar datos de ejemplo</button><button class="btn danger" data-act="borrar-ejemplo" ${nEj?"":"disabled"}>Borrar datos de ejemplo (${nEj})</button></div>
  </div></section>`;
};

/* ---------- diálogos ---------- */
const dlg=$("#dlg");
function fieldHtml(f){
  const id="f_"+f.id,cls=f.full?"f full":"f",v=f.value??"";
  let ctl;
  if(f.type==="select")ctl=`<select id="${id}" name="${f.id}" ${f.required?"required":""}>${f.options.map(o=>{const[val,lab]=Array.isArray(o)?o:[o,o];return `<option value="${esc(val)}" ${String(val)===String(v)?"selected":""}>${esc(lab)}</option>`}).join("")}</select>`;
  else if(f.type==="textarea")ctl=`<textarea id="${id}" name="${f.id}" rows="2">${esc(v)}</textarea>`;
  else ctl=`<input id="${id}" name="${f.id}" type="${f.type||"text"}" value="${esc(v)}" ${f.required?"required":""} ${f.step?`step="${f.step}"`:""} ${f.min!=null?`min="${f.min}"`:""} ${f.placeholder?`placeholder="${esc(f.placeholder)}"`:""}>`;
  return `<label class="${cls}">${esc(f.label)}${ctl}${f.hint?`<span class="hint">${esc(f.hint)}</span>`:""}</label>`;
}
function openForm({title,fields,submit="Guardar",onSubmit,danger,intro}){
  dlg.className="";
  dlg.innerHTML=`<form id="dlgForm"><h3>${esc(title)}</h3>${intro||""}<div class="fgrid">${fields.map(fieldHtml).join("")}</div><div class="dlg-actions">${danger?`<button type="button" class="btn danger" id="dlgDanger" style="margin-right:auto">${esc(danger.label)}</button>`:""}<button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">${esc(submit)}</button></div></form>`;
  const form=$("#dlgForm");
  form.querySelector("[data-close]").onclick=()=>dlg.close();
  if(danger)$("#dlgDanger").onclick=()=>confirmBox(danger.confirm,danger.label,danger.run);
  form.onsubmit=async e=>{e.preventDefault();const vals={};fields.forEach(f=>{let v=form.elements[f.id].value;if(f.type==="number")v=v===""?0:+v;vals[f.id]=v});
    const btn=form.querySelector('[type="submit"]');btn.disabled=true;const ok=await onSubmit(vals);btn.disabled=false;if(ok!==false)dlg.close()};
  if(fields.onChange)fields.onChange(form);
  dlg.showModal();
  return form;
}
function confirmBox(msg,label,run){
  dlg.className="";
  dlg.innerHTML=`<div class="dbody"><h3>${esc(label)}</h3><p>${esc(msg)}</p><div class="dlg-actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="cfYes" style="background:var(--bad);border-color:var(--bad)">${esc(label)}</button></div></div>`;
  dlg.querySelector("[data-close]").onclick=()=>dlg.close();
  $("#cfYes").onclick=async()=>{$("#cfYes").disabled=true;await run();dlg.close()};
  if(!dlg.open)dlg.showModal();
}
function openInfo(title,html,wide){
  dlg.className=wide?"wide":"";
  dlg.innerHTML=`<div class="dbody"><h3>${esc(title)}</h3>${html}<div class="dlg-actions"><button class="btn" data-close>Cerrar</button></div></div>`;
  dlg.querySelector("[data-close]").onclick=()=>dlg.close();
  dlg.showModal();
}
let toastT;
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3200)}

/* ---------- formularios ---------- */
function formCliente(c){
  c=c||{};
  openForm({title:c.id?"Editar cliente":"Nuevo cliente",fields:[
    {id:"nombre",label:"Nombre del cliente",value:c.nombre,required:true,full:true},
    {id:"servicio",label:"Servicio",value:c.servicio,placeholder:"Ej. limpieza de oficinas"},
    {id:"telefono",label:"Teléfono",value:c.telefono,placeholder:"8888-8888"},
    {id:"frecuencia",label:"Frecuencia de cobro",type:"select",options:Object.entries(FREQ).map(([k,v])=>[k,v.label]),value:c.frecuencia||"mensual"},
    {id:"monto",label:"Cuota por período (₡)",type:"number",step:"0.01",min:0,value:c.monto??"",required:true},
    {id:"inicio",label:"Primer cobro",type:"date",value:c.inicio||today(),required:true},
    {id:"activo",label:"Estado",type:"select",options:[["1","Activo"],["0","Inactivo (deja de generar cobros)"]],value:c.activo===false?"0":"1"},
    {id:"notas",label:"Notas",type:"textarea",value:c.notas,full:true}],
    danger:c.id?{label:"Eliminar cliente",confirm:`Se eliminará ${c.nombre}. Sus pagos registrados se conservan en los informes.`,run:()=>remove("clientes",c.id).then(ok=>ok&&toast("Cliente eliminado"))}:null,
    onSubmit:async v=>{const activo=v.activo==="1";const data={...c,...v,activo,baja:activo?null:(c.baja||today())};delete data.id;data.creado=c.creado||new Date().toISOString();
      const ok=await save("clientes",c.id,data);if(ok)toast(c.id?"Cliente actualizado":"Cliente agregado");return ok}});
}
function formPago(clienteId){
  const act=S.clientes.filter(c=>c.activo!==false||c.id===clienteId).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  if(!act.length){toast("Primero agregá un cliente.");return}
  const sel=clienteId||act[0].id;const e=estadoCliente(byId("clientes",sel));
  const form=openForm({title:"Registrar pago",fields:[
    {id:"clienteId",label:"Cliente",type:"select",options:act.map(c=>[c.id,c.nombre]),value:sel,full:true},
    {id:"monto",label:"Monto recibido (₡)",type:"number",step:"0.01",min:0,value:e.saldo>0.5?e.saldo:byId("clientes",sel).monto,required:true},
    {id:"fecha",label:"Fecha",type:"date",value:today(),required:true},
    {id:"metodo",label:"Método",type:"select",options:METODOS,value:"SINPE Móvil"},
    {id:"referencia",label:"Referencia o comprobante",placeholder:"N.º de SINPE o recibo"}],
    intro:`<p class="hint" id="pagoInfo"></p>`,
    onSubmit:async v=>{const ok=await save("cobros",null,{...v,creado:new Date().toISOString()});if(ok)toast("Pago registrado");return ok}});
  const info=()=>{const c=byId("clientes",form.elements.clienteId.value);const x=estadoCliente(c);$("#pagoInfo").textContent=`Cuota ${FREQ[c.frecuencia]?.label.toLowerCase()} de ${money(c.monto)} · saldo pendiente ${money(Math.max(0,x.saldo))}`;return x};
  info();form.elements.clienteId.onchange=()=>{const x=info();const c=byId("clientes",form.elements.clienteId.value);form.elements.monto.value=x.saldo>0.5?x.saldo:c.monto};
}
function formEmpleado(e){
  e=e||{};
  const form=openForm({title:e.id?"Editar empleado":"Nuevo empleado",fields:[
    {id:"nombre",label:"Nombre completo",value:e.nombre,required:true,full:true},
    {id:"puesto",label:"Puesto",value:e.puesto},
    {id:"ingreso",label:"Fecha de ingreso",type:"date",value:e.ingreso||today()},
    {id:"frecuencia",label:"Se le paga",type:"select",options:Object.entries(PAYFREQ),value:e.frecuencia||"quincenal"},
    {id:"modo",label:"Forma de salario",type:"select",options:[["fijo","Salario mensual fijo"],["hora","Por hora trabajada"]],value:e.modo||"fijo"},
    {id:"salario",label:"Salario mensual (₡)",type:"number",step:"0.01",min:0,value:e.salario??""},
    {id:"tarifaHora",label:"Tarifa por hora (₡)",type:"number",step:"0.01",min:0,value:e.tarifaHora??""},
    {id:"activo",label:"Estado",type:"select",options:[["1","Activo"],["0","Inactivo"]],value:e.activo===false?"0":"1"}],
    danger:e.id?{label:"Eliminar empleado",confirm:`Se eliminará a ${e.nombre}. Sus planillas guardadas se conservan.`,run:()=>remove("empleados",e.id).then(ok=>ok&&toast("Empleado eliminado"))}:null,
    onSubmit:async v=>{const data={...e,...v,activo:v.activo==="1"};delete data.id;const ok=await save("empleados",e.id,data);if(ok)toast(e.id?"Empleado actualizado":"Empleado agregado");return ok}});
  const sync=()=>{const h=form.elements.modo.value==="hora";form.elements.salario.closest("label").hidden=h;form.elements.tarifaHora.closest("label").hidden=!h};
  sync();form.elements.modo.onchange=sync;
}
function formTurno(t,empId,fecha){
  t=t||{};const emps=S.empleados.filter(e=>e.activo!==false||e.id===t.empleadoId).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  if(!emps.length){toast("Primero agregá empleados en Planilla.");return}
  openForm({title:t.id?"Editar turno":"Asignar turno",fields:[
    {id:"empleadoId",label:"Empleado",type:"select",options:emps.map(e=>[e.id,e.nombre]),value:t.empleadoId||empId||emps[0].id,full:true},
    {id:"fecha",label:"Fecha",type:"date",value:t.fecha||fecha||today(),required:true},
    {id:"descanso",label:"Descanso sin pago (min)",type:"number",min:0,step:"5",value:t.descanso??0},
    {id:"inicio",label:"Entrada",type:"time",value:t.inicio||"08:00",required:true},
    {id:"fin",label:"Salida",type:"time",value:t.fin||"16:00",required:true},
    {id:"nota",label:"Lugar o nota",value:t.nota,full:true,placeholder:"Ej. cliente o sede"}],
    danger:t.id?{label:"Eliminar turno",confirm:"Se eliminará este turno.",run:()=>remove("turnos",t.id).then(ok=>ok&&toast("Turno eliminado"))}:null,
    onSubmit:async v=>{const data={...t,...v};delete data.id;const ok=await save("turnos",t.id,data);if(ok)toast(t.id?"Turno actualizado":`Turno asignado · ${hrs(horasTurno(data))}`);return ok}});
}
function formGasto(g){
  g=g||{};
  openForm({title:g.id?"Editar gasto":"Registrar gasto",fields:[
    {id:"descripcion",label:"Descripción",value:g.descripcion,required:true,full:true},
    {id:"categoria",label:"Categoría",type:"select",options:CATS,value:g.categoria||"Insumos y materiales"},
    {id:"monto",label:"Monto (₡)",type:"number",step:"0.01",min:0,value:g.monto??"",required:true},
    {id:"fecha",label:"Fecha",type:"date",value:g.fecha||today(),required:true},
    {id:"metodo",label:"Método de pago",type:"select",options:METODOS,value:g.metodo||"Transferencia"},
    {id:"proveedor",label:"Proveedor",value:g.proveedor,full:true}],
    danger:g.id?{label:"Eliminar gasto",confirm:"Se eliminará este gasto.",run:()=>remove("gastos",g.id).then(ok=>ok&&toast("Gasto eliminado"))}:null,
    onSubmit:async v=>{const data={...g,...v};delete data.id;const ok=await save("gastos",g.id,data);if(ok)toast(g.id?"Gasto actualizado":"Gasto registrado");return ok}});
}
function verHistorial(id){
  const c=byId("clientes",id),e=estadoCliente(c);
  const pagos=S.cobros.filter(p=>p.clienteId===id).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  openInfo(c.nombre,`<p class="hint">${esc(c.servicio||"")} · ${FREQ[c.frecuencia]?.label} de ${money(c.monto)} desde ${fdate(c.inicio)}</p>
  <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="kpi"><div class="l">Debió pagar</div><div class="v" style="font-size:18px">${money(e.esperado)}</div></div><div class="kpi"><div class="l">Pagó</div><div class="v" style="font-size:18px">${money(e.pagado)}</div></div><div class="kpi ${e.saldo>0.5?"neg":""}"><div class="l">Saldo</div><div class="v" style="font-size:18px">${money(e.saldo)}</div></div></div>
  ${pagos.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th class="n">Monto</th></tr></thead><tbody>${pagos.map(p=>`<tr><td>${fdate(p.fecha)}</td><td>${esc(p.metodo||"")}</td><td>${esc(p.referencia||"")}</td><td class="n">${money(p.monto)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">Sin pagos registrados.</div>`}`);
}
function verPlanilla(id){
  const p=byId("planillas",id),t=p.totales;
  openInfo(`Planilla ${PAYFREQ[p.frecuencia].toLowerCase()} · ${fdate(p.desde)} al ${fdate(p.hasta)}`,`<p class="hint">Pagada el ${fdate(p.fechaPago)} · tasas aplicadas: obrera ${p.tasas?.obrero}%, patronal ${p.tasas?.patronal}%, INS ${p.tasas?.ins}%</p>
  <div class="tbl-wrap"><table><thead><tr><th>Empleado</th><th class="n">Horas</th><th class="n">Bruto</th><th class="n">CCSS obrera</th><th class="n">Rebajos</th><th class="n">Neto</th><th class="n">Patronal</th><th class="n">INS</th></tr></thead><tbody>
  ${p.lineas.map(l=>`<tr><td><b>${esc(l.nombre)}</b><span class="sub">Base ${money(l.base,2)} · extra ${money(l.extra,2)} · bonos ${money(l.bonos,2)}</span></td><td class="n">${hrs(l.horas)}</td><td class="n">${money(l.bruto,2)}</td><td class="n">${money(l.obrero,2)}</td><td class="n">${money(l.rebajos,2)}</td><td class="n"><b>${money(l.neto,2)}</b></td><td class="n">${money(l.patronal,2)}</td><td class="n">${money(l.ins,2)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td>Totales</td><td></td><td class="n">${money(t.bruto,2)}</td><td class="n">${money(t.obrero,2)}</td><td class="n">${money(t.rebajos,2)}</td><td class="n">${money(t.neto,2)}</td><td class="n">${money(t.patronal,2)}</td><td class="n">${money(t.ins,2)}</td></tr></tfoot></table></div>`,true);
}

/* ---------- exportar ---------- */
const csvCell=v=>{const s=String(v??"");return /[",;\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
const toCsv=rows=>"﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n");
async function descargar(nombre,rows){
  if(!downloads){toast("Las descargas no están disponibles en esta vista.");return}
  try{await downloads.save({filename:nombre,data:toCsv(rows)})}catch(e){if(e&&e.code!=="declined")toast("No se pudo preparar la descarga.")}
}
function csvPlanilla(id){
  const p=byId("planillas",id);
  const rows=[["Empleado","Puesto","Horas","Horas extra","Salario base","Monto extra","Bonos","Bruto","CCSS obrera","Rebajos","Neto","Patronal","INS"]];
  p.lineas.forEach(l=>rows.push([l.nombre,l.puesto,l.horas,l.horasExtra,l.base,l.extra,l.bonos,l.bruto,l.obrero,l.rebajos,l.neto,l.patronal,l.ins]));
  const t=p.totales;rows.push(["TOTAL","","","",t.base,t.extra,t.bonos,t.bruto,t.obrero,t.rebajos,t.neto,t.patronal,t.ins]);
  descargar(`planilla-${p.frecuencia}-${p.desde}.csv`,rows);
}
function csvMes(){
  const f=finanzasMes(S.month);const rows=[["Fecha","Tipo","Concepto","Categoría","Método","Monto"]];
  f.cobros.forEach(p=>{const c=byId("clientes",p.clienteId);rows.push([p.fecha,"Ingreso",c?c.nombre:"Cliente eliminado",c?FREQ[c.frecuencia]?.label:"",p.metodo,+p.monto])});
  f.gastos.forEach(g=>rows.push([g.fecha,"Gasto",g.descripcion,g.categoria,g.metodo,-g.monto]));
  f.plan.forEach(p=>rows.push([p.fechaPago,"Planilla",`Planilla ${PAYFREQ[p.frecuencia]} ${p.desde} a ${p.hasta}`,"Planilla","",-(p.totales.bruto+p.totales.patronal+p.totales.ins)]));
  rows.sort((a,b)=>a===rows[0]?-1:b===rows[0]?1:String(a[0]).localeCompare(String(b[0])));
  descargar(`movimientos-${S.month}.csv`,rows);
}

/* ---------- datos de ejemplo ---------- */
async function cargarEjemplo(){
  if(!db){toast("La base de datos no está disponible.");return}
  toast("Cargando ejemplos…");
  const t=today(),m=mondayOf(t),ex={ejemplo:true};
  const cl=[
    {id:"ej-c1",nombre:"Condominio Las Brisas",servicio:"Limpieza de áreas comunes",telefono:"8810-2233",frecuencia:"mensual",monto:350000,inicio:addMonths(t,-3)},
    {id:"ej-c2",nombre:"Soda Doña Mari",servicio:"Recolección de residuos",telefono:"8721-4455",frecuencia:"semanal",monto:18000,inicio:addDays(t,-49)},
    {id:"ej-c3",nombre:"Ferretería El Tornillo",servicio:"Seguridad nocturna",telefono:"2552-9087",frecuencia:"quincenal",monto:145000,inicio:addDays(t,-75)},
    {id:"ej-c4",nombre:"Feria del Agricultor Oreamuno",servicio:"Parqueo y vigilancia",telefono:"8600-1122",frecuencia:"diario",monto:6000,inicio:addDays(t,-12)}];
  const em=[
    {id:"ej-e1",nombre:"Carlos Mora Solano",puesto:"Oficial de seguridad",frecuencia:"quincenal",modo:"fijo",salario:385000,ingreso:addMonths(t,-14)},
    {id:"ej-e2",nombre:"Ana Lucía Brenes",puesto:"Conserje",frecuencia:"semanal",modo:"hora",tarifaHora:1850,ingreso:addMonths(t,-6)},
    {id:"ej-e3",nombre:"Marco Quirós Vega",puesto:"Supervisor",frecuencia:"mensual",modo:"fijo",salario:620000,ingreso:addMonths(t,-30)}];
  const docs=[];
  cl.forEach(c=>docs.push(["clientes",c.id,{...c,...ex,activo:true,creado:new Date().toISOString()}]));
  em.forEach(e=>docs.push(["empleados",e.id,{...e,...ex,activo:true}]));
  const pagos=[["ej-c1",350000,-60],["ej-c1",350000,-30],["ej-c2",18000,-42],["ej-c2",18000,-35],["ej-c2",18000,-28],["ej-c2",18000,-21],["ej-c2",18000,-14],["ej-c3",145000,-75],["ej-c3",145000,-60],["ej-c3",145000,-45],["ej-c3",145000,-30],["ej-c4",36000,-6]];
  pagos.forEach(([c,mo,d],i)=>docs.push(["cobros","ej-p"+i,{...ex,clienteId:c,monto:mo,fecha:addDays(t,d),metodo:i%3?"SINPE Móvil":"Transferencia",referencia:"",creado:new Date().toISOString()}]));
  const gastos=[["Alquiler de bodega","Alquiler",225000,-18],["Recibo de luz ICE","Servicios públicos",38500,-12],["Productos de limpieza","Insumos y materiales",64200,-9],["Diésel pick-up","Combustible y transporte",41000,-5],["Patente municipal","Impuestos y patentes",27500,-40],["Diésel pick-up","Combustible y transporte",39000,-33]];
  gastos.forEach(([d,c,mo,dd],i)=>docs.push(["gastos","ej-g"+i,{...ex,descripcion:d,categoria:c,monto:mo,fecha:addDays(t,dd),metodo:"Transferencia",proveedor:""}]));
  const pat=[["ej-e1","18:00","06:00",[0,1,2,3,4]],["ej-e2","07:00","15:30",[0,1,2,3,4,5]],["ej-e3","08:00","17:00",[0,1,2,3,4]]];
  pat.forEach(([e,a,b,ds])=>ds.forEach(d=>{const desc=e==="ej-e2"?30:e==="ej-e3"?60:0;docs.push(["turnos",`ej-t-${e}-${d}`,{...ex,empleadoId:e,fecha:addDays(m,d),inicio:a,fin:b,descanso:desc,nota:""}])}));
  try{for(const[c,id,data]of docs)await db.collection(c).doc(id).set(data);toast("Datos de ejemplo cargados")}catch(e){handleErr(e)}
}
async function borrarEjemplo(){
  try{for(const c of COLS)for(const x of S[c].filter(x=>x.ejemplo))await db.collection(c).doc(x.id).delete();toast("Datos de ejemplo eliminados")}catch(e){handleErr(e)}
}

/* ---------- eventos ---------- */
document.addEventListener("click",async ev=>{
  const tb=ev.target.closest("[data-tab]");
  if(tb){S.tab=tb.dataset.tab;try{localStorage.setItem("ca_tab",S.tab)}catch(e){}render();window.scrollTo(0,0);return}
  const b=ev.target.closest("[data-act]");if(!b||b.tagName==="INPUT")return;
  const a=b.dataset.act,id=b.dataset.id;
  switch(a){
    case"mes":S.month=shiftMonth(S.month,+b.dataset.n);render();break;
    case"semana":S.week=+b.dataset.n?addDays(S.week,+b.dataset.n):mondayOf(today());render();break;
    case"frec":S.filtroFrec=b.dataset.k;render();break;
    case"nuevo-cliente":formCliente();break;
    case"editar-cliente":formCliente(byId("clientes",id));break;
    case"nuevo-pago":formPago();break;
    case"pago":formPago(id);break;
    case"historial":verHistorial(id);break;
    case"borrar-pago":confirmBox("Se eliminará este pago y el saldo del cliente volverá a calcularse.","Anular pago",()=>remove("cobros",id).then(ok=>ok&&toast("Pago anulado")));break;
    case"nuevo-empleado":formEmpleado();break;
    case"editar-empleado":formEmpleado(byId("empleados",id));break;
    case"nuevo-turno":formTurno(null,b.dataset.emp,b.dataset.fecha);break;
    case"editar-turno":formTurno(byId("turnos",id));break;
    case"copiar-semana":{
      const prev=addDays(S.week,-7),src=S.turnos.filter(x=>x.fecha>=prev&&x.fecha<=addDays(prev,6));
      if(!src.length){toast("La semana anterior no tiene turnos.");break}
      const ya=S.turnos.filter(x=>x.fecha>=S.week&&x.fecha<=addDays(S.week,6)).length;
      confirmBox(`Se copiarán ${src.length} turnos a la semana del ${fdate(S.week)}.${ya?` Esta semana ya tiene ${ya}; se agregarán sin borrar los existentes.`:""}`,"Copiar turnos",async()=>{
        for(const x of src){const d={...x,fecha:addDays(x.fecha,7)};delete d.id;delete d.ejemplo;if(!await save("turnos",null,d))return}toast("Turnos copiados")});break}
    case"nuevo-gasto":formGasto();break;
    case"editar-gasto":formGasto(byId("gastos",id));break;
    case"cancelar-planilla":S.draft=null;render();break;
    case"guardar-planilla":{
      const d=S.draft;const c=cfg();
      openForm({title:"Guardar planilla",submit:"Guardar",fields:[{id:"fechaPago",label:"Fecha de pago",type:"date",value:d.hasta,required:true,full:true}],
        intro:`<p class="hint">Se guardará con las tasas actuales y contará como egreso en el mes de la fecha de pago.</p>`,
        onSubmit:async v=>{const ok=await save("planillas",null,{frecuencia:d.frecuencia,desde:d.desde,hasta:d.hasta,fechaPago:v.fechaPago,lineas:d.lineas,totales:totales(d.lineas),tasas:{obrero:c.obrero,patronal:c.patronal,ins:c.ins},creado:new Date().toISOString()});
          if(ok){S.draft=null;toast("Planilla guardada");render()}return ok}});break}
    case"ver-planilla":verPlanilla(id);break;
    case"csv-planilla":csvPlanilla(id);break;
    case"borrar-planilla":confirmBox("Se eliminará esta planilla de los registros e informes.","Eliminar planilla",()=>remove("planillas",id).then(ok=>ok&&toast("Planilla eliminada")));break;
    case"csv-mes":csvMes();break;
    case"exportar":exportarRespaldo();break;
    case"importar":$("#importFile").click();break;
    case"cfg-default":{const keep=cfg().empresa;await save("config","general",{...DEFAULT_CFG,empresa:keep})&&toast("Tasas 2026 restablecidas");break}
    case"cargar-ejemplo":cargarEjemplo();break;
    case"borrar-ejemplo":confirmBox("Se eliminarán todos los registros marcados como EJEMPLO.","Borrar ejemplos",borrarEjemplo);break;
  }
});
document.addEventListener("change",ev=>{
  const el=ev.target;
  if(el.dataset&&el.dataset.act==="linea"&&S.draft){const i=+el.dataset.i;S.draft.lineas[i]=calcLinea({...S.draft.lineas[i],[el.dataset.k]:+el.value||0});render()}
});
document.addEventListener("input",ev=>{if(ev.target.id==="buscar"){S.buscar=ev.target.value;render()}});
document.addEventListener("submit",async ev=>{
  const f=ev.target;
  if(f.id==="formPlan"){ev.preventDefault();const fr=$("#pl-frec").value,a=$("#pl-desde").value,b=$("#pl-hasta").value;
    if(b<a){toast("La fecha final debe ser posterior a la inicial.");return}
    S.draft={frecuencia:fr,desde:a,hasta:b,lineas:calcPlanilla(fr,a,b)};render()}
  if(f.id==="formCfg"){ev.preventDefault();const data={...cfg()};Object.keys(DEFAULT_CFG).forEach(k=>{const el=document.getElementById("cfg-"+k);if(el)data[k]=k==="empresa"?el.value.trim():(+el.value||0)});
    if(await save("config","general",data))toast("Ajustes guardados")}
});
document.addEventListener("change",ev=>{
  if(ev.target.id==="pl-frec"){const[a,b]=periodoDefault(ev.target.value);$("#pl-desde").value=a;$("#pl-hasta").value=b}
});

/* ---------- almacenamiento local (GitHub Pages / cualquier hosting) ----------
   Imita la API mínima que usa la app: collection(c).onSnapshot / doc(id).set / delete
   y doc("col/id").onSnapshot. Para cambiar a Firebase después, basta con
   reemplazar este adaptador por firebase.firestore() (API compatible v8). */
function localDB(){
  const KEY="ca_db_v1";
  let store={};
  try{store=JSON.parse(localStorage.getItem(KEY))||{}}catch(e){store={}}
  const subs=new Set();
  const notify=()=>subs.forEach(f=>f());
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(store))}catch(e){throw {code:"quota_exceeded",message:String(e)}}};
  window.addEventListener("storage",e=>{if(e.key===KEY){try{store=JSON.parse(e.newValue)||{}}catch(_){store={}}notify()}});
  const snap=(id,d)=>({id,exists:d!==undefined,data:()=>d});
  const listen=f=>{subs.add(f);setTimeout(f,0);return()=>subs.delete(f)};
  function docRef(c,id){return{
    id,
    async set(d){store[c]=store[c]||{};store[c][id]=JSON.parse(JSON.stringify(d));persist();notify()},
    async delete(){if(store[c]&&id in store[c]){delete store[c][id];persist();notify()}},
    onSnapshot(next){return listen(()=>next(snap(id,store[c]?.[id])))}
  }}
  return{
    local:true,
    collection(c){return{doc:id=>docRef(c,id||uid()),onSnapshot(next){return listen(()=>next({docs:Object.entries(store[c]||{}).map(([id,d])=>snap(id,d))}))}}},
    doc(p){const[c,id]=p.split("/");return docRef(c,id)}
  };
}
const browserDownloads={save:async({filename,data})=>{
  const blob=data instanceof Blob?data:new Blob([data],{type:filename.endsWith(".json")?"application/json":"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);return{status:"saved"};
}};

/* ---------- respaldo ---------- */
async function exportarRespaldo(){
  const out={app:"control-administrativo",version:1,exportado:new Date().toISOString(),config:{general:S.cfg}};
  COLS.forEach(c=>{out[c]={};S[c].forEach(x=>{const d={...x};delete d.id;out[c][x.id]=d})});
  const dl=downloads||browserDownloads;
  try{await dl.save({filename:`respaldo-${today()}.json`,data:JSON.stringify(out,null,2)});toast("Respaldo listo")}
  catch(e){if(e&&e.code!=="declined")toast("No se pudo preparar el respaldo.")}
}
async function importarRespaldo(file){
  let data;try{data=JSON.parse(await file.text())}catch(e){toast("El archivo no es un respaldo válido.");return}
  if(!data||data.app!=="control-administrativo"){toast("El archivo no es un respaldo de este sistema.");return}
  const n=COLS.reduce((s,c)=>s+Object.keys(data[c]||{}).length,0);
  confirmBox(`Se importarán ${n} registros. Los que tengan el mismo identificador se reemplazan; el resto de los datos actuales se conserva.`,"Importar respaldo",async()=>{
    try{
      for(const c of COLS)for(const[id,d]of Object.entries(data[c]||{}))await db.collection(c).doc(id).set(d);
      if(data.config&&data.config.general)await db.doc("config/general").set({...DEFAULT_CFG,...data.config.general});
      toast(`Respaldo importado · ${n} registros`);
    }catch(e){handleErr(e)}
  });
}
document.addEventListener("change",ev=>{if(ev.target.id==="importFile"&&ev.target.files[0]){importarRespaldo(ev.target.files[0]);ev.target.value=""}});

/* ---------- arranque ---------- */
render();
(async()=>{
  const enMarco=window.self!==window.top;
  for(let i=0;enMarco&&i<20&&!window.claude;i++)await new Promise(r=>setTimeout(r,100));
  try{db=window.claude?await window.claude.use("db"):null}catch(e){db=null}
  try{downloads=window.claude?await window.claude.use("downloads"):null}catch(e){downloads=null}
  if(!db){db=localDB();downloads=browserDownloads;S.modo="local"}else S.modo="nube";
  const onErr=e=>{console.error(e);if(e&&e.code==="revoked"){S.dbState="sin-db";render()}};
  COLS.forEach(c=>db.collection(c).onSnapshot(snap=>{S[c]=snap.docs.map(d=>({...d.data(),id:d.id}));S.loaded.add(c);if(S.loaded.size>=COLS.length)S.dbState="lista";render()},onErr));
  db.doc("config/general").onSnapshot(s=>{S.cfg={...DEFAULT_CFG,...(s.exists?s.data():{})};render()},onErr);
})();
})();
