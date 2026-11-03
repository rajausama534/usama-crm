(()=>{
  'use strict';
  // Cluster Data (sidebar, below Cluster Guide): pick a community, then a cluster, and see every unit
  // with bedrooms, sizes, last price, sale count and owners, plus the newest official DLD sales.
  // "Fetch latest" runs the DLD sync now (edge function dld-sync, manual mode: once an hour, 30 days).
  // DLD open data has no unit numbers, so those sales are listed separately, never matched to a unit.
  if(typeof db==='undefined')return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=(m,err)=>{const t=document.createElement('div');t.className='crmToast'+(err?' crmToastError':'');t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),4200);};
  const LAST_KEY='crm_cluster_data_last';
  const num=v=>v?Math.round(v).toLocaleString('en-US'):'';
  const price=v=>!v?'':v>=1e6?(Math.round(v/1e4)/100)+'M':Math.round(v/1e3)+'K';
  const day=d=>d?new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'';
  const natural=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  const fetchAll=async build=>{const out=[];for(let f=0;;f+=1000){const {data,error}=await build().range(f,f+999);if(error)throw error;out.push(...data);if(data.length<1000)break;}return out;};

  let options=[],units=[],sort={key:'unit',dir:1},loaded=null;

  // ------------------------------------------------------------------ sidebar item + view
  function ensureNav(){
    const guide=document.querySelector('[data-cluster-guide-entry]'),mine=$('crmClusterDataNav');
    // Cluster Guide is added a little later, after sign-in: keep this item right below it.
    if(mine){if(guide&&guide.nextElementSibling!==mine)guide.after(mine);return !!guide;}
    const nav=guide?.parentElement||document.querySelector('#v7Topbar .v7Nav');if(!nav)return false;
    const b=document.createElement('button');b.type='button';b.id='crmClusterDataNav';
    b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg><span>Cluster Data</span>';
    b.onclick=()=>showClusterData();
    guide?guide.after(b):nav.append(b);
    return !!guide;
  }
  if(!ensureNav()){const t=setInterval(()=>{if(ensureNav())clearInterval(t);},800);setTimeout(()=>clearInterval(t),120000);}

  function ensureView(){
    let v=$('crmClusterDataView');if(v)return v;
    v=document.createElement('div');v.id='crmClusterDataView';v.className='wrap crmPage hidden';
    ($('dashboardView')||$('v7Topbar')).after(v);
    const base=window.showOnly;
    window.showOnly=function(){$('crmClusterDataView')?.classList.add('hidden');$('crmClusterDataNav')?.classList.remove('active');return base.apply(this,arguments);};
    return v;
  }

  window.showClusterData=async function(){
    const v=ensureView();
    showOnly('dashboardView');$('dashboardView')?.classList.add('hidden');v.classList.remove('hidden');
    window.CRMWorkspace?.afterView?.('crmClusterDataView');
    document.querySelectorAll('#v7Topbar .v7Nav button').forEach(b=>b.classList.toggle('active',b.id==='crmClusterDataNav'));
    document.body.classList.remove('crmNavOpen');
    if(!v.dataset.ready){v.dataset.ready='1';await build(v);}
  };

  async function build(v){
    v.innerHTML=`<header class="cdTop"><div><h1>Cluster Data</h1><p class="cdSub">Choose a community, then a cluster.</p></div>
        <div class="cdPick"><select data-community aria-label="Community"><option value="">Community…</option></select>
        <select data-cluster aria-label="Cluster" disabled><option value="">Cluster…</option></select></div></header>
      <div class="cdBody"><div class="crmEmpty cdEmpty">Pick a community and a cluster to see every unit.</div></div>`;
    const {data,error}=await db.rpc('crm_filter_options');
    if(error){v.querySelector('.cdBody').innerHTML=`<p class="crmEmpty">${esc(error.message)}</p>`;return;}
    options=(data||[]).filter(r=>r.community&&r.cluster);
    const comms=[...new Set(options.map(r=>r.community))].sort(natural);
    const cs=v.querySelector('[data-community]'),cl=v.querySelector('[data-cluster]');
    cs.innerHTML='<option value="">Community…</option>'+comms.map(c=>`<option>${esc(c)}</option>`).join('');
    const fillClusters=()=>{const list=[...new Set(options.filter(r=>r.community===cs.value).map(r=>r.cluster))].sort(natural);
      cl.innerHTML='<option value="">Cluster…</option>'+list.map(c=>`<option>${esc(c)}</option>`).join('');cl.disabled=!list.length;};
    cs.onchange=()=>{fillClusters();v.querySelector('.cdBody').innerHTML='<div class="crmEmpty cdEmpty">Now pick a cluster.</div>';};
    cl.onchange=()=>{if(cl.value){try{localStorage.setItem(LAST_KEY,JSON.stringify([cs.value,cl.value]));}catch(_){}load(cs.value,cl.value);}};
    try{const [c,k]=JSON.parse(localStorage.getItem(LAST_KEY)||'[]');if(c&&comms.includes(c)){cs.value=c;fillClusters();if([...cl.options].some(o=>o.value===k)){cl.value=k;load(c,k);}}}catch(_){}
  }

  // ------------------------------------------------------------------ data
  async function load(community,cluster){
    const body=document.querySelector('#crmClusterDataView .cdBody');
    body.innerHTML='<div class="crmLoadingLine">Loading…</div>';loaded={community,cluster};
    try{
      const [owners,details,tx]=await Promise.all([
        fetchAll(()=>db.from('owners').select('id,unit,owner,status').eq('community',community).eq('cluster',cluster).order('id')),
        fetchAll(()=>db.from('unit_details').select('unit,property_type,bedrooms,bua_sqft,plot_sqft').eq('community',community).eq('cluster',cluster)),
        fetchAll(()=>db.from('property_transactions').select('unit,transaction_date,amount,kind,sold_by,source').eq('community',community).eq('cluster',cluster))
      ]);
      if(loaded?.cluster!==cluster)return;
      const byUnit=new Map();
      const get=u=>{const k=String(u??'').trim();if(!byUnit.has(k))byUnit.set(k,{unit:k,owners:[],sales:[]});return byUnit.get(k);};
      owners.forEach(o=>get(o.unit).owners.push(o));
      details.forEach(d=>Object.assign(get(d.unit),{type:d.property_type,beds:(String(d.bedrooms||'').match(/\d+/)||[''])[0],bua:d.bua_sqft,plot:d.plot_sqft}));
      tx.filter(t=>t.kind==='Sold').forEach(t=>get(t.unit).sales.push(t));
      units=[...byUnit.values()].filter(u=>u.unit).map(u=>{
        // Last price = newest sale by date from any source (same rule as the Owners table).
        const last=u.sales.slice().sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)||(/^DXB/i.test(b.source||'')-/^DXB/i.test(a.source||'')))[0];
        const statuses={};u.owners.forEach(o=>{statuses[o.status||'-']=(statuses[o.status||'-']||0)+1;});
        return {...u,last,lastPrice:last?.amount||0,lastDate:last?.transaction_date||'',salesCount:u.sales.length,statuses};
      });
      render(community,cluster);
      loadDld(community,cluster);
    }catch(e){body.innerHTML=`<p class="crmEmpty">Could not load: ${esc(e.message||e)}</p>`;}
  }

  function render(community,cluster){
    const body=document.querySelector('#crmClusterDataView .cdBody');
    const withBeds=units.filter(u=>u.beds),priced=units.filter(u=>u.lastPrice);
    const bedMix={};withBeds.forEach(u=>bedMix[u.beds+'BR']=(bedMix[u.beds+'BR']||0)+1);
    const prices=priced.map(u=>u.lastPrice).sort((a,b)=>a-b),median=prices.length?prices[Math.floor(prices.length/2)]:0;
    const latest=priced.slice().sort((a,b)=>b.lastDate.localeCompare(a.lastDate))[0];
    const ownerCount=units.reduce((s,u)=>s+u.owners.length,0);
    const card=(label,value,sub='')=>`<div class="cdCard"><span>${label}</span><strong>${value}</strong>${sub?`<small>${sub}</small>`:''}</div>`;
    body.innerHTML=`<section class="cdCards">
        ${card('Units',num(units.length),`${num(ownerCount)} owner records`)}
        ${card('Bedrooms',Object.entries(bedMix).sort(natural).map(([k,n])=>`${k} ${n}`).join(' · ')||'—',`${withBeds.length} of ${units.length} units known`)}
        ${card('Median last price',median?'AED '+price(median):'—',`${priced.length} units with a sale`)}
        ${card('Latest sale',latest?'AED '+price(latest.lastPrice):'—',latest?`Unit ${esc(latest.unit)} · ${day(latest.lastDate)}`:'')}
      </section>
      <section class="crmCard cdTableCard">
        <header class="cdTableHead"><h2>${esc(cluster)} <small>${esc(community)}</small></h2><input type="search" placeholder="Search unit, owner or status…" data-search></header>
        <div class="cdTableWrap"><table class="cdTable"><thead><tr>${[['unit','Unit'],['beds','BR'],['bua','BUA'],['plot','Plot'],['lastPrice','Last price'],['lastDate','Date'],['salesCount','Sales'],['owners','Owners'],['status','Status']].map(([k,l])=>`<th data-sort="${k}" class="${['beds','bua','plot','lastPrice','salesCount'].includes(k)?'cdNum':''}">${l}<i></i></th>`).join('')}</tr></thead><tbody></tbody></table></div>
      </section>
      <section class="crmCard cdDld"><header class="cdTableHead"><div><h2>Latest DLD sales</h2><p class="cdSub">Official Dubai Land Department data for this cluster. DLD does not publish unit numbers.</p></div>
        <button type="button" class="crmBtn crmBtnPrimary" data-fetch>Fetch latest</button></header><div data-dld><div class="crmLoadingLine">Loading…</div></div></section>`;
    body.querySelector('[data-search]').oninput=paintRows;
    body.querySelectorAll('[data-sort]').forEach(th=>th.onclick=()=>{const k=th.dataset.sort;sort={key:k,dir:sort.key===k?-sort.dir:(k==='unit'?1:-1)};paintRows();});
    body.querySelector('[data-fetch]').onclick=fetchLatest;
    paintRows();
  }

  function paintRows(){
    const tb=document.querySelector('#crmClusterDataView .cdTable tbody');if(!tb)return;
    const q=(document.querySelector('#crmClusterDataView [data-search]')?.value||'').toLowerCase().trim();
    const val=(u,k)=>k==='owners'?u.owners.length:k==='status'?Object.keys(u.statuses).sort().join(','):u[k]??'';
    const list=units.filter(u=>!q||[u.unit,...u.owners.map(o=>o.owner),...Object.keys(u.statuses)].join(' ').toLowerCase().includes(q))
      .sort((a,b)=>{const x=val(a,sort.key),y=val(b,sort.key);return sort.dir*(typeof x==='number'&&typeof y==='number'?x-y:natural(x,y));});
    document.querySelectorAll('#crmClusterDataView [data-sort]').forEach(th=>th.dataset.dir=th.dataset.sort===sort.key?(sort.dir>0?'asc':'desc'):'');
    tb.innerHTML=list.map(u=>`<tr data-owner="${esc(u.owners[0]?.id||'')}">
      <td><strong>${esc(u.unit)}</strong>${u.type?`<small>${esc(u.type)}</small>`:''}</td>
      <td class="cdNum">${u.beds||'—'}</td><td class="cdNum">${num(u.bua)||'—'}</td><td class="cdNum">${num(u.plot)||'—'}</td>
      <td class="cdNum">${u.lastPrice?`<strong>${price(u.lastPrice)}</strong>`:'—'}</td>
      <td>${u.lastDate?`${day(u.lastDate)}<small>${esc(u.last?.sold_by||'')}</small>`:'—'}</td>
      <td class="cdNum">${u.salesCount||'—'}</td>
      <td title="${esc(u.owners.map(o=>o.owner).join(', '))}">${u.owners.length?esc(u.owners[0].owner||'—')+(u.owners.length>1?` <small>+${u.owners.length-1} more</small>`:''):'—'}</td>
      <td>${Object.entries(u.statuses).map(([s,n])=>`<span class="cdStatus" data-status="${esc(s)}">${esc(s)}${n>1?' ×'+n:''}</span>`).join(' ')}</td></tr>`).join('')||'<tr><td colspan="9" class="crmEmpty">No units match.</td></tr>';
    tb.querySelectorAll('tr[data-owner]').forEach(tr=>{if(tr.dataset.owner)tr.onclick=()=>window.crmOpenOwnerRecord?.(tr.dataset.owner);});
  }

  async function loadDld(community,cluster){
    const box=document.querySelector('#crmClusterDataView [data-dld]');if(!box)return;
    const {data,error}=await db.from('dld_transactions').select('transaction_date,procedure,is_offplan,property_type,property_sub_type,rooms,amount,area_sqft,dld_project')
      .eq('crm_community',community).eq('crm_cluster',cluster).order('transaction_date',{ascending:false}).limit(200);
    if(loaded?.cluster!==cluster)return;
    if(error){box.innerHTML=`<p class="crmEmpty">${esc(error.message)}</p>`;return;}
    const {data:run}=await db.from('dld_sync_runs').select('started_at,finished_at,error').order('started_at',{ascending:false}).limit(1).maybeSingle();
    const when=run?.finished_at||run?.started_at;
    box.innerHTML=(when?`<p class="cdSub">Last fetched ${new Date(when).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}${run?.error?' · last attempt failed':''}</p>`:'')+
      ((data||[]).length?`<div class="cdTableWrap"><table class="cdTable cdDldTable"><thead><tr><th>Date</th><th>Type</th><th>BR</th><th class="cdNum">Size sq ft</th><th class="cdNum">Price</th><th>Kind</th></tr></thead><tbody>${data.map(d=>`<tr>
        <td>${day(d.transaction_date)}</td><td>${esc(d.property_sub_type||d.property_type||'—')}</td><td>${esc(String(d.rooms||'').replace(/ B\/R/i,'BR')||'—')}</td>
        <td class="cdNum">${num(d.area_sqft)||'—'}</td><td class="cdNum"><strong>${price(d.amount)}</strong></td><td>${d.is_offplan?'Off-plan':'Ready'} · ${esc(d.procedure||'')}</td></tr>`).join('')}</tbody></table></div>`
       :'<p class="crmEmpty">No DLD sales recorded for this cluster yet.</p>');
  }

  async function fetchLatest(){
    const btn=document.querySelector('#crmClusterDataView [data-fetch]');if(!btn||!loaded)return;
    btn.disabled=true;btn.textContent='Fetching from DLD…';
    try{
      const {data,error}=await db.functions.invoke('dld-sync',{body:{manual:true}});
      if(error)throw error;
      if(data?.skipped)toast('Already fetched in the last hour — showing the newest data.');
      else if(data?.error)toast('DLD fetch failed: '+data.error,true);
      else toast(`DLD checked: ${num(data?.mapped||0)||'no'} sales matched your clusters`);
    }catch(e){toast('Could not reach the DLD sync: '+(e.message||e),true);}
    btn.disabled=false;btn.textContent='Fetch latest';
    loadDld(loaded.community,loaded.cluster);
  }
})();
