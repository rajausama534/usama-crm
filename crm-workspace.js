(()=>{
  'use strict';
  // Owners + Leads workspace layout. Re-arranges the existing controls (same elements, same handlers):
  // one primary action, a "More" menu, primary filters visible, secondary filters behind "Filters".
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STAGES=['New','No Response','Interested','Viewing Scheduled','Visit Done','Negotiation','Won','Lost'];


  // Keep shared desktop/mobile renderers in the workspace, using existing actions and data.
  const WA_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';
  function compactWhatsApp(markup){
    const t=document.createElement('template');t.innerHTML=markup;
    const a=t.content.querySelector('a');if(!a)return markup;
    a.classList.add('crmWaIcon');a.setAttribute('aria-label','WhatsApp');a.title='WhatsApp';a.innerHTML=WA_ICON;
    return t.innerHTML;
  }
  const ownerOrder=['community','cluster','unit','owner','status','remarks','whatsapp','actions'];
  const saved=new Map(ownerColumns.map(c=>[c.key,c]));
  ownerColumns.splice(0,ownerColumns.length,...ownerOrder.map(key=>saved.get(key)||{key,label:key==='actions'?'Actions':key,visible:true,width:220}),...ownerColumns.filter(c=>!ownerOrder.includes(c.key)));
  const labels={owner:'Owner',remarks:'Notes',whatsapp:'WhatsApp'};
  ownerColumns.forEach(c=>{if(labels[c.key])c.label=labels[c.key];});
  // Versioned defaults are applied once; subsequent manual resizing remains intact.
  if(localStorage.getItem('crm_owner_layout_v1')!=='1'){
    const widths={community:140,cluster:140,unit:86,owner:210,status:160,remarks:270,whatsapp:60,actions:220};
    ownerColumns.forEach(c=>{if(widths[c.key])c.width=widths[c.key];if(c.key==='last_contacted')c.visible=false;});saveOwnerColumnsState();localStorage.setItem('crm_owner_layout_v1','1');
  }
  const baseLeadInput=window.leadInput;
  window.leadInput=function(row,col){
    const r=baseLeadInput(row,col);
    if(col.key==='project_inquired')return r+`<span class="crmRequirementMeta">${esc([row.bedroom,row.property_type].filter(Boolean).join(' · '))}</span>`;
    return r;
  };
  window.crmOpenOwnerRecord=async function(id){
    let row=currentOwnerPageRows.find(r=>String(r.id)===String(id));
    if(!row){const {data}=await db.from(TABLE_NAME).select('*').eq('id',id).maybeSingle();row=data;}
    if(row)return openOwnerProfile(row);
  };
  const ownerPhone=row=>formatPhone(get(row,["phone1","phone2","phone","mobile","contact"]));
  const ownerCopy=row=>ownerPhone(row)?copyPhoneButton(row):'';
  function ownerContact(row){
    if(ownerPhone(row))return compactWhatsApp(whatsappButton(row));
    return `<button type="button" class="waBtn crmWaIcon" disabled aria-label="WhatsApp unavailable: no phone number" title="No phone number">${WA_ICON}</button>`;
  }
  const broadcastIcon=$('v7NavBroadcast')?.querySelector('svg');
  if(broadcastIcon){broadcastIcon.outerHTML=WA_ICON;const svg=$('v7NavBroadcast').querySelector('svg');svg.style.stroke='none';}
  const baseOwnerCell=window.ownerCell;
  window.ownerCell=function(row,col){
    if(col.key==='owner')return `<span class="ownerIdentityName" title="${esc(row.owner)}">${esc(row.owner||'—')}</span>`;
    if(col.key==='whatsapp')return ownerContact(row);
    if(col.key==='actions')return `<div class="crmOwnerActions"><button type="button" class="profileBtn" onclick="crmOpenOwnerRecord('${esc(row.id)}')">Profile</button><span data-related-units>${moreUnitButton(row)}</span>${callButton(row)||'<span class="crmNoPhone">No phone number</span>'}${ownerCopy(row)}</div>`;
    return baseOwnerCell(row,col);
  };
  window.crmRenderOwnerCards=function(rows){
    $('mobileCards').innerHTML=rows.map(r=>`<article class="ownerCard crmRecordCard" data-record-id="${esc(r.id)}">
      <div class="crmLocation"><span>${esc(r.community||'—')}</span><span>${esc(r.cluster||'—')}</span><label class="crmSelectRecord"><input type="checkbox" aria-label="Select owner ${esc(r.unit)}" ${selectedOwnerIds.has(String(r.id))?'checked':''} onchange="toggleOwnerSelection('${esc(r.id)}',this.checked)"></label></div>
      <div class="crmRecordHeading"><strong class="crmUnit">Unit ${esc(r.unit||'—')}</strong>${statusDropdown(r)}</div>
      <h3 class="crmRecordName">${esc(r.owner||'Unnamed owner')}</h3>
      <button type="button" class="crmOwnerNote crmNoteButton" data-open-owner="${esc(r.id)}">${esc(r.__u10_latest||ownerRemarkValue(r)||'No notes yet')}</button>
      <footer class="crmRecordActions">
        <button type="button" class="crmBtn" data-open-owner="${esc(r.id)}">Open</button>${ownerContact(r)}${ownerPhone(r)?callButton(r):'<span class="crmNoPhone">No phone number</span>'}
        <details class="crmCardMore"><summary aria-label="More owner actions">•••</summary><div><span data-related-units>${moreUnitButton(r)}</span>${ownerCopy(r)}</div></details>
      </footer></article>`).join('')||'<div class="empty">No owners match these filters.</div>';
    $('mobileCards').querySelectorAll('[data-open-owner]').forEach(b=>b.onclick=()=>openOwnerProfile(rows.find(r=>String(r.id)===b.dataset.openOwner)));
  };
  window.crmRenderLeadCards=function(rows){
    $('leadMobileCards').innerHTML=rows.map(r=>`<article class="leadCard crmRecordCard" data-record-id="${esc(r.id)}">
      <div class="crmRecordHeading"><h3 class="crmRecordName">${esc(r.name||'Unnamed lead')}</h3><span class="crmBadge" data-status="${esc(r.status||'New')}">${esc(r.status||'New')}</span></div>
      <a class="crmContact" href="tel:+${esc(formatPhone(r.phone))}">${esc(r.phone||'No phone')}</a>
      <p class="crmRequirement">${esc([r.bedroom,r.property_type,r.project_inquired].filter(Boolean).join(' · ')||'Requirement not recorded')}${r.budget?`<small>Budget ${esc(r.budget)}</small>`:''}</p>
      <div class="crmLeadMeta"><span>${esc(r.assigned_to||'Not assigned')}</span><span>Last contact: ${esc(r.last_contacted?formatCRMDate(r.last_contacted):'—')}</span></div>
      <div class="crmFollowup">${r.follow_up_date?`Next: ${esc(formatCRMDate(r.follow_up_date))} ${esc(r.follow_up_time?.slice(0,5)||'')} · ${esc(r.reminder_type||'Follow-up')}`:'No follow-up scheduled'}</div>
      <button type="button" class="crmNoteButton" data-open-lead="${esc(r.id)}">${esc(r.notes||'No notes yet')}</button>
      <footer class="crmRecordActions"><button type="button" class="crmBtn" data-open-lead="${esc(r.id)}">Open lead</button>${compactWhatsApp(leadWhatsappButton(r))}${r.phone?`<a class="callBtn" href="tel:+${esc(formatPhone(r.phone))}">Call</a>`:''}</footer>
      </article>`).join('')||'<div class="empty">No leads match these filters.</div>';
    $('leadMobileCards').querySelectorAll('[data-open-lead]').forEach(b=>b.onclick=()=>openLeadDetail(b.dataset.openLead));
  };
  for(const [name,type] of [['openOwnerProfile','owner'],['openLeadDetail','lead']]){
    const base=window[name];window[name]=async function(record){const r=await base.apply(this,arguments);CRMWorkspace.record(type,type==='owner'?record?.id:record);return r;};
  }
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
    const card=v.querySelector('.card'),actions=card?.querySelector('.actionsRow');
    const addBtn=[...(actions?.querySelectorAll('button')||[])].find(b=>/Add Owner/i.test(b.textContent));
    const pick=re=>[...(actions?.querySelectorAll('button')||[])].find(b=>re.test(b.textContent));
    const exportBtn=$('exportBtn');let ownerMore=null;
    if(btns){
      [...btns.querySelectorAll('button')].forEach(b=>{if(/Logout|Dashboard|Leads/i.test(b.textContent))b.remove();});
      if(addBtn)addBtn.id='crmAddOwnerBtn';
      const items=[addBtn,pick(/Edit WhatsApp/i),pick(/Manage Statuses/i),pick(/Manage Columns/i)];
      if(exportBtn&&!exportBtn.classList.contains('hidden')){exportBtn.textContent='Export CSV';items.push(exportBtn);}
      ownerMore=moreMenu(items);
    }
    // filters: search + community + cluster + status visible; unit, source and sort behind "Filters"
    const filters=card.querySelector('.filters');
    const unit=$('unitFilter'),source=$('sourceFilter'),sortF=$('ownerSortField'),sortD=$('ownerSortDirection'),status=$('statusFilter');
    if(status)status.dataset.label='Status';
    if(unit)unit.dataset.label='Unit number';if(source)source.dataset.label='Source';if(sortF)sortF.dataset.label='Sort by';if(sortD)sortD.dataset.label='Order';
    const {adv,btn}=advancedToggle(card,[status,unit,source,sortF,sortD],'Filters');
    const reset=card.querySelector('.reset');
    if(reset){reset.className='crmLinkBtn';reset.textContent='Reset';}
    filters.append(btn);if(reset)filters.append(reset);if(ownerMore)filters.append(ownerMore);
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
    const card=v.querySelector('.card'),actions=card?.querySelector('.actionsRow');
    const find=(root,re)=>[...(root?.querySelectorAll('button')||[])].find(b=>re.test(b.textContent));
    let leadMore=null;
    if(btns){
      const add=find(btns,/Add Lead/i),exp=find(btns,/Export/i),sw=btns.querySelector('.viewSwitch');
      [...btns.querySelectorAll('button')].forEach(b=>{if(/Logout|Dashboard|Owner Database/i.test(b.textContent))b.remove();});
      if(sw)sw.classList.add('crmSeg');
      const mobileModes=['table','kanban'].map(mode=>{const b=document.createElement('button');b.type='button';b.dataset.mobileMode=mode;b.textContent=mode==='table'?'Table view':'Kanban view';b.onclick=()=>setLeadView(mode);return b;});
      if(add)add.id='crmAddLeadBtn';
      leadMore=moreMenu([add,...mobileModes,exp,find(actions,/Manage Projects/i),find(actions,/Manage Pipeline/i),find(actions,/Manage Columns/i)]);
    }
    // stage bar replaces the old quick-status chips (which still listed Contacted/Viewing)
    const quick=card.querySelector('.quickFilters');
    const bar=document.createElement('div');bar.id='crmStageBar';bar.className='crmStageBar';
    (quick||card.firstElementChild).before(bar);quick?.remove();
    const filters=card.querySelector('.filters');
    const st=$('leadStatusFilter');if(st)st.dataset.label='Status';
    const src=$('leadSourceFilter'),proj=$('leadProjectFilter'),fu=$('leadFollowUpFilter'),sf=$('leadSortField'),sd=$('leadSortDirection');
    if(src)src.dataset.label='Source';if(proj)proj.dataset.label='Project';if(fu)fu.dataset.label='Follow-up date';if(sf)sf.dataset.label='Sort by';if(sd)sd.dataset.label='Order';
    const {adv,btn}=advancedToggle(card,[st,src,proj,fu,sf,sd],'Filters');
    const reset=find(actions,/Reset/i);if(reset){reset.className='crmLinkBtn';reset.textContent='Reset';}
    filters.append(btn);if(reset)filters.append(reset);if(leadMore)filters.append(leadMore);filters.after(adv);
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
      const lead=(rows||[])[i],cell=tr.querySelector('td:not([data-col="select"])');
      if(!lead||!cell||cell.querySelector('.crmNext'))return;
      let html=''; // nothing under the name when no follow-up is set
      if(lead.follow_up_date){
        const when=new Date(`${lead.follow_up_date}T${lead.follow_up_time||'09:00'}`);
        const label=when.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+(lead.follow_up_time?' '+String(lead.follow_up_time).slice(0,5):'');
        html=`<span class="crmNext ${when<now?'late':''}">${when<now?'Overdue':'Next'}: ${esc(lead.reminder_type||'Follow-up')} · ${label}</span>`;
      }
      cell.insertAdjacentHTML('beforeend',html);
    });
  }

  // Fit the leads table to the screen: tag columns for CSS widths, drop the forced min-width,
  // full text on hover, WhatsApp as an icon (same link and click handler).
  function fitLeadsTable(){
    const table=document.querySelector('#leadsView .leadsTable');if(!table)return;
    table.classList.add('crmFitTable');table.style.minWidth='';
    const keys=[...table.querySelectorAll('thead th')].map(th=>th.dataset.key||(th.classList.contains('actionsSticky')?'actions':''));
    table.querySelectorAll('thead th').forEach((th,i)=>{th.dataset.col=keys[i];});
    table.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>{
      if(td.colSpan>1)return;
      td.dataset.col=keys[i]||'';
      const v=td.querySelector('.leadReadValue');if(v&&!v.title)v.title=v.textContent.trim();
      const n=td.querySelector('.leadLatestNote');if(n)n.title=n.textContent.trim();
      const wa=td.querySelector('a.waBtn');
      if(wa&&!wa.dataset.icon){wa.dataset.icon='1';wa.classList.add('crmWaIcon');wa.title='WhatsApp';wa.setAttribute('aria-label','WhatsApp');wa.innerHTML=WA_ICON;}
    }));
  }

  // ------------------------------------------------------------------ wire up
  if(typeof leadStatuses==='function'){window.leadStatuses=()=>[...STAGES];}
  try{if(typeof DEFAULT_PIPELINE_STAGES!=='undefined'){DEFAULT_PIPELINE_STAGES.splice(0,DEFAULT_PIPELINE_STAGES.length,...STAGES);}}catch(_){}
  const wrap=(name,after)=>{const base=window[name];if(typeof base!=='function')return;window[name]=async function(){const r=await base.apply(this,arguments);try{after(...arguments);}catch(e){console.warn(name,e);}return r;};};
  wrap('showOwnersView',()=>{upgradeOwners();tidyOwnerRows();});
  wrap('showLeadsView',()=>{upgradeLeads();paintStageBar();});
  // The owner table is redrawn by several layers; watch the table body instead of wrapping each one.
  const tb=$('tableBody');if(tb)new MutationObserver(()=>tidyOwnerRows()).observe(tb,{childList:true});
  if(typeof renderLeads==='function'){const base=renderLeads;renderLeads=function(rows){const r=base.apply(this,arguments);setTimeout(()=>{leadNextAction(rows);fitLeadsTable();},0);return r;};}
  // Render a preloaded page once after this workspace module installs.
  if(currentOwnerPageRows?.length)renderData(currentOwnerPageRows);
  // sidebar: log out lives with the profile
  const acts=document.querySelector('#v7Topbar .v7TopActions');
  if(acts&&!acts.querySelector('.crmLogout')){const b=document.createElement('button');b.type='button';b.className='crmLogout';b.textContent='Log out';b.onclick=()=>logout();acts.append(b);}
  if(!$('appView')?.classList.contains('hidden')){upgradeOwners();tidyOwnerRows();}
  if(!$('leadsView')?.classList.contains('hidden')){upgradeLeads();}
  const originalProfile=window.openV7ProfileSettings;
  window.openV7ProfileSettings=function(){
    if(isAdmin)return originalProfile();
    const wrap=document.createElement('div');wrap.className='crmModalScrim';
    wrap.innerHTML=`<section class="crmModal"><header><h2>My account</h2><button class="crmIconBtn" aria-label="Close">×</button></header><div class="crmModalBody"><strong>${esc(currentAccess?.name||'Agent')}</strong><p>${esc(currentUserEmail)}</p><button class="crmBtn" data-logout>Log out</button></div></section>`;
    document.body.append(wrap);wrap.querySelector('.crmIconBtn').onclick=()=>wrap.remove();wrap.querySelector('[data-logout]').onclick=()=>logout();
    wrap.onclick=e=>{if(e.target===wrap)wrap.remove();};
  };
  const primaryNav=document.querySelector('#v7Topbar .v7Nav');
  if(primaryNav&&!primaryNav.querySelector('.crmMobileLogout')){const b=document.createElement('button');b.type='button';b.className='crmMobileLogout';b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 4H4v16h5m5-12 4 4-4 4m-7-4h13"/></svg><span>Log out</span>';b.onclick=()=>logout();primaryNav.append(b);}
})();
