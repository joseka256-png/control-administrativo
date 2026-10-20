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
const INV_CATS=["Comunicación","Uniforme","Equipo de defensa","Iluminación","Protección","Vehículo","Otros"];
const DEFAULT_CFG={empresa:"Mi empresa",obrero:10.83,patronal:26.83,ins:0,jornada:8,divisorHora:240,recargoExtra:1.5,aguinaldo:8.33,vacaciones:4.17,fondoCaja:100000,intervalo:30,tolerancia:5};

/* ---------- estado ---------- */
const COLS=["clientes","cobros","empleados","planillas","turnos","gastos","caja","articulos","asignaciones","bitacora"];
const S={clientes:[],cobros:[],empleados:[],planillas:[],turnos:[],gastos:[],caja:[],articulos:[],asignaciones:[],bitacora:[],cfg:{...DEFAULT_CFG},
  loaded:new Set(),tab:"resumen",month:monthOf(today()),week:mondayOf(today()),filtroFrec:"todos",buscar:"",draft:null,dbState:"cargando",bitDia:today(),bitEmp:"todos",alertas:false};
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
  else estado=pagados>n?"adelantado":"aldia";
  const cubiertoHasta=pagados>0?addDays(dueDate(c,pagados),-1):null;
  const adelantoPeriodos=Math.max(0,pagados-n);
  if(activo&&monto>0)proximo=dueDate(c,Math.max(pagados,n));
  const periodos=monto>0&&saldo>0?Math.ceil(saldo/monto-0.0001):0;
  const ultimo=pagos.map(p=>p.fecha).sort().pop()||null;
  return {activo,esperado,pagado,saldo,estado,proximo,vencido,periodos,ultimo,cubiertoHasta,adelantoPeriodos,n,pagados};
}
const ESTADO_PILL={adelantado:'<span class="pill info">Adelantado</span>',aldia:'<span class="pill ok">Al día</span>',pendiente:'<span class="pill warn">Pendiente</span>',atrasado:'<span class="pill bad">Atrasado</span>'};

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
  const cajaG=S.caja.filter(x=>x.tipo==="gasto"&&x.fecha>=a&&x.fecha<=b).map(x=>({...x,metodo:"Caja chica",proveedor:x.responsable?"Responsable: "+x.responsable:"",_caja:true}));
  const gastos=[...S.gastos.filter(g=>g.fecha>=a&&g.fecha<=b),...cajaG];
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
  monitoreo:'<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm1-13h-2v6l5 3 1-1.7-4-2.3z"/>',
  inventario:'<path d="M3 7l9-5 9 5v10l-9 5-9-5zm2 1.2v7.6l6 3.3v-7.6zm14 0l-6 3.3v7.6l6-3.3zM12 4.3 6.2 7.5 12 10.7l5.8-3.2z"/>',
  caja:'<path d="M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v10h16V8zm1-4h14v1H5zm10 6h4v6h-4a3 3 0 0 1 0-6zm0 2a1 1 0 1 0 1 1 1 1 0 0 0-1-1z"/>',
  ajustes:'<path d="M12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4zm9 5.4v-2.8l-2.3-.5a7 7 0 0 0-.7-1.7l1.3-2-2-2-2 1.3a7 7 0 0 0-1.7-.7L13.4 3h-2.8l-.5 2.3a7 7 0 0 0-1.7.7l-2-1.3-2 2 1.3 2a7 7 0 0 0-.7 1.7L3 10.6v2.8l2.3.5a7 7 0 0 0 .7 1.7l-1.3 2 2 2 2-1.3a7 7 0 0 0 1.7.7l.5 2.3h2.8l.5-2.3a7 7 0 0 0 1.7-.7l2 1.3 2-2-1.3-2a7 7 0 0 0 .7-1.7z"/>'
};
const TABS=[["resumen","Resumen"],["monitoreo","Monitoreo"],["clientes","Clientes y cobros"],["planilla","Planilla"],["turnos","Turnos"],["inventario","Inventario"],["caja","Caja chica"],["gastos","Gastos"],["informes","Informes"],["ajustes","Ajustes"]];

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
  (sinDatos&&S.dbState==="lista"?`<div class="panel"><div class="empty"><b>Todavía no hay registros</b>Empezá agregando clientes en “Clientes y cobros”, empleados en “Planilla” y gastos en “Gastos”. Si querés ver cómo funciona, cargá datos de ejemplo desde “Ajustes”.</div></div>`:"")+resumenMonitoreo()+
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
      ${turnosHoy.length?`<div class="list">${turnosHoy.map(x=>{const e=byId("empleados",x.empleadoId);return `<div class="li"><div class="t"><b>${esc(e?e.nombre:"Empleado eliminado")}</b><span>${esc(puestoTurno(x))}</span></div><span class="mono">${esc(x.inicio)}–${esc(x.fin)}</span></div>`}).join("")}</div>`:`<div class="empty"><b>Sin turnos hoy</b>Asigná turnos desde la pestaña Turnos.</div>`}
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
  const ord={atrasado:0,pendiente:1,aldia:2,adelantado:3};
  rows.sort((a,b)=>(a.e.activo===b.e.activo?0:a.e.activo?-1:1)||ord[a.e.estado]-ord[b.e.estado]||a.c.nombre.localeCompare(b.c.nombre));
  const tot=rows.reduce((s,x)=>s+Math.max(0,x.e.saldo),0);
  const recientes=[...S.cobros].sort((a,b)=>(b.fecha+b.creado).localeCompare(a.fecha+a.creado)).slice(0,25);
  const chips=[["todos","Todos"],...Object.entries(FREQ).map(([k,v])=>[k,v.label])];
  return head("Servicios diarios, semanales, quincenales y mensuales","Clientes y cobros",`<button class="btn" data-act="nuevo-cliente">Nuevo cliente</button><button class="btn primary" data-act="nuevo-pago">Registrar pago</button>`)+
  `<section class="panel"><header><div class="chips" role="group" aria-label="Filtrar por frecuencia">${chips.map(([k,l])=>`<button class="chip" data-act="frec" data-k="${k}" aria-pressed="${S.filtroFrec===k}">${l}</button>`).join("")}</div>
    <div style="min-width:200px;flex:1;max-width:280px"><input id="buscar" type="search" placeholder="Buscar cliente o servicio" value="${esc(S.buscar)}" aria-label="Buscar cliente"></div></header>
  ${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Frecuencia</th><th class="n">Cuota</th><th class="n">Pagado</th><th class="n">Saldo</th><th>Pagado hasta</th><th>Próximo cobro</th><th>Estado</th><th></th></tr></thead><tbody>
  ${rows.map(({c,e})=>`<tr><td><b>${esc(c.nombre)}</b>${exTag(c)}<span class="sub">${esc(c.servicio||"")}${c.telefono?" · "+esc(c.telefono):""}</span></td>
    <td><span class="tag">${FREQ[c.frecuencia]?.label||"—"}</span></td>
    <td class="n">${money(c.monto)}</td><td class="n">${money(e.pagado)}</td>
    <td class="n" style="color:${e.saldo>0.5?"var(--bad)":e.saldo<-0.5?"var(--ok)":"inherit"}">${e.saldo<-0.5?"a favor "+money(-e.saldo):money(Math.max(0,e.saldo))}</td>
    <td>${e.cubiertoHasta?fdate(e.cubiertoHasta)+(e.adelantoPeriodos?`<span class="sub">${e.adelantoPeriodos} período${e.adelantoPeriodos===1?"":"s"} adelantado${e.adelantoPeriodos===1?"":"s"}</span>`:""):"—"}</td>
    <td>${e.saldo>0.5?`<span style="color:var(--bad)">Vencido ${fdateShort(e.vencido)}</span>`:e.proximo?fdate(e.proximo):"—"}</td>
    <td>${e.activo?ESTADO_PILL[e.estado]:'<span class="pill off">Inactivo</span>'}</td>
    <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="pago" data-id="${c.id}">Pago</button><button class="btn sm ghost" data-act="historial" data-id="${c.id}">Historial</button><button class="btn sm ghost" data-act="editar-cliente" data-id="${c.id}">Editar</button></div></td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="4">Total por cobrar (${rows.length} clientes)</td><td class="n">${money(tot)}</td><td colspan="4"></td></tr></tfoot></table></div>`
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
      return `<td class="${dd===t?"today-col":""}">${ts.map(x=>`<button class="shift ${dayH>j?"ext":""}" data-act="editar-turno" data-id="${x.id}" title="${esc(puestoTurno(x))}">${esc(x.inicio)}–${esc(x.fin)}</button>`).join("")}<button class="addc" data-act="nuevo-turno" data-emp="${e.id}" data-fecha="${dd}" aria-label="Agregar turno a ${esc(e.nombre)} el ${fdate(dd)}">+ turno</button></td>`}).join("")}
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
  ${g.map(x=>`<tr><td>${fdate(x.fecha)}</td><td>${esc(x.descripcion)}${exTag(x)}${x.proveedor?`<span class="sub">${esc(x.proveedor)}</span>`:""}</td><td><span class="tag">${esc(x.categoria)}</span></td><td>${esc(x.metodo||"")}</td><td class="n">${money(x.monto)}</td><td><div class="row" style="flex-wrap:nowrap"><button class="btn sm ghost" data-act="${x._caja?"editar-caja":"editar-gasto"}" data-id="${x.id}">Editar</button></div></td></tr>`).join("")}
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
    <label class="f">Fondo fijo de caja chica (₡)<input id="cfg-fondoCaja" type="number" step="1000" value="${c.fondoCaja}"></label>
    <label class="f">Intervalo de reporte de oficiales (min)<input id="cfg-intervalo" type="number" step="5" min="5" value="${c.intervalo}"></label>
    <label class="f">Tolerancia antes de alertar (min)<input id="cfg-tolerancia" type="number" step="1" min="0" value="${c.tolerancia}"></label>
    <div class="full row" style="justify-content:flex-end"><button class="btn" type="button" data-act="cfg-default">Restablecer tasas 2026</button><button class="btn primary" type="submit">Guardar ajustes</button></div>
  </form>
  <p class="note" style="margin-top:14px">Tasas vigentes desde el 1 de enero de 2026: obrera 10,83% (SEM 5,50%, IVM 4,33%, Banco Popular 1%) y patronal 26,83% (incluye SEM 9,25%, IVM 5,58%, Banco Popular, FODESAF, IMAS, INA y aportes de la Ley de Protección al Trabajador). El sistema no calcula el impuesto sobre la renta de salarios.</p></div></section>
  <section class="panel"><header><h2>Respaldo de datos</h2></header><div class="body" style="display:flex;flex-direction:column;gap:12px">
    ${S.modo==="local"?`<div class="banner">Los datos se guardan solo en este navegador y esta computadora. Si se borra el historial del navegador o se cambia de equipo, se pierden. Descargá un respaldo con frecuencia.</div>`:""}
    <p class="hint">El respaldo es un archivo .json con todos los clientes, pagos, empleados, planillas, turnos, gastos y ajustes. Sirve también para pasar los datos a otra computadora.</p>
    <div class="row"><button class="btn primary" data-act="exportar">Descargar respaldo</button><button class="btn" data-act="importar">Importar respaldo</button></div>
    <p class="hint">La bitácora de monitoreo crece todos los días. Descargá un respaldo y después depurá los registros viejos para liberar espacio.</p>
    <div class="row"><button class="btn danger" data-act="depurar-bitacora">Depurar bitácora de más de 90 días</button></div>
  </div></section>
  <section class="panel"><header><h2>Datos de ejemplo</h2></header><div class="body" style="display:flex;flex-direction:column;gap:12px">
    <p class="hint">Cargá unos clientes, empleados, turnos, pagos y gastos de muestra para ver el sistema funcionando. Quedan marcados con la etiqueta EJEMPLO y se borran todos juntos.</p>
    <div class="row"><button class="btn" data-act="cargar-ejemplo">Cargar datos de ejemplo</button><button class="btn danger" data-act="borrar-ejemplo" ${nEj?"":"disabled"}>Borrar datos de ejemplo (${nEj})</button></div>
  </div></section>`;
};

/* ---------- monitoreo: lógica ---------- */
const TIPO_REP={"sin-novedad":["Sin novedad","ok"],"novedad":["Novedad","warn"],"no-responde":["No responde","bad"],"mensaje":["Mensaje","info"]};
const hhmm=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nombreEmp=id=>byId("empleados",id)?.nombre||"Empleado eliminado";
const reporta=t=>{const e=byId("empleados",t.empleadoId);return !e||e.reporta!==false};
function puestoTurno(t){const c=t&&t.clienteId&&byId("clientes",t.clienteId);return c?c.nombre:(t&&t.nota)||"Sin puesto asignado"}
const telWa=tel=>{let d=String(tel||"").replace(/\D/g,"");if(d.length===8)d="506"+d;return d};
function rangoTurno(t){
  const[h1,m1]=String(t.inicio||"0:0").split(":").map(Number),[h2,m2]=String(t.fin||"0:0").split(":").map(Number);
  const s=parse(t.fecha);s.setHours(h1,m1||0,0,0);
  const e=parse(t.fecha);e.setHours(h2,m2||0,0,0);
  if(e<=s)e.setDate(e.getDate()+1);
  return[s,e];
}
function estadoOficial(t,now){
  const c=cfg(),I=+c.intervalo||30,T=+c.tolerancia||0;
  const[s,e]=rangoTurno(t);
  const ev=((byId("bitacora",t.id)?.eventos)||[]).filter(x=>new Date(x.t)<=now);
  const reps=ev.filter(x=>x.tipo==="sin-novedad"||x.tipo==="novedad");
  const last=reps.length?new Date(reps[reps.length-1].t):s;
  const vence=new Date(last.getTime()+I*60000);
  const restante=(vence-now)/60000;
  const sinResp=ev.filter(x=>x.tipo==="no-responde"&&new Date(x.t)>last).length;
  const estado=restante>5?"ok":restante>=-T?"warn":"bad";
  return{t,s,e,last,vence,restante,estado,sinResp,haReportado:reps.length>0};
}
function oficialesEnTurno(now=new Date()){
  return S.turnos.filter(t=>{if(!reporta(t))return false;const[s,e]=rangoTurno(t);return now>=s&&now<e}).map(t=>estadoOficial(t,now));
}
async function registrarEvento(turnoId,tipo,nota,cuando){
  const t=byId("turnos",turnoId);if(!t){toast("Ese turno ya no existe.");return false}
  const now=cuando||new Date();const prev=byId("bitacora",turnoId);
  const ev={t:now.toISOString(),tipo};if(nota)ev.nota=nota;
  if(tipo==="sin-novedad"||tipo==="novedad"){const st=estadoOficial(t,now);const atraso=Math.round(-st.restante);if(atraso>(+cfg().tolerancia||0))ev.retraso=atraso}
  const data={turnoId,empleadoId:t.empleadoId,clienteId:t.clienteId||"",puesto:puestoTurno(t),fecha:t.fecha,eventos:[...(prev?.eventos||[]),ev].sort((a,b)=>a.t.localeCompare(b.t))};
  if(t.ejemplo)data.ejemplo=true;
  const ok=await save("bitacora",turnoId,data);
  if(ok)toast(`${TIPO_REP[tipo][0]} · ${nombreEmp(t.empleadoId)} · ${hhmm(now)}`);
  return ok;
}
function evsDelDia(dia,emp){
  const out=[];
  S.bitacora.forEach(b=>(b.eventos||[]).forEach(ev=>{if(iso(new Date(ev.t))===dia&&(emp==="todos"||b.empleadoId===emp))out.push({...ev,b})}));
  return out.sort((a,b)=>b.t.localeCompare(a.t));
}
function analisisTurno(t,hasta){
  const I=+cfg().intervalo||30,T=+cfg().tolerancia||0;
  const[s,e]=rangoTurno(t);const fin=new Date(Math.min(e,hasta||Date.now()));
  if(fin<=s)return null;
  const ev=((byId("bitacora",t.id)?.eventos)||[]).filter(x=>new Date(x.t)>=s&&new Date(x.t)<=fin);
  const reps=ev.filter(x=>x.tipo==="sin-novedad"||x.tipo==="novedad").map(x=>new Date(x.t)).sort((a,b)=>a-b);
  let prev=s,faltantes=0,maxGap=0;
  [...reps,fin].forEach((d,i,arr)=>{const g=(d-prev)/60000;maxGap=Math.max(maxGap,g);const k=Math.floor((g-T)/I);faltantes+=i===arr.length-1?Math.max(0,k):Math.max(0,k-1);prev=d});
  return{t,s,e,enCurso:e>new Date(),reportes:reps.length,faltantes,maxGap:Math.round(maxGap),
    tardios:ev.filter(x=>x.retraso).length,novedades:ev.filter(x=>x.tipo==="novedad").length,sinResp:ev.filter(x=>x.tipo==="no-responde").length,mensajes:ev.filter(x=>x.tipo==="mensaje").length};
}
function turnosDelDia(dia){
  const a=parse(dia);a.setHours(0,0,0,0);const b=new Date(a);b.setDate(b.getDate()+1);const now=new Date();
  return S.turnos.filter(t=>{if(!reporta(t))return false;const[s,e]=rangoTurno(t);return s<b&&e>a&&s<now}).sort((x,y)=>rangoTurno(x)[0]-rangoTurno(y)[0]);
}
function formRegistroManual(){
  const ts=turnosDelDia(S.bitDia);
  if(!ts.length){toast(`No hay turnos el ${fdate(S.bitDia)}.`);return}
  openForm({title:"Agregar registro de la hoja",submit:"Agregar",fields:[
    {id:"turnoId",label:"Oficial y turno",type:"select",options:ts.map(t=>[t.id,`${nombreEmp(t.empleadoId)} · ${puestoTurno(t)} · ${t.inicio}–${t.fin}`]),full:true},
    {id:"hora",label:"Hora",type:"time",required:true,value:""},
    {id:"tipo",label:"Registro",type:"select",options:Object.entries(TIPO_REP).map(([k,v])=>[k,v[0]]),value:"sin-novedad"},
    {id:"nota",label:"Detalle",type:"textarea",full:true}],
    intro:`<p class="hint">Para pasar al sistema lo anotado en la hoja de monitoreo del ${fdate(S.bitDia)}. En turnos nocturnos, una hora después de medianoche se toma del día siguiente.</p>`,
    onSubmit:async v=>{
      const t=byId("turnos",v.turnoId);const[s,e]=rangoTurno(t);const[h,m]=v.hora.split(":").map(Number);
      let d=new Date(s);d.setHours(h,m,0,0);if(d<s)d.setDate(d.getDate()+1);
      if(d>e){toast(`La hora debe estar dentro del turno (${t.inicio}–${t.fin}).`);return false}
      if(d>new Date()){toast("No se pueden registrar horas futuras.");return false}
      if(v.tipo==="novedad"&&!String(v.nota).trim()){toast("Describí la novedad.");return false}
      return registrarEvento(v.turnoId,v.tipo,String(v.nota||"").trim(),d)}});
}

let audioCtx=null;const alertados=new Set();
function beep(){
  if(!audioCtx)return;
  try{const t0=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type="sine";o.frequency.value=880;
    g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(0.3,t0+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t0+0.6);
    o.connect(g);g.connect(audioCtx.destination);o.start(t0);o.stop(t0+0.65)}catch(e){}
}
function tick(){
  const bad=oficialesEnTurno().filter(x=>x.estado==="bad");
  let nuevo=false;bad.forEach(x=>{const k=x.t.id+"|"+x.last.getTime();if(!alertados.has(k)){alertados.add(k);nuevo=true}});
  if(nuevo&&S.alertas){beep();setTimeout(beep,700)}
  document.title=(bad.length?`(${bad.length}) `:"")+"Control Administrativo";
  if((S.tab==="monitoreo"||S.tab==="resumen")&&!dlg.open){const a=document.activeElement;if(!a||!/INPUT|SELECT|TEXTAREA/.test(a.tagName))render()}
}
function resumenMonitoreo(){
  const act=oficialesEnTurno();if(!act.length)return"";
  const atr=act.filter(x=>x.estado==="bad");
  return `<section class="panel ${atr.length?"alerta":""}"><div class="li" style="border:none"><div class="t"><b>${act.length} oficial${act.length===1?"":"es"} en turno ahora</b><span>${atr.length?`Sin reportar: ${atr.map(x=>esc(nombreEmp(x.t.empleadoId))).join(", ")}`:"Todos se han reportado a tiempo"}</span></div><button class="btn sm ${atr.length?"primary":""}" data-tab="monitoreo">Abrir monitoreo</button></div></section>`;
}

/* ---------- monitoreo: vista ---------- */
function cardOficial(x){
  const e=byId("empleados",x.t.empleadoId)||{};
  const desde=Math.round((Date.now()-x.last)/60000);
  const txt=x.estado==="bad"?`Sin reportarse hace ${desde} min`:x.estado==="warn"?(x.restante>0?`Le toca reportarse en ${Math.ceil(x.restante)} min`:`Reporte vencido hace ${Math.ceil(-x.restante)} min`):`Próximo reporte a las ${hhmm(x.vence)}`;
  const pill={bad:'<span class="pill bad">Sin respuesta</span>',warn:'<span class="pill warn">Debe reportarse</span>',ok:'<span class="pill ok">Al día</span>'}[x.estado];
  return `<article class="ofi ${x.estado}">
    <header><div><b>${esc(e.nombre||"Empleado eliminado")}${exTag(x.t)}</b><span>${esc(puestoTurno(x.t))}</span></div>${pill}</header>
    <div class="ofi-time"><span class="big mono">${x.haReportado?hhmm(x.last):"—"}</span><span>${x.haReportado?"último reporte":"aún no se reporta · entró "+hhmm(x.s)}</span></div>
    <p class="ofi-st">${txt}${x.sinResp?` · ${x.sinResp} intento${x.sinResp===1?"":"s"} sin respuesta`:""}</p>
    <p class="hint">Turno ${esc(x.t.inicio)}–${esc(x.t.fin)}${e.telefono?` · <span class="mono">${esc(e.telefono)}</span>`:" · sin teléfono"}</p>
    <div class="row"><button class="btn primary sm" data-act="rep-ok" data-id="${x.t.id}">Sin novedad</button><button class="btn sm" data-act="rep-nov" data-id="${x.t.id}">Novedad</button><button class="btn sm" data-act="rep-no" data-id="${x.t.id}">No responde</button><button class="btn sm" data-act="rep-msg" data-id="${x.t.id}">Mensaje</button></div>
  </article>`;
}
VIEWS.monitoreo=()=>{
  const now=new Date(),c=cfg(),rank={bad:0,warn:1,ok:2};
  const act=oficialesEnTurno(now).sort((a,b)=>rank[a.estado]-rank[b.estado]||a.restante-b.restante);
  const nBad=act.filter(x=>x.estado==="bad").length,nWarn=act.filter(x=>x.estado==="warn").length;
  const prox=S.turnos.filter(reporta).map(t=>({t,r:rangoTurno(t)})).filter(x=>x.r[0]>now&&x.r[0]-now<6*3600e3).sort((a,b)=>a.r[0]-b.r[0]);
  const evs=evsDelDia(S.bitDia,S.bitEmp);
  const hoy=evsDelDia(today(),"todos");
  const tarde=hoy.filter(x=>x.retraso).length;
  const empsBit=[...new Set(S.bitacora.map(b=>b.empleadoId))].map(id=>[id,nombreEmp(id)]).sort((a,b)=>a[1].localeCompare(b[1]));
  return head(`Reportes cada ${c.intervalo} min · alerta después de ${c.tolerancia} min de tolerancia`,"Monitoreo",`<button class="btn ${S.alertas?"":"primary"}" data-act="alertas" aria-pressed="${S.alertas}">${S.alertas?"Sonido activado":"Activar alerta sonora"}</button>`)+
  `<div class="kpis">
    <div class="kpi"><div class="l">En turno ahora</div><div class="v">${act.length}</div><div class="s">Actualizado ${hhmm(now)}</div></div>
    <div class="kpi ${nBad?"neg":""}"><div class="l">Sin reportarse</div><div class="v">${nBad}</div><div class="s">Pasaron el intervalo y la tolerancia</div></div>
    <div class="kpi"><div class="l">Por reportarse</div><div class="v">${nWarn}</div><div class="s">Les toca en los próximos 5 min</div></div>
    <div class="kpi"><div class="l">Reportes de hoy</div><div class="v">${hoy.filter(x=>x.tipo==="sin-novedad"||x.tipo==="novedad").length}</div><div class="s">${tarde} tardío${tarde===1?"":"s"} · ${hoy.filter(x=>x.tipo==="novedad").length} con novedad</div></div>
  </div>
  ${act.length?`<div class="board">${act.map(cardOficial).join("")}</div>`:`<section class="panel"><div class="empty"><b>No hay oficiales en turno en este momento</b>El tablero se llena solo con los turnos asignados en la pestaña Turnos que estén en curso.</div></section>`}
  <div class="grid2">
  <section class="panel"><header><h2>Próximos turnos · 6 horas</h2></header>
    ${prox.length?`<div class="list">${prox.map(({t,r})=>`<div class="li"><div class="t"><b>${esc(nombreEmp(t.empleadoId))}</b><span>${esc(puestoTurno(t))}</span></div><span class="mono">${hhmm(r[0])}–${hhmm(r[1])}</span></div>`).join("")}</div>`:`<div class="empty">No hay turnos que empiecen en las próximas 6 horas.</div>`}
  </section>
  <section class="panel"><header><h2>Cómo funciona</h2></header><div class="body"><p class="note" style="margin:0">Cuando el oficial se reporta por radio o teléfono, marcá <b>Sin novedad</b> o <b>Novedad</b> y el contador vuelve a ${c.intervalo} minutos. Si no contesta, marcá <b>No responde</b> para dejar constancia del intento y usá <b>Mensaje</b> para escribirle por WhatsApp. Con la alerta sonora activada, la página suena cada vez que un oficial pasa a rojo; dejala abierta en la computadora de monitoreo.</p></div></section>
  </div>
  ${revisionDia()}
  <section class="panel"><header><h2>Bitácora</h2><div class="row">
    <input id="bit-dia" type="date" value="${S.bitDia}" aria-label="Día" style="width:auto">
    <select id="bit-emp" aria-label="Oficial" style="width:auto"><option value="todos">Todos los oficiales</option>${empsBit.map(([id,n])=>`<option value="${id}" ${S.bitEmp===id?"selected":""}>${esc(n)}</option>`).join("")}</select>
    <button class="btn sm ghost" data-act="bit-ayer">Ayer</button><button class="btn sm" data-act="bit-manual">Agregar registro</button><button class="btn sm" data-act="csv-bitacora" ${evs.length?"":"disabled"}>CSV</button></div></header>
  ${evs.length?`<div class="tbl-wrap"><table><thead><tr><th>Hora</th><th>Oficial</th><th>Puesto</th><th>Registro</th><th>Detalle</th></tr></thead><tbody>
  ${evs.map(x=>{const[l,k]=TIPO_REP[x.tipo]||[x.tipo,"off"];return `<tr><td class="mono">${hhmm(new Date(x.t))}</td><td>${esc(nombreEmp(x.b.empleadoId))}</td><td>${esc(x.b.puesto||"")}</td><td><span class="pill ${k}">${l}</span></td><td>${esc(x.nota||"")}${x.retraso?`<span class="sub" style="color:var(--warn)">Tarde: ${x.retraso} min después de lo esperado</span>`:""}</td></tr>`}).join("")}
  </tbody></table></div>`:`<div class="empty">Sin registros para ${fdate(S.bitDia)}.</div>`}</section>`;
};
function revisionDia(){
  const filas=turnosDelDia(S.bitDia).map(t=>analisisTurno(t)).filter(Boolean).filter(x=>S.bitEmp==="todos"||x.t.empleadoId===S.bitEmp);
  const tot=filas.reduce((a,x)=>(a.f+=x.faltantes,a.r+=x.reportes,a.n+=x.novedades,a),{f:0,r:0,n:0});
  return `<section class="panel"><header><h2>Revisión del ${fdate(S.bitDia)}</h2><span class="hint">${filas.length} turno${filas.length===1?"":"s"} · ${tot.r} reportes · ${tot.f} faltante${tot.f===1?"":"s"} · ${tot.n} novedad${tot.n===1?"":"es"}</span></header>
  ${filas.length?`<div class="tbl-wrap"><table><thead><tr><th>Oficial</th><th>Puesto</th><th>Turno</th><th class="n">Reportes</th><th class="n">Faltantes</th><th class="n">Tardíos</th><th class="n">Sin respuesta</th><th class="n">Mayor espacio</th><th>Resultado</th></tr></thead><tbody>
  ${filas.map(x=>`<tr><td><b>${esc(nombreEmp(x.t.empleadoId))}</b></td><td>${esc(puestoTurno(x.t))}</td><td class="mono" style="white-space:nowrap">${esc(x.t.inicio)}–${esc(x.t.fin)}</td><td class="n">${x.reportes}</td><td class="n" style="color:${x.faltantes?"var(--bad)":"inherit"}">${x.faltantes}</td><td class="n">${x.tardios}</td><td class="n">${x.sinResp}</td><td class="n">${x.maxGap} min</td><td>${x.faltantes?'<span class="pill bad">Con faltantes</span>':x.tardios?'<span class="pill warn">Con atrasos</span>':'<span class="pill ok">Cumplió</span>'}${x.enCurso?' <span class="tag">En curso</span>':""}</td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty">No hubo turnos el ${fdate(S.bitDia)}.</div>`}</section>`;
}
function formMensaje(turnoId){
  const t=byId("turnos",turnoId);if(!t)return;
  const e=byId("empleados",t.empleadoId)||{};
  const plant=["Favor reportarse de inmediato.","Solicitamos reporte de situación de su puesto.","Supervisor se dirige a su puesto.","Recuerde realizar la ronda del puesto.","Confirme que recibió este mensaje."];
  const nom=(e.nombre||"").split(" ")[0];
  const base=p=>`Oficial ${nom}: ${p} — Monitoreo ${cfg().empresa}`;
  dlg.className="";
  dlg.innerHTML=`<div class="dbody"><h3>Mensaje a ${esc(e.nombre||"oficial")}</h3>
    <p class="hint">${esc(puestoTurno(t))} · turno ${esc(t.inicio)}–${esc(t.fin)} · ${e.telefono?`tel. <span class="mono">${esc(e.telefono)}</span>`:"sin teléfono registrado: agregalo en Planilla → Editar empleado"}</p>
    <div class="chips">${plant.map((p,i)=>`<button type="button" class="chip" data-pl="${i}">${esc(p)}</button>`).join("")}</div>
    <label class="f">Mensaje<textarea id="msgTxt" rows="4"></textarea></label>
    <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button type="button" class="btn" id="msgCopy">Copiar y registrar</button>${e.telefono?`<a class="btn primary" id="msgWa" target="_blank" rel="noopener">Enviar por WhatsApp</a>`:""}</div></div>`;
  const txt=$("#msgTxt"),wa=$("#msgWa");
  const upd=()=>{if(wa)wa.href=`https://wa.me/${telWa(e.telefono)}?text=${encodeURIComponent(txt.value)}`};
  txt.value=base(plant[0]);upd();txt.oninput=upd;
  dlg.querySelectorAll("[data-pl]").forEach(b=>b.onclick=()=>{txt.value=base(plant[+b.dataset.pl]);upd()});
  dlg.querySelector("[data-close]").onclick=()=>dlg.close();
  $("#msgCopy").onclick=async()=>{try{await navigator.clipboard.writeText(txt.value);toast("Mensaje copiado")}catch(_){txt.select()}registrarEvento(turnoId,"mensaje",txt.value);dlg.close()};
  if(wa)wa.onclick=()=>{registrarEvento(turnoId,"mensaje",txt.value);setTimeout(()=>dlg.close(),150)};
  dlg.showModal();
}
function csvBitacora(){
  const rows=[["Fecha","Hora","Oficial","Puesto","Registro","Detalle","Minutos tarde"]];
  evsDelDia(S.bitDia,S.bitEmp).reverse().forEach(x=>{const d=new Date(x.t);rows.push([iso(d),hhmm(d),nombreEmp(x.b.empleadoId),x.b.puesto||"",(TIPO_REP[x.tipo]||[x.tipo])[0],x.nota||"",x.retraso||""])});
  descargar(`bitacora-${S.bitDia}.csv`,rows);
}

/* ---------- inventario ---------- */
function invStock(a){
  const asig=S.asignaciones.filter(x=>x.articuloId===a.id&&x.estado==="activa").reduce((s,x)=>s+(+x.cantidad||0),0);
  const total=+a.total||0;return{total,asignados:asig,disponibles:total-asig};
}
VIEWS.inventario=()=>{
  const arts=[...S.articulos].sort((a,b)=>(a.categoria||"").localeCompare(b.categoria||"")||a.nombre.localeCompare(b.nombre));
  let unidades=0,asig=0,valor=0;arts.forEach(a=>{const st=invStock(a);unidades+=st.total;asig+=st.asignados;valor+=st.total*(+a.costo||0)});
  const porEmp={};S.asignaciones.filter(x=>x.estado==="activa").forEach(x=>(porEmp[x.empleadoId]=porEmp[x.empleadoId]||[]).push(x));
  const grupos=Object.keys(porEmp).map(id=>({id,e:byId("empleados",id),items:porEmp[id]}))
    .sort((a,b)=>((a.e&&a.e.activo!==false)?1:0)-((b.e&&b.e.activo!==false)?1:0)||(a.e?.nombre||"").localeCompare(b.e?.nombre||""));
  const pendientes=grupos.filter(g=>!g.e||g.e.activo===false).length;
  const hist=S.asignaciones.filter(x=>x.estado==="devuelta").sort((a,b)=>(b.fechaDevolucion||"").localeCompare(a.fechaDevolucion||"")).slice(0,20);
  const artN=id=>byId("articulos",id)?.nombre||"Artículo eliminado";
  return head("Equipo, uniformes y quién los tiene","Inventario",`<button class="btn" data-act="nuevo-articulo">Nuevo artículo</button><button class="btn primary" data-act="asignar">Asignar a oficial</button>`)+
  `<div class="kpis">
    <div class="kpi"><div class="l">Artículos distintos</div><div class="v">${arts.length}</div><div class="s">${unidades} unidades en total</div></div>
    <div class="kpi"><div class="l">Asignadas</div><div class="v">${asig}</div><div class="s">${unidades-asig} disponibles en bodega</div></div>
    <div class="kpi"><div class="l">Valor del inventario</div><div class="v">${money(valor)}</div><div class="s">Cantidad × costo unitario</div></div>
    <div class="kpi ${pendientes?"neg":""}"><div class="l">Por recuperar</div><div class="v">${pendientes}</div><div class="s">Empleados inactivos con equipo</div></div>
  </div>
  <section class="panel"><header><h2>Artículos</h2></header>
  ${arts.length?`<div class="tbl-wrap"><table><thead><tr><th>Artículo</th><th>Categoría</th><th class="n">Total</th><th class="n">Asignados</th><th class="n">Disponibles</th><th class="n">Costo unit.</th><th></th></tr></thead><tbody>
  ${arts.map(a=>{const st=invStock(a);return `<tr><td><b>${esc(a.nombre)}</b>${exTag(a)}${a.notas?`<span class="sub">${esc(a.notas)}</span>`:""}</td><td><span class="tag">${esc(a.categoria||"Otros")}</span></td><td class="n">${st.total}</td><td class="n">${st.asignados}</td><td class="n" style="color:${st.disponibles<=0?"var(--bad)":"inherit"}">${st.disponibles}</td><td class="n">${money(a.costo)}</td><td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="asignar" data-art="${a.id}" ${st.disponibles>0?"":"disabled"}>Asignar</button><button class="btn sm ghost" data-act="editar-articulo" data-id="${a.id}">Editar</button></div></td></tr>`}).join("")}
  </tbody></table></div>`:`<div class="empty"><b>Sin artículos</b>Registrá radios, camisas, tonfas, focos, sombrillas y demás con su cantidad total y costo.</div>`}</section>
  <section class="panel"><header><h2>Equipo asignado por oficial</h2></header>
  ${grupos.length?grupos.map(g=>{const inactivo=!g.e||g.e.activo===false;return `<div class="inv-emp">
    <div class="inv-h"><div><b>${esc(g.e?.nombre||"Empleado eliminado")}</b> <span class="hint">${esc(g.e?.puesto||"")}</span></div>${inactivo?'<span class="pill bad">Inactivo · pendiente de devolver</span>':`<button class="btn sm ghost" data-act="asignar" data-emp="${g.id}">Asignar más</button>`}</div>
    <div class="tbl-wrap"><table><tbody>${g.items.sort((a,b)=>artN(a.articuloId).localeCompare(artN(b.articuloId))).map(x=>`<tr><td><b>${esc(artN(x.articuloId))}</b>${x.serie?` <span class="mono hint">${esc(x.serie)}</span>`:""}${x.nota?`<span class="sub">${esc(x.nota)}</span>`:""}</td><td class="n">${x.cantidad} ud.</td><td class="hint">Desde ${fdate(x.fecha)}</td><td style="text-align:right"><button class="btn sm" data-act="devolver" data-id="${x.id}">Devolver</button></td></tr>`).join("")}</tbody></table></div>
  </div>`}).join(""):`<div class="empty">Nadie tiene equipo asignado todavía.</div>`}</section>
  <section class="panel"><header><h2>Devoluciones recientes</h2></header>
  ${hist.length?`<div class="tbl-wrap"><table><thead><tr><th>Devuelto</th><th>Oficial</th><th>Artículo</th><th class="n">Cant.</th><th>Condición</th><th>Nota</th></tr></thead><tbody>
  ${hist.map(x=>`<tr><td>${fdate(x.fechaDevolucion)}</td><td>${esc(nombreEmp(x.empleadoId))}</td><td>${esc(artN(x.articuloId))}${x.serie?` <span class="mono hint">${esc(x.serie)}</span>`:""}</td><td class="n">${x.cantidad}</td><td>${x.condicion==="bueno"?'<span class="pill ok">Buen estado</span>':x.condicion==="danado"?'<span class="pill warn">Dañado</span>':'<span class="pill bad">Perdido</span>'}</td><td>${esc(x.notaDevolucion||"")}</td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty">Aquí queda el historial de lo que los oficiales devuelven.</div>`}</section>`;
};
function formArticulo(a){
  a=a||{};
  openForm({title:a.id?"Editar artículo":"Nuevo artículo",fields:[
    {id:"nombre",label:"Artículo",value:a.nombre,required:true,full:true,placeholder:"Ej. Radio portátil Motorola"},
    {id:"categoria",label:"Categoría",type:"select",options:INV_CATS,value:a.categoria||"Otros"},
    {id:"total",label:"Cantidad total (bodega + asignados)",type:"number",min:0,step:"1",value:a.total??"",required:true},
    {id:"costo",label:"Costo unitario (₡)",type:"number",min:0,step:"0.01",value:a.costo??""},
    {id:"notas",label:"Notas",value:a.notas,placeholder:"Marca, talla, proveedor…"}],
    danger:a.id?{label:"Eliminar artículo",confirm:`Se eliminará ${a.nombre}. Las asignaciones que tenga quedan en el historial.`,run:()=>remove("articulos",a.id).then(ok=>ok&&toast("Artículo eliminado"))}:null,
    onSubmit:async v=>{
      if(a.id){const st=invStock(a);if(v.total<st.asignados){toast(`Hay ${st.asignados} unidades asignadas; el total no puede ser menor.`);return false}}
      const data={...a,...v};delete data.id;const ok=await save("articulos",a.id,data);if(ok)toast(a.id?"Artículo actualizado":"Artículo agregado");return ok}});
}
function formAsignar(articuloId,empleadoId){
  const arts=S.articulos.filter(a=>invStock(a).disponibles>0).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const emps=S.empleados.filter(e=>e.activo!==false).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  if(!arts.length){toast(S.articulos.length?"No hay unidades disponibles para asignar.":"Primero agregá artículos al inventario.");return}
  if(!emps.length){toast("Primero agregá empleados en Planilla.");return}
  openForm({title:"Asignar equipo",fields:[
    {id:"empleadoId",label:"Oficial",type:"select",options:emps.map(e=>[e.id,e.nombre]),value:empleadoId||emps[0].id,full:true},
    {id:"articuloId",label:"Artículo",type:"select",options:arts.map(a=>[a.id,`${a.nombre} (${invStock(a).disponibles} disponibles)`]),value:articuloId&&arts.some(a=>a.id===articuloId)?articuloId:arts[0].id,full:true},
    {id:"cantidad",label:"Cantidad",type:"number",min:1,step:"1",value:1,required:true},
    {id:"serie",label:"N.º de serie o código",placeholder:"Opcional, ej. RD-014"},
    {id:"fecha",label:"Fecha de entrega",type:"date",value:today(),required:true},
    {id:"nota",label:"Nota",placeholder:"Talla, estado al entregar…"}],
    onSubmit:async v=>{
      const a=byId("articulos",v.articuloId),st=invStock(a);
      if(!(v.cantidad>=1)){toast("La cantidad debe ser al menos 1.");return false}
      if(v.cantidad>st.disponibles){toast(`Solo hay ${st.disponibles} disponibles de ${a.nombre}.`);return false}
      const ok=await save("asignaciones",null,{...v,estado:"activa",creado:new Date().toISOString()});
      if(ok)toast(`${a.nombre} asignado a ${nombreEmp(v.empleadoId)}`);return ok}});
}
function formDevolver(x){
  if(!x)return;const a=byId("articulos",x.articuloId);
  openForm({title:`Devolución · ${a?a.nombre:"artículo"}`,submit:"Registrar devolución",fields:[
    {id:"fechaDevolucion",label:"Fecha",type:"date",value:today(),required:true},
    {id:"condicion",label:"Condición",type:"select",options:[["bueno","Buen estado (vuelve a bodega)"],["danado","Dañado (se da de baja)"],["perdido","Perdido (se da de baja)"]],value:"bueno"},
    {id:"notaDevolucion",label:"Nota",full:true,placeholder:"Ej. pantalla quebrada, se rebaja de planilla"}],
    intro:`<p class="hint">${esc(nombreEmp(x.empleadoId))} · ${x.cantidad} ud.${x.serie?" · "+esc(x.serie):""} · entregado el ${fdate(x.fecha)}</p>`,
    onSubmit:async v=>{
      const data={...x,...v,estado:"devuelta"};delete data.id;
      if(!await save("asignaciones",x.id,data))return false;
      if(v.condicion!=="bueno"&&a){const d={...a,total:Math.max(0,(+a.total||0)-(+x.cantidad||0))};delete d.id;await save("articulos",a.id,d)}
      toast(v.condicion==="bueno"?"Devolución registrada":"Devolución registrada y artículo dado de baja");return true}});
}

/* ---------- caja chica ---------- */
function cajaMovs(){
  let s=0;
  return [...S.caja].sort((a,b)=>(a.fecha+(a.creado||"")).localeCompare(b.fecha+(b.creado||""))).map(x=>{s+=x.tipo==="gasto"?-(+x.monto||0):(+x.monto||0);return{...x,saldo:r2(s)}});
}
VIEWS.caja=()=>{
  const movs=cajaMovs(),saldo=movs.length?movs[movs.length-1].saldo:0,fondo=+cfg().fondoCaja||0;
  const porReponer=Math.max(0,r2(fondo-saldo));
  const a=monthStart(S.month),b=monthEnd(S.month);
  const mes=movs.filter(x=>x.fecha>=a&&x.fecha<=b).reverse();
  const gastMes=mes.filter(x=>x.tipo==="gasto").reduce((s,x)=>s+(+x.monto||0),0);
  const pct=fondo?Math.max(0,Math.min(100,saldo/fondo*100)):0;
  const TIPO={apertura:"Apertura del fondo",reposicion:"Reposición del fondo"};
  return head("Fondo fijo para gastos menores","Caja chica",`${monthNav()}${movs.length?`<button class="btn" data-act="caja-reponer" ${porReponer>0?"":"disabled"}>Reponer fondo</button><button class="btn primary" data-act="caja-gasto">Registrar gasto</button>`:`<button class="btn primary" data-act="caja-abrir">Abrir caja chica</button>`}`)+
  `<div class="kpis">
    <div class="kpi"><div class="l">Fondo fijo</div><div class="v">${money(fondo)}</div><div class="s">Se cambia en Ajustes</div></div>
    <div class="kpi ${saldo<fondo*0.2&&movs.length?"neg":""}"><div class="l">Saldo en caja</div><div class="v">${money(saldo)}</div><div class="track" style="height:6px;background:var(--surface-2);border-radius:3px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${pct.toFixed(1)}%;background:${pct<20?"var(--bad)":"var(--accent)"}"></div></div></div>
    <div class="kpi"><div class="l">Por reponer</div><div class="v">${money(porReponer)}</div><div class="s">Lo gastado desde la última reposición</div></div>
    <div class="kpi"><div class="l">Gastos de caja en el mes</div><div class="v">${money(gastMes)}</div><div class="s">Se suman a Gastos e Informes</div></div>
  </div>
  <section class="panel"><header><h2>Movimientos de ${monthLabel(S.month).toLowerCase()}</h2></header>
  ${mes.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Detalle</th><th>Responsable</th><th class="n">Entrada</th><th class="n">Salida</th><th class="n">Saldo</th><th></th></tr></thead><tbody>
  ${mes.map(x=>`<tr><td>${fdate(x.fecha)}</td><td><b>${esc(x.tipo==="gasto"?x.descripcion:TIPO[x.tipo]||"Entrada")}</b>${exTag(x)}<span class="sub">${esc(x.tipo==="gasto"?[x.categoria,x.comprobante?"Comp. "+x.comprobante:""].filter(Boolean).join(" · "):x.nota||"")}</span></td><td>${esc(x.responsable||"")}</td><td class="n">${x.tipo!=="gasto"?money(x.monto):""}</td><td class="n">${x.tipo==="gasto"?money(x.monto):""}</td><td class="n">${money(x.saldo)}</td><td><button class="btn sm ghost" data-act="editar-caja" data-id="${x.id}">Editar</button></td></tr>`).join("")}
  </tbody></table></div>`:`<div class="empty"><b>${movs.length?"Sin movimientos este mes":"La caja chica no se ha abierto"}</b>${movs.length?"Registrá los vales de gasto con su responsable y comprobante.":`Abrila con el fondo fijo de ${money(fondo)}. Después cada gasto rebaja el saldo y la reposición lo devuelve al fondo.`}</div>`}</section>
  <p class="note">Los gastos de caja chica cuentan como egresos en el mes en que se hacen. Las reposiciones solo devuelven efectivo a la caja y no se cuentan como gasto, para no sumarlo dos veces.</p>`;
};
function formCaja(m,tipo){
  m=m||{};tipo=m.tipo||tipo;
  const movs=cajaMovs(),saldo=movs.length?movs[movs.length-1].saldo:0,fondo=+cfg().fondoCaja||0;
  const danger=m.id?{label:"Eliminar movimiento",confirm:"Se eliminará este movimiento y el saldo se recalcula.",run:()=>remove("caja",m.id).then(ok=>ok&&toast("Movimiento eliminado"))}:null;
  if(tipo==="gasto"){
    const emps=S.empleados.filter(e=>e.activo!==false).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(e=>[e.nombre,e.nombre]);
    if(m.responsable&&!emps.some(x=>x[0]===m.responsable))emps.unshift([m.responsable,m.responsable]);
    const disp=saldo+(m.id?(+m.monto||0):0);
    openForm({title:m.id?"Editar gasto de caja":"Gasto de caja chica",fields:[
      {id:"descripcion",label:"Descripción",value:m.descripcion,required:true,full:true,placeholder:"Ej. agua para el puesto"},
      {id:"categoria",label:"Categoría",type:"select",options:CATS,value:m.categoria||"Insumos y materiales"},
      {id:"monto",label:"Monto (₡)",type:"number",min:0,step:"0.01",value:m.monto??"",required:true},
      {id:"fecha",label:"Fecha",type:"date",value:m.fecha||today(),required:true},
      {id:"responsable",label:"Responsable",type:"select",options:[["","Sin indicar"],...emps],value:m.responsable||""},
      {id:"comprobante",label:"N.º de factura o vale",value:m.comprobante,full:true}],
      intro:`<p class="hint">Disponible en caja: <b>${money(disp)}</b></p>`,danger,
      onSubmit:async v=>{
        if(!(v.monto>0)){toast("El monto debe ser mayor que cero.");return false}
        if(v.monto>disp+0.005){toast(`El gasto supera el saldo de caja (${money(disp)}). Reponé el fondo primero.`);return false}
        const data={...m,...v,tipo:"gasto",creado:m.creado||new Date().toISOString()};delete data.id;
        const ok=await save("caja",m.id,data);if(ok)toast(m.id?"Gasto actualizado":"Gasto de caja registrado");return ok}});
  }else{
    const sug=tipo==="apertura"?fondo:porReponerCaja(saldo,fondo);
    openForm({title:m.id?"Editar entrada de caja":tipo==="apertura"?"Abrir caja chica":"Reponer fondo",fields:[
      {id:"monto",label:"Monto que entra a caja (₡)",type:"number",min:0,step:"0.01",value:m.monto??sug,required:true},
      {id:"fecha",label:"Fecha",type:"date",value:m.fecha||today(),required:true},
      {id:"nota",label:"Origen del dinero",value:m.nota,full:true,placeholder:"Ej. transferencia o retiro N.º"}],
      intro:tipo==="reposicion"&&!m.id?`<p class="hint">Saldo actual ${money(saldo)}. Reponer ${money(sug)} deja la caja en el fondo fijo de ${money(fondo)}.</p>`:"",danger,
      onSubmit:async v=>{
        if(!(v.monto>0)){toast("El monto debe ser mayor que cero.");return false}
        const data={...m,...v,tipo,creado:m.creado||new Date().toISOString()};delete data.id;
        const ok=await save("caja",m.id,data);if(ok)toast(tipo==="apertura"?"Caja chica abierta":"Fondo repuesto");return ok}});
  }
}
const porReponerCaja=(saldo,fondo)=>Math.max(0,r2(fondo-saldo));

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
  const sel=clienteId||act[0].id;
  const sugerido=c=>{const x=estadoCliente(c);return x.saldo>0.5?Math.max(1,x.periodos):1};
  const c0=byId("clientes",sel);
  const cubre=(c,monto)=>{const x=estadoCliente(c);const cuota=+c.monto||0;const k=cuota>0?Math.floor((x.pagado+monto+0.005)/cuota):0;return{x,k,hasta:k>0?addDays(dueDate(c,k),-1):null,adelanto:k-x.n}};
  const form=openForm({title:"Registrar pago",fields:[
    {id:"clienteId",label:"Cliente",type:"select",options:act.map(c=>[c.id,c.nombre]),value:sel,full:true},
    {id:"periodos",label:"Períodos que paga",type:"number",min:0,step:"1",value:sugerido(c0),hint:"Para un pago adelantado poné más períodos"},
    {id:"monto",label:"Monto recibido (₡)",type:"number",step:"0.01",min:0,value:sugerido(c0)*(+c0.monto||0),required:true},
    {id:"fecha",label:"Fecha",type:"date",value:today(),required:true},
    {id:"metodo",label:"Método",type:"select",options:METODOS,value:"SINPE Móvil"},
    {id:"referencia",label:"Referencia o comprobante",placeholder:"N.º de SINPE o recibo",full:true}],
    intro:`<p class="hint" id="pagoInfo"></p>`,
    onSubmit:async v=>{
      if(!(v.monto>0)){toast("El monto debe ser mayor que cero.");return false}
      const c=byId("clientes",v.clienteId);const r=cubre(c,v.monto);
      const ok=await save("cobros",null,{clienteId:v.clienteId,monto:v.monto,fecha:v.fecha,metodo:v.metodo,referencia:v.referencia,adelantado:r.adelanto>0,creado:new Date().toISOString()});
      if(ok)toast(r.adelanto>0?`Pago adelantado registrado · cubre hasta ${fdate(r.hasta)}`:"Pago registrado");return ok}});
  const info=()=>{const c=byId("clientes",form.elements.clienteId.value);const r=cubre(c,+form.elements.monto.value||0);
    $("#pagoInfo").innerHTML=`Cuota ${FREQ[c.frecuencia]?.label.toLowerCase()} de <b>${money(c.monto)}</b> · saldo pendiente ${money(Math.max(0,r.x.saldo))}<br>Con este pago queda cubierto hasta <b>${r.hasta?fdate(r.hasta):"—"}</b>${r.adelanto>0?` · <span style="color:var(--accent)">${r.adelanto} período${r.adelanto===1?"":"s"} por adelantado</span>`:r.k<r.x.n?` · <span style="color:var(--bad)">queda con saldo pendiente</span>`:""}`};
  const setMonto=()=>{const c=byId("clientes",form.elements.clienteId.value);form.elements.monto.value=r2((+form.elements.periodos.value||0)*(+c.monto||0));info()};
  form.elements.clienteId.onchange=()=>{const c=byId("clientes",form.elements.clienteId.value);form.elements.periodos.value=sugerido(c);setMonto()};
  form.elements.periodos.oninput=setMonto;
  form.elements.monto.oninput=info;
  info();
}
function formEmpleado(e){
  e=e||{};
  const form=openForm({title:e.id?"Editar empleado":"Nuevo empleado",fields:[
    {id:"nombre",label:"Nombre completo",value:e.nombre,required:true,full:true},
    {id:"puesto",label:"Puesto",value:e.puesto},
    {id:"telefono",label:"Teléfono / WhatsApp",value:e.telefono,placeholder:"8888-8888"},
    {id:"reporta",label:"¿Se reporta a monitoreo?",type:"select",options:[["1","Sí, cada intervalo en su turno"],["0","No (administrativo, conserje…)"]],value:e.reporta===false?"0":"1"},
    {id:"ingreso",label:"Fecha de ingreso",type:"date",value:e.ingreso||today()},
    {id:"frecuencia",label:"Se le paga",type:"select",options:Object.entries(PAYFREQ),value:e.frecuencia||"quincenal"},
    {id:"modo",label:"Forma de salario",type:"select",options:[["fijo","Salario mensual fijo"],["hora","Por hora trabajada"]],value:e.modo||"fijo"},
    {id:"salario",label:"Salario mensual (₡)",type:"number",step:"0.01",min:0,value:e.salario??""},
    {id:"tarifaHora",label:"Tarifa por hora (₡)",type:"number",step:"0.01",min:0,value:e.tarifaHora??""},
    {id:"activo",label:"Estado",type:"select",options:[["1","Activo"],["0","Inactivo"]],value:e.activo===false?"0":"1"}],
    danger:e.id?{label:"Eliminar empleado",confirm:`Se eliminará a ${e.nombre}. Sus planillas guardadas se conservan.`,run:()=>remove("empleados",e.id).then(ok=>ok&&toast("Empleado eliminado"))}:null,
    onSubmit:async v=>{const data={...e,...v,activo:v.activo==="1",reporta:v.reporta==="1"};delete data.id;const ok=await save("empleados",e.id,data);if(ok)toast(e.id?"Empleado actualizado":"Empleado agregado");return ok}});
  const sync=()=>{const h=form.elements.modo.value==="hora";form.elements.salario.closest("label").hidden=h;form.elements.tarifaHora.closest("label").hidden=!h};
  sync();form.elements.modo.onchange=sync;
}
function formTurno(t,empId,fecha){
  t=t||{};const emps=S.empleados.filter(e=>e.activo!==false||e.id===t.empleadoId).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  if(!emps.length){toast("Primero agregá empleados en Planilla.");return}
  openForm({title:t.id?"Editar turno":"Asignar turno",fields:[
    {id:"empleadoId",label:"Empleado",type:"select",options:emps.map(e=>[e.id,e.nombre]),value:t.empleadoId||empId||emps[0].id,full:true},
    {id:"clienteId",label:"Puesto (cliente)",type:"select",options:[["","Sin asignar"],...S.clientes.filter(c=>c.activo!==false||c.id===t.clienteId).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>[c.id,c.nombre])],value:t.clienteId||"",full:true},
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
  const t=today(),m=mondayOf(t),ex={ejemplo:true},ahora=new Date(),creado=ahora.toISOString();
  const cl=[
    {id:"ej-c1",nombre:"Condominio Las Brisas",servicio:"Seguridad 24 horas",telefono:"8810-2233",frecuencia:"mensual",monto:950000,inicio:addMonths(t,-3)},
    {id:"ej-c2",nombre:"Soda Doña Mari",servicio:"Ronda nocturna",telefono:"8721-4455",frecuencia:"semanal",monto:18000,inicio:addDays(t,-49)},
    {id:"ej-c3",nombre:"Ferretería El Tornillo",servicio:"Seguridad nocturna",telefono:"2552-9087",frecuencia:"quincenal",monto:145000,inicio:addDays(t,-75)},
    {id:"ej-c4",nombre:"Feria del Agricultor Oreamuno",servicio:"Parqueo y vigilancia",telefono:"8600-1122",frecuencia:"diario",monto:6000,inicio:addDays(t,-12)}];
  const em=[
    {id:"ej-e1",nombre:"Carlos Mora Solano",puesto:"Oficial de seguridad",telefono:"8701-2345",frecuencia:"quincenal",modo:"fijo",salario:385000,ingreso:addMonths(t,-14)},
    {id:"ej-e2",nombre:"Ana Lucía Brenes",puesto:"Conserje",telefono:"8622-9031",frecuencia:"semanal",modo:"hora",tarifaHora:1850,ingreso:addMonths(t,-6)},
    {id:"ej-e3",nombre:"Marco Quirós Vega",puesto:"Supervisor",telefono:"8455-7710",frecuencia:"mensual",modo:"fijo",salario:620000,ingreso:addMonths(t,-30)},
    {id:"ej-e4",nombre:"Luis Fernández Rojas",puesto:"Oficial de seguridad",telefono:"8390-6612",frecuencia:"quincenal",modo:"fijo",salario:385000,ingreso:addMonths(t,-9)}];
  const docs=[];
  cl.forEach(c=>docs.push(["clientes",c.id,{...c,...ex,activo:true,creado}]));
  em.forEach(e=>docs.push(["empleados",e.id,{...e,...ex,activo:true,reporta:e.puesto==="Oficial de seguridad"}]));
  const pagos=[["ej-c1",950000,-60],["ej-c1",950000,-30],["ej-c1",950000,-1],["ej-c2",18000,-42],["ej-c2",18000,-35],["ej-c2",18000,-28],["ej-c2",18000,-21],["ej-c2",18000,-14],["ej-c3",145000,-75],["ej-c3",145000,-60],["ej-c3",145000,-45],["ej-c3",145000,-30],["ej-c4",36000,-6]];
  pagos.forEach(([c,mo,d],i)=>docs.push(["cobros","ej-p"+i,{...ex,clienteId:c,monto:mo,fecha:addDays(t,d),metodo:i%3?"SINPE Móvil":"Transferencia",referencia:"",creado}]));
  const gastos=[["Alquiler de bodega","Alquiler",225000,-18],["Recibo de luz ICE","Servicios públicos",38500,-12],["Uniformes nuevos","Insumos y materiales",64200,-9],["Diésel pick-up de supervisión","Combustible y transporte",41000,-5],["Patente municipal","Impuestos y patentes",27500,-40],["Diésel pick-up de supervisión","Combustible y transporte",39000,-33]];
  gastos.forEach(([d,c,mo,dd],i)=>docs.push(["gastos","ej-g"+i,{...ex,descripcion:d,categoria:c,monto:mo,fecha:addDays(t,dd),metodo:"Transferencia",proveedor:""}]));
  const pat=[["ej-e1","18:00","06:00",[0,1,2,3,4],"ej-c3",0],["ej-e2","07:00","15:30",[0,1,2,3,4,5],"ej-c1",30],["ej-e3","08:00","17:00",[0,1,2,3,4],"",60],["ej-e4","06:00","18:00",[0,1,2,3,4,5,6],"ej-c1",0]];
  const turnos=[];
  pat.forEach(([e,a,b,ds,c,desc])=>ds.forEach(d=>{const tu={...ex,id:`ej-t-${e}-${d}`,empleadoId:e,fecha:addDays(m,d),inicio:a,fin:b,descanso:desc,clienteId:c,nota:c?"":"Supervisión de puestos"};turnos.push(tu);docs.push(["turnos",tu.id,{...tu,id:undefined}])}));
  // bitácora de ejemplo: reportes de los turnos de oficiales ya transcurridos esta semana, con algunos faltantes
  const I=+cfg().intervalo||30;
  turnos.filter(x=>x.empleadoId==="ej-e1"||x.empleadoId==="ej-e4").forEach((tu,k)=>{
    const[s,e]=rangoTurno(tu);if(s>ahora)return;
    const limite=new Date(Math.min(e,ahora-40*60000));const eventos=[];let n=0,ult=s;
    for(let d=new Date(s.getTime()+I*60000);d<=limite;d=new Date(d.getTime()+I*60000)){
      n++;
      if((n+k)%11===0){eventos.push({t:new Date(d.getTime()+4*60000).toISOString(),tipo:"no-responde"});continue}
      const extra=(n+k)%7===0?9:Math.floor(((n*7+k*3)%5));
      const ev={t:new Date(d.getTime()+extra*60000).toISOString(),tipo:(n+k)%13===0?"novedad":"sin-novedad"};
      if(ev.tipo==="novedad")ev.nota=tu.empleadoId==="ej-e1"?"Vehículo sospechoso frente al local, se retiró":"Portón peatonal abierto, se cerró";
      const atraso=Math.round((new Date(ev.t)-ult)/60000-I);if(atraso>(+cfg().tolerancia||0))ev.retraso=atraso;ult=new Date(ev.t);
      eventos.push(ev);
    }
    if(eventos.length)docs.push(["bitacora",tu.id,{...ex,turnoId:tu.id,empleadoId:tu.empleadoId,clienteId:tu.clienteId,puesto:cl.find(c=>c.id===tu.clienteId)?.nombre||"",fecha:tu.fecha,eventos}]);
  });
  const arts=[["ej-a1","Radio portátil Motorola","Comunicación",8,95000],["ej-a2","Camisa de uniforme","Uniforme",20,12500],["ej-a3","Tonfa","Equipo de defensa",6,9800],["ej-a4","Foco recargable","Iluminación",8,14500],["ej-a5","Sombrilla","Otros",5,6500],["ej-a6","Capa impermeable","Uniforme",6,11000],["ej-a7","Chaleco reflectivo","Protección",10,7500]];
  arts.forEach(([id,n,c,q,co])=>docs.push(["articulos",id,{...ex,nombre:n,categoria:c,total:q,costo:co,notas:""}]));
  const asig=[["ej-e1","ej-a1",1,"RD-014",-90],["ej-e1","ej-a2",2,"",-90],["ej-e1","ej-a3",1,"",-90],["ej-e1","ej-a4",1,"FC-03",-60],["ej-e4","ej-a1",1,"RD-021",-30],["ej-e4","ej-a2",2,"",-30],["ej-e4","ej-a3",1,"",-30],["ej-e4","ej-a5",1,"",-10],["ej-e4","ej-a6",1,"",-10],["ej-e2","ej-a2",2,"Talla S",-60],["ej-e3","ej-a1",1,"RD-001",-200]];
  asig.forEach(([e,a,q,se,d],i)=>docs.push(["asignaciones","ej-s"+i,{...ex,empleadoId:e,articuloId:a,cantidad:q,serie:se,fecha:addDays(t,d),nota:"",estado:"activa",creado}]));
  docs.push(["asignaciones","ej-s-dev",{...ex,empleadoId:"ej-e4",articuloId:"ej-a4",cantidad:1,serie:"FC-05",fecha:addDays(t,-30),nota:"",estado:"devuelta",fechaDevolucion:addDays(t,-3),condicion:"danado",notaDevolucion:"No carga la batería",creado}]);
  const fondo=+cfg().fondoCaja||100000;
  const caja=[["apertura",fondo,-20,{nota:"Retiro de cuenta corriente"}],["gasto",4500,-15,{descripcion:"Agua para puesto Las Brisas",categoria:"Insumos y materiales",responsable:"Marco Quirós Vega"}],["gasto",2500,-10,{descripcion:"Fotocopias de bitácoras",categoria:"Otros",responsable:"Marco Quirós Vega"}],["gasto",6800,-4,{descripcion:"Baterías para focos",categoria:"Insumos y materiales",responsable:"Luis Fernández Rojas",comprobante:"F-2231"}],["gasto",2000,-2,{descripcion:"Parqueo supervisión",categoria:"Combustible y transporte",responsable:"Marco Quirós Vega"}]];
  caja.forEach(([tipo,mo,d,x],i)=>docs.push(["caja","ej-k"+i,{...ex,tipo,monto:mo,fecha:addDays(t,d),creado:addDays(t,d)+"T0"+i,...x}]));
  try{for(const[c,id,data]of docs){const d={...data};delete d.id;await db.collection(c).doc(id).set(d)}toast("Datos de ejemplo cargados")}catch(e){handleErr(e)}
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
    case"alertas":{if(!audioCtx){try{audioCtx=new(window.AudioContext||window.webkitAudioContext)()}catch(e){}}S.alertas=!S.alertas;if(S.alertas){try{audioCtx&&audioCtx.resume()}catch(e){}beep();toast("Alerta sonora activada")}else toast("Alerta sonora desactivada");render();break}
    case"rep-ok":registrarEvento(id,"sin-novedad");break;
    case"rep-nov":openForm({title:"Registrar novedad",submit:"Registrar",fields:[{id:"nota",label:`Novedad de ${nombreEmp(byId("turnos",id)?.empleadoId)}`,type:"textarea",full:true}],onSubmit:v=>{if(!String(v.nota).trim()){toast("Describí la novedad.");return false}return registrarEvento(id,"novedad",String(v.nota).trim())}});break;
    case"rep-no":registrarEvento(id,"no-responde");break;
    case"rep-msg":formMensaje(id);break;
    case"csv-bitacora":csvBitacora();break;
    case"bit-ayer":S.bitDia=addDays(today(),-1);render();break;
    case"bit-manual":formRegistroManual();break;
    case"nuevo-articulo":formArticulo();break;
    case"editar-articulo":formArticulo(byId("articulos",id));break;
    case"asignar":formAsignar(b.dataset.art,b.dataset.emp);break;
    case"devolver":formDevolver(byId("asignaciones",id));break;
    case"caja-gasto":formCaja(null,"gasto");break;
    case"caja-reponer":formCaja(null,"reposicion");break;
    case"caja-abrir":formCaja(null,"apertura");break;
    case"editar-caja":formCaja(byId("caja",id));break;
    case"depurar-bitacora":{const lim=addDays(today(),-90);const viejos=S.bitacora.filter(x=>x.fecha<lim);
      if(!viejos.length){toast("No hay registros de bitácora con más de 90 días.");break}
      confirmBox(`Se eliminarán ${viejos.length} turnos de bitácora anteriores al ${fdate(lim)}. Descargá un respaldo antes si querés conservarlos.`,"Depurar bitácora",async()=>{for(const x of viejos)if(!await remove("bitacora",x.id))return;toast("Bitácora depurada")});break}
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
document.addEventListener("change",ev=>{
  if(ev.target.id==="bit-dia"&&ev.target.value){S.bitDia=ev.target.value;render()}
  if(ev.target.id==="bit-emp"){S.bitEmp=ev.target.value;render()}
});
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

/* ---------- reloj de monitoreo ---------- */
setInterval(tick,20000);

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
