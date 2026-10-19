(()=>{
  'use strict';
  // Owners + Leads workspace layout. Re-arranges the existing controls (same elements, same handlers):
  // one primary action, a "More" menu, primary filters visible, secondary filters behind "Filters".
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STAGES=['New','Call Back','Interested','Viewing Done','Negotiation','Won','Lost'];

  function moreMenu(items){
    const wrap=document.createElement('div');wrap.className='crmMore';
    wrap.innerHTML='<button type="button" class="crmBtn" aria-haspopup="menu" aria-expanded="false">More <span aria-hidden="true">▾</span></button><div class="crmMenu" role="menu" hidden></div>';
    const btn=wrap.firstElementChild,menu=wrap.lastElementChild;
    items.filter(Boolean).forEach(el=>{el.setAttribute('role','menuitem');el.className='crmMenuItem';menu.append(el);});
    btn.onclick=e=>{e.stopPropagation();const open=menu.hidden;document.querySelectorAll('.crmMenu').forEach(m=>m.hidden=true);menu.hidden=!open;btn.setAttribute('aria-expanded',String(open));};
    menu.addEventListener('click',()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false');});
    return wrap;
  }
  document.addEventListener('click',()=>document.querySelectorAll('.crmMenu').forEach(m=>m.hidden=true));

  function advancedToggle(card,fields,label){
    const adv=document.createElement('div');adv.className='crmAdvFilters';adv.hidden=true;
    fields.filter(Boolean).forEach(f=>{const l=document.createElement('label');l.className='crmAdvField';l.innerHTML=`<span>${esc(f.dataset.label||f.getAttribute('placeholder')||'')}</span>`;l.append(f);adv.append(l);});
    const btn=document.createElement('button');btn.type='button';btn.className='crmBtn crmFilterToggle';
    const count=()=>fields.filter(f=>f&&f.value&&!/^(unit|asc|lead_receive_date|desc)$/.test(f.value)).length;
    const paint=()=>{const n=count();btn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4"/></svg>${label}${n?` <b>${n}</b>`:''}`;};
    btn.onclick=()=>{adv.hidden=!adv.hidden;btn.classList.toggle('active',!adv.hidden);};
    fields.forEach(f=>f&&f.addEventListener('change',paint));paint();
    return {adv,btn,paint};
  }

  // ------------------------------------------------------------------ Owners
  function upgradeOwners(){
    const v=$('appView');if(!v||v.dataset.ws)return;v.dataset.ws='1';
    v.classList.add('crmWorkspace');
    const header=v.querySelector('.mainHeader'),btns=header?.querySelector('.headerBtns');
    header.querySelector('h1')?.insertAdjacentHTML('afterend','<p class="crmPageSub">Every owner record you can access — search, filter and open a profile.</p>');
    const card=v.querySelector('.card'),actions=card?.querySelector('.actionsRow');
    const addBtn=[...(actions?.querySelectorAll('button')||[])].find(b=>/Add Owner/i.test(b.textContent));
    const pick=re=>[...(actions?.querySelectorAll('button')||[])].find(b=>re.test(b.textContent));
    const exportBtn=$('exportBtn');
    if(btns){
      [...btns.querySelectorAll('button')].forEach(b=>{if(/Logout|Dashboard|Leads/i.test(b.textContent))b.remove();});
      const items=[pick(/Edit WhatsApp/i),pick(/Manage Statuses/i),pick(/Manage Columns/i)];
      if(exportBtn&&!exportBtn.classList.contains('hidden')){exportBtn.textContent='Export CSV';items.push(exportBtn);}
      btns.append(moreMenu(items));
      if(addBtn){addBtn.classList.add('crmBtn','crmBtnPrimary');addBtn.id='crmAddOwnerBtn';btns.append(addBtn);}
    }
    // filters: search + community + cluster + status visible; unit, source and sort behind "Filters"
    const filters=card.querySelector('.filters');
    const unit=$('unitFilter'),source=$('sourceFilter'),sortF=$('ownerSortField'),sortD=$('ownerSortDirection');
    if(unit)unit.dataset.label='Unit number';if(source)source.dataset.label='Source';if(sortF)sortF.dataset.label='Sort by';if(sortD)sortD.dataset.label='Order';
    const {adv,btn}=advancedToggle(card,[unit,source,sortF,sortD],'Filters');
    const reset=card.querySelector('.reset');
    if(reset){reset.className='crmLinkBtn';reset.textContent='Reset';}
    filters.append(btn);if(reset)filters.append(reset);
    filters.after(adv);
    actions?.remove();
    card.querySelector('.quickFilters')?.insertAdjacentHTML('afterbegin','<span class="crmChipLabel">Status</span>');
    // KPI tiles filter the list
    const map={ownerKpiSale:'For Sale',ownerKpiRent:'For Rent',ownerKpiCall:'Call Back',ownerKpiNoResp:'No Response',ownerKpiInvalid:'Invalid Number',ownerKpiTotal:''};
    Object.entries(map).forEach(([id,status])=>{const tile=$(id)?.closest('.kpiCard');if(!tile)return;tile.classList.add('is-clickable');tile.tabIndex=0;tile.onclick=()=>quickStatus(status);tile.onkeydown=e=>{if(e.key==='Enter')quickStatus(status);};});
    const total=$('ownerKpiTotal');if(total&&/^\d+$/.test(total.textContent))total.textContent=Number(total.textContent).toLocaleString('en-US');
  }

  // Owner names are stored in capitals; show them in readable case (display only, data unchanged).
  const titleCase=s=>s.toLowerCase().replace(/(^|[\s\-'(])([a-z])/g,(m,a,b)=>a+b.toUpperCase());
  function tidyOwnerRows(){
    document.querySelectorAll('#tableBody td.owner-col-owner .ownerIdentityName, #tableBody td.owner-col-owner, .mobileOwnerCard h3, [class*="obileCard"] [class*="ame"]').forEach(td=>{
      const n=[...td.childNodes].find(x=>x.nodeType===3&&x.textContent.trim());
      if(n&&n.textContent===n.textContent.toUpperCase()&&/[A-Z]/.test(n.textContent)){td.title=n.textContent.trim();n.textContent=titleCase(n.textContent);}
    });
    const total=$('ownerKpiTotal');if(total&&/^\d+$/.test(total.textContent))total.textContent=Number(total.textContent).toLocaleString('en-US');
  }

  // ------------------------------------------------------------------ Leads
  async function paintStageBar(){
    const bar=$('crmStageBar');if(!bar)return;
    const counts=await Promise.all(STAGES.map(s=>db.from('leads').select('id',{count:'exact',head:true}).eq('status',s)));
    const active=$('leadStatusFilter')?.value||'';
    bar.innerHTML=`<button type="button" class="crmStage ${!active?'active':''}" data-stage=""><span>All</span><b>${counts.reduce((a,c)=>a+(c.count||0),0)}</b></button>`+
      STAGES.map((s,i)=>`<button type="button" class="crmStage crmStage-${i} ${active===s?'active':''}" data-stage="${esc(s)}"><span>${esc(s)}</span><b>${counts[i].count??0}</b></button>`).join('');
    bar.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{const f=$('leadStatusFilter');if(f){if(b.dataset.stage&&![...f.options].some(o=>o.value===b.dataset.stage))f.add(new Option(b.dataset.stage,b.dataset.stage));f.value=b.dataset.stage;}leadPage=0;leadViewMode==='kanban'?loadKanban():loadLeads();paintStageBar();});
  }
  function upgradeLeads(){
    const v=$('leadsView');if(!v||v.dataset.ws)return;v.dataset.ws='1';
    v.classList.add('crmWorkspace');
    const header=v.querySelector('.mainHeader'),btns=header?.querySelector('.headerBtns');
    header.querySelector('h1')?.insertAdjacentHTML('afterend','<p class="crmPageSub">Your sales pipeline — who to call, what they want and when to follow up.</p>');
    const card=v.querySelector('.card'),actions=card?.querySelector('.actionsRow');
    const find=(root,re)=>[...(root?.querySelectorAll('button')||[])].find(b=>re.test(b.textContent));
    if(btns){
      const add=find(btns,/Add Lead/i),exp=find(btns,/Export/i),sw=btns.querySelector('.viewSwitch');
      [...btns.querySelectorAll('button')].forEach(b=>{if(/Logout|Dashboard|Owner Database/i.test(b.textContent))b.remove();});
      if(sw)sw.classList.add('crmSeg');
      btns.append(moreMenu([exp,find(actions,/Manage Projects/i),find(actions,/Manage Pipeline/i),find(actions,/Manage Columns/i)]));
      if(add){add.classList.add('crmBtn','crmBtnPrimary');add.id='crmAddLeadBtn';btns.append(add);}
    }
    // stage bar replaces the old quick-status chips (which still listed Contacted/Viewing)
    const quick=card.querySelector('.quickFilters');
    const bar=document.createElement('div');bar.id='crmStageBar';bar.className='crmStageBar';
    (quick||card.firstElementChild).before(bar);quick?.remove();
    const filters=card.querySelector('.filters');
    const src=$('leadSourceFilter'),proj=$('leadProjectFilter'),fu=$('leadFollowUpFilter'),sf=$('leadSortField'),sd=$('leadSortDirection');
    if(src)src.dataset.label='Source';if(proj)proj.dataset.label='Project';if(fu)fu.dataset.label='Follow-up date';if(sf)sf.dataset.label='Sort by';if(sd)sd.dataset.label='Order';
    const {adv,btn}=advancedToggle(card,[src,proj,fu,sf,sd],'Filters');
    const reset=find(actions,/Reset/i);if(reset){reset.className='crmLinkBtn';reset.textContent='Reset';}
    filters.append(btn);if(reset)filters.append(reset);filters.after(adv);
    actions?.remove();
    $('leadStatusFilter')?.addEventListener('change',paintStageBar);
    $('followupDashboard')?.classList.add('crmFollowStrip');
    paintStageBar();
  }

  // Next follow-up under each lead name (fields are kept in sync with the calendar).
  function leadNextAction(rows){
    if(typeof renderLeads!=='function')return;
    const body=$('leadsTableBody');if(!body)return;
    const now=new Date();
    [...body.querySelectorAll('tr')].forEach((tr,i)=>{
      const lead=(rows||[])[i],cell=tr.querySelector('td');
      if(!lead||!cell||cell.querySelector('.crmNext'))return;
      let html='<span class="crmNext none">No follow-up</span>';
      if(lead.follow_up_date){
        const when=new Date(`${lead.follow_up_date}T${lead.follow_up_time||'09:00'}`);
        const label=when.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+(lead.follow_up_time?' '+String(lead.follow_up_time).slice(0,5):'');
        html=`<span class="crmNext ${when<now?'late':''}">${when<now?'Overdue':'Next'}: ${esc(lead.reminder_type||'Follow-up')} · ${label}</span>`;
      }
      cell.insertAdjacentHTML('beforeend',html);
    });
  }

  // ------------------------------------------------------------------ wire up
  if(typeof leadStatuses==='function'){window.leadStatuses=()=>[...STAGES];}
  try{if(typeof DEFAULT_PIPELINE_STAGES!=='undefined'){DEFAULT_PIPELINE_STAGES.splice(0,DEFAULT_PIPELINE_STAGES.length,...STAGES);}}catch(_){}
  const wrap=(name,after)=>{const base=window[name];if(typeof base!=='function')return;window[name]=async function(){const r=await base.apply(this,arguments);try{after(...arguments);}catch(e){console.warn(name,e);}return r;};};
  wrap('showOwnersView',()=>{upgradeOwners();tidyOwnerRows();});
  wrap('showLeadsView',()=>{upgradeLeads();paintStageBar();});
  // The owner table is redrawn by several layers; watch the table body instead of wrapping each one.
  const tb=$('tableBody');if(tb)new MutationObserver(()=>tidyOwnerRows()).observe(tb,{childList:true});
  if(typeof renderLeads==='function'){const base=renderLeads;renderLeads=function(rows){const r=base.apply(this,arguments);setTimeout(()=>leadNextAction(rows),0);return r;};}
  // sidebar: log out lives with the profile
  const acts=document.querySelector('#v7Topbar .v7TopActions');
  if(acts&&!acts.querySelector('.crmLogout')){const b=document.createElement('button');b.type='button';b.className='crmLogout';b.textContent='Log out';b.onclick=()=>logout();acts.append(b);}
  if(!$('appView')?.classList.contains('hidden')){upgradeOwners();tidyOwnerRows();}
  if(!$('leadsView')?.classList.contains('hidden')){upgradeLeads();}
})();
