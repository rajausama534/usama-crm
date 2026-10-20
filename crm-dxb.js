(()=>{
  'use strict';
  // Receives sales sent by the Chrome extension from DXBinteract (index.html#dxb=...), previews the
  // exact-unit matches (database dry run) and imports them only when the admin confirms.
  if(typeof db==='undefined')return;
  const m=location.hash.match(/^#dxb=(.+)$/);if(!m)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=(msg,err)=>{const t=document.createElement('div');t.className='crmToast'+(err?' crmToastError':'');t.textContent=msg;document.body.append(t);setTimeout(()=>t.remove(),4200);};
  let payload;
  try{payload=JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));}catch(e){toast('Could not read the data sent from DXBinteract.',true);return;}
  history.replaceState(null,'',location.pathname);

  // Same name rules as the DLD import: 'Elie Saab ll' == 'Elie Saab 2', community must match too.
  const norm=s=>{let n=String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/lll/g,'iii').replace(/ll/g,'ii');n=n.replace(/([a-z])iii$/,'$13').replace(/([a-z])ii$/,'$12');return n==='eliesaab'?'eliesaab1':n;};
  async function mapLocations(rows){
    const {data}=await db.rpc('crm_filter_options');
    const labels={};(data||[]).forEach(o=>{if(!o.community||!o.cluster)return;const k=norm(o.cluster);(labels[k]=labels[k]||new Set()).add(o.community+'||'+o.cluster);});
    return rows.map(r=>{
      const parts=String(r.location||'').split(',').map(s=>s.trim());
      const hits=[...(labels[norm(parts[0])]||[])].filter(x=>norm(x.split('||')[0])===norm(parts[1]||'')||parts.slice(1).some(p=>norm(p)===norm(x.split('||')[0])));
      const [community,cluster]=hits.length===1?hits[0].split('||'):[null,null];
      return {...r,community,cluster};
    });
  }

  async function run(){
    if(!isAdmin){toast('Only an administrator can import sales.',true);return;}
    const rows=await mapLocations(payload.rows||[]);
    const call=dry=>db.rpc('crm_import_external_sales',{rows,source:'dxbinteract',dry_run:dry});
    const {data:preview,error}=await call(true);
    if(error){toast(error.message,true);return;}
    const count=k=>preview.filter(p=>p.result===k).length;
    const w=document.createElement('div');w.className='crmModalScrim';
    const tag=r=>r==='will import'?'on':r==='already stored'?'':'off';
    w.innerHTML=`<div class="crmModal" style="width:min(900px,100%)"><header><h2>Import sales from DXBinteract</h2><button type="button" class="crmIconBtn" data-close aria-label="Close">×</button></header>
      <div class="crmModalBody"><p class="crmSub" style="margin:0 0 12px">${rows.length} sales read from the page you were viewing. A sale is only linked when its unit number exists exactly once in the matching CRM cluster. Nothing existing is changed.</p>
      <div class="crmKpiGrid" style="margin-bottom:16px">${[['Will import',count('will import')],['Already stored',count('already stored')],['Skipped',preview.length-count('will import')-count('already stored')]].map(([l,v])=>`<div class="crmKpi" style="min-height:0"><span class="crmKpiLabel">${l}</span><span class="crmKpiValue">${v}</span></div>`).join('')}</div>
      <div class="crmTableWrap"><table class="crmTable"><thead><tr><th>DXBinteract</th><th>CRM unit</th><th>Result</th></tr></thead><tbody>
      ${preview.map(p=>{const r=rows[p.idx-1]||{};return `<tr><td data-label="DXBinteract"><strong>${esc(r.label||r.location)}</strong><span class="crmSub">${esc(p.note||`AED ${Number(r.amount||0).toLocaleString('en-US')} · ${r.date||''}`)}</span></td>
        <td data-label="CRM unit">${p.unit?esc(`${p.community} › ${p.cluster} › ${p.unit}`):'—'}</td><td data-label="Result"><span class="crmStatus ${tag(p.result)}">${esc(p.result)}</span></td></tr>`;}).join('')}
      </tbody></table></div></div>
      <footer><button type="button" class="crmBtn" data-close>Cancel</button><button type="button" class="crmBtn crmBtnPrimary" data-go ${count('will import')?'':'disabled'}>Import ${count('will import')} sales</button></footer></div>`;
    document.body.append(w);
    w.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>w.remove());
    w.querySelector('[data-go]').onclick=async e=>{
      e.target.disabled=true;e.target.textContent='Importing…';
      const {data:done,error:err}=await call(false);
      if(err){toast(err.message,true);e.target.disabled=false;return;}
      w.remove();toast(`Imported ${done.filter(d=>d.result==='imported').length} sales into unit transaction history`);
    };
  }
  const wait=setInterval(()=>{if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&typeof isAdmin!=='undefined'){clearInterval(wait);run();}},500);
  setTimeout(()=>clearInterval(wait),30000);
})();
