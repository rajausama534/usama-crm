(()=>{
  'use strict';
  // CRM upgrade layer: sidebar shell, live dashboard, user management, lead assignment,
  // owner transaction/ownership history. Every number and row comes from the database,
  // which only returns what the signed-in user is allowed to see (RLS).

  if(typeof db==='undefined')return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('en-US');
  const pct=(n,t)=>t?Math.round(n*100/t):0;
  const byName=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});

  const ICONS={
    grid:'<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    plus:'<path d="M12 5v14M5 12h14"/>'
  };
  const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // ------------------------------------------------------------------ shell
  function buildShell(){
    const bar=$('v7Topbar'),nav=bar?.querySelector('.v7Nav');
    if(!nav||nav.dataset.upgraded)return;
    nav.dataset.upgraded='1';
    const dash=document.createElement('button');
    dash.id='v7NavDashboard';dash.innerHTML=icon('grid')+'Dashboard';dash.onclick=()=>showDashboardView();
    nav.prepend(dash);
    const users=document.createElement('button');
    users.id='v7NavUsers';users.className='adminOnly';users.innerHTML=icon('users')+'Users';users.onclick=()=>showUsersView();
    nav.append(users);
    const toggle=document.createElement('button');
    toggle.className='crmMenuToggle';toggle.type='button';toggle.setAttribute('aria-label','Open menu');toggle.innerHTML=icon('menu');
    toggle.onclick=()=>document.body.classList.toggle('crmNavOpen');
    bar.prepend(toggle);
    const scrim=document.createElement('div');scrim.className='crmNavScrim';scrim.onclick=()=>document.body.classList.remove('crmNavOpen');
    document.body.append(scrim);
    nav.addEventListener('click',()=>document.body.classList.remove('crmNavOpen'));
    for(const id of ['dashboardView','usersView']){
      if($(id))continue;
      const v=document.createElement('div');v.id=id;v.className='wrap crmPage hidden';
      bar.after(v);
    }
    document.body.classList.add('crmPremium');
    if(typeof applyRoleUI==='function')applyRoleUI();
  }

  function setActive(id){
    document.querySelectorAll('#v7Topbar .v7Nav button').forEach(b=>b.classList.toggle('active',b.id===id));
  }
  for(const [fn,id] of [['showOwnersView','v7NavOwners'],['showLeadsView','v7NavLeads'],['showCalendarModule','v7NavCalendar']]){
    const base=window[fn];
    if(typeof base!=='function')continue;
    window[fn]=function(){setActive(id);document.body.classList.remove('crmNavOpen');return base.apply(this,arguments);};
  }

  // ------------------------------------------------------------------ dashboard
  const LEAD_STAGES=['New','Contacted','Call Back','No Response','Interested','Follow-Up','Viewing','Meeting Scheduled','Visit Done','Visited','Negotiation','Negotiating','Won','Closed','Converted','Lost','Not Interested'];
  const OWNER_ORDER=['For Sale','For Rent','Sold','Rented','Contacted','Call Back','No Response','Not Interested','Invalid Number','Agent','New','-'];

  function displayName(){
    const access=typeof currentAccess!=='undefined'?currentAccess:{};
    let saved={};try{saved=JSON.parse(localStorage.getItem('usama_crm_profile')||'{}');}catch(_){}
    return access?.name||saved.name||String(currentUserEmail||'').split('@')[0]||'there';
  }
  function greeting(){
    const h=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hour12:false,timeZone:'Asia/Dubai'}).format(new Date()));
    return h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  }
  function orderedEntries(obj,order){
    const entries=Object.entries(obj||{});
    const rank=k=>{const i=order.indexOf(k);return i<0?order.length:i;};
    return entries.sort((a,b)=>rank(a[0])-rank(b[0])||b[1]-a[1]);
  }
  function barList(entries,total,onClick){
    if(!entries.length)return '<div class="crmEmpty">Nothing to show yet.</div>';
    const max=Math.max(...entries.map(e=>e[1]),1);
    return `<div class="crmBars">${entries.map(([k,n])=>`
      <button type="button" class="crmBarRow" ${onClick?`data-key="${esc(k)}"`:'disabled'}>
        <span class="crmBarLabel">${esc(k==='-'?'Not set':k)}</span>
        <span class="crmBarTrack"><span class="crmBarFill" style="width:${Math.max(2,n*100/max)}%"></span></span>
        <span class="crmBarValue">${fmt(n)}<small>${pct(n,total)}%</small></span>
      </button>`).join('')}</div>`;
  }
  function weekChart(weeks){
    if(!weeks?.length)return '<div class="crmEmpty">No leads in the last 12 weeks.</div>';
    const max=Math.max(...weeks.map(w=>w.n),1),W=560,H=150,gap=8,bw=(W-gap*(weeks.length-1))/weeks.length;
    const bars=weeks.map((w,i)=>{const h=Math.max(3,(w.n/max)*(H-28));const x=i*(bw+gap);
      const label=new Date(w.week+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
      return `<g><title>Week of ${label}: ${w.n} leads</title><rect x="${x}" y="${H-18-h}" width="${bw}" height="${h}" rx="4"/>
        <text x="${x+bw/2}" y="${H-4}" text-anchor="middle">${i%2===0?label:''}</text></g>`;}).join('');
    return `<svg class="crmWeekChart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Leads per week">${bars}</svg>`;
  }
  function txList(items){
    if(!items.length)return '<div class="crmEmpty">No transactions yet.</div>';
    return `<ul class="crmTimeline">${items.map(t=>`<li><time>${new Date(t.when+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</time><strong>${esc(t.title)} — ${money(t.amount)}</strong><span>${esc(t.sub||'')}</span></li>`).join('')}</ul>`;
  }
  function kpi(label,value,hint,action){
    return `<button type="button" class="crmKpi" ${action?`data-action="${action}"`:'disabled'}><span class="crmKpiLabel">${esc(label)}</span><span class="crmKpiValue">${value}</span><span class="crmKpiHint">${esc(hint||'')}</span></button>`;
  }

  // Notes written by import scripts, not by people; kept out of "Recent activity".
  const SYSTEM_AUTHORS='dld-import,alana-repair';

  async function recentActivity(){
    const [o,l]=await Promise.all([
      db.from('owner_activities').select('id,owner_id,activity_type,details,created_at,created_by').or(`created_by.is.null,created_by.not.in.(${SYSTEM_AUTHORS})`).order('created_at',{ascending:false}).limit(8),
      db.from('lead_activities').select('id,lead_id,activity_type,details,created_at,created_by').order('created_at',{ascending:false}).limit(8)
    ]);
    const ownerIds=[...new Set((o.data||[]).map(a=>a.owner_id).filter(id=>/^\d+$/.test(id)))];
    const leadIds=[...new Set((l.data||[]).map(a=>a.lead_id).filter(Boolean))];
    const [owners,leads]=await Promise.all([
      ownerIds.length?db.from('owners').select('id,owner,community,cluster,unit').in('id',ownerIds):{data:[]},
      leadIds.length?db.from('leads').select('id,name').in('id',leadIds):{data:[]}
    ]);
    const om=new Map((owners.data||[]).map(r=>[String(r.id),r])),lm=new Map((leads.data||[]).map(r=>[String(r.id),r]));
    return [
      ...(o.data||[]).map(a=>{const r=om.get(String(a.owner_id));return {...a,kind:'Owner',who:r?`${r.owner||'Owner'} · ${r.cluster||''} ${r.unit||''}`:'Owner record',row:r};}),
      ...(l.data||[]).map(a=>{const r=lm.get(String(a.lead_id));return {...a,kind:'Lead',who:r?.name||'Lead',lead:r};})
    ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);
  }

  window.showDashboardView=async function(){
    buildShell();
    if(typeof applyRoleUI==='function')applyRoleUI();
    showOnly('dashboardView');setActive('v7NavDashboard');document.body.classList.remove('crmNavOpen');
    const v=$('dashboardView');
    const today=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Dubai'});
    v.innerHTML=`<header class="crmPageHead"><div><h1>${greeting()}, <strong>${esc(displayName())}</strong></h1><p>${esc(today)} · ${isAdmin?'Whole business overview':'Your assigned records'}</p></div>
      <div class="crmHeadActions"><button class="crmBtn" onclick="showOwnersView()">Owners</button><button class="crmBtn crmBtnPrimary" onclick="showLeadsView()">Leads</button></div></header>
      <div class="crmLoadingLine">Loading your numbers…</div>`;
    const t0=performance.now();
    const [{data:s,error},activity,verified,market]=await Promise.all([
      db.rpc('crm_dashboard_stats'),recentActivity().catch(()=>[]),
      db.from('property_transactions').select('community,cluster,unit,transaction_date,amount,area_sqft,area_type').order('transaction_date',{ascending:false}).limit(6),
      db.from('dld_transactions').select('crm_cluster,transaction_date,amount,area_sqft,rooms,property_sub_type,procedure',{count:'exact'}).gte('transaction_date',new Date(Date.now()-90*864e5).toISOString().slice(0,10)).order('transaction_date',{ascending:false}).limit(6)
    ]);
    if(error){v.querySelector('.crmLoadingLine').textContent='Could not load the dashboard: '+error.message;return;}
    const o=s.owners||{},L=s.leads||{},os=s.owner_status||{},ls=s.lead_status||{};
    const available=(os['For Sale']||0)+(os['For Rent']||0);
    const worked=(o.records||0)-(os['New']||0)-(os['-']||0);
    v.querySelector('.crmLoadingLine').remove();
    v.insertAdjacentHTML('beforeend',`
      <section class="crmSectionTitle"><h2>Owners &amp; inventory</h2></section>
      <div class="crmKpiGrid">
        ${kpi('Owner records',fmt(o.records),'Rows in the owner database','owners')}
        ${kpi('Units',fmt(o.units),'Distinct community / cluster / unit','owners')}
        ${kpi('Communities',fmt(o.communities),`${fmt(o.clusters)} clusters`,'owners')}
        ${kpi('Available',fmt(available),`${fmt(os['For Sale']||0)} for sale · ${fmt(os['For Rent']||0)} for rent`,'status:For Sale')}
        ${kpi('Contacted · 7 days',fmt(o.contacted_7d),`${fmt(o.contacted_30d)} in the last 30 days`,'owners')}
      </div>
      <section class="crmSectionTitle"><h2>Leads</h2></section>
      <div class="crmKpiGrid">
        ${kpi('Total leads',fmt(L.total),isAdmin?'All leads':'Assigned to you','leads')}
        ${kpi('New this week',fmt(L.new_7d),'Created in the last 7 days','leads')}
        ${kpi('Follow-ups today',fmt(L.followups_today),'Scheduled for today','leads')}
        ${kpi('Overdue follow-ups',fmt(L.followups_overdue),'Date has passed','leads')}
        ${kpi('Interested',fmt((ls['Interested']||0)+(ls['Viewing']||0)+(ls['Negotiation']||0)),'Interested, viewing or negotiating','leads')}
      </div>
      <div class="crmCardGrid">
        <article class="crmCard"><header><h3>Lead pipeline</h3><span>${fmt(L.total)} leads</span></header>${barList(orderedEntries(ls,LEAD_STAGES),L.total,true)}</article>
        <article class="crmCard"><header><h3>Owner status</h3><span>${fmt(worked)} worked · ${fmt((os['New']||0)+(os['-']||0))} not yet contacted</span></header>${barList(orderedEntries(Object.fromEntries(Object.entries(os).filter(([k])=>k!=='New'&&k!=='-')),OWNER_ORDER),worked,true)}</article>
        <article class="crmCard"><header><h3>New leads per week</h3><span>Last 12 weeks</span></header>${weekChart(s.leads_by_week)}</article>
        <article class="crmCard"><header><h3>Owners by community</h3><span>A–Z</span></header>${barList(Object.entries(s.owners_by_community||{}).sort((a,b)=>byName(a[0],b[0])),o.records,false)}</article>
        <article class="crmCard crmCardWide"><header><h3>Recent activity</h3><span>Owners and leads</span></header>
          ${activity.length?`<ul class="crmActivity">${activity.map(a=>`<li><span class="crmTag ${a.kind==='Lead'?'crmTagLead':''}">${a.kind}</span><div><strong>${esc(a.who)}</strong><p>${esc(a.activity_type||'')}${a.details?` — ${esc(String(a.details).slice(0,140))}`:''}</p></div><time>${new Date(a.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></li>`).join('')}</ul>`:'<div class="crmEmpty">No activity yet.</div>'}
        </article>
        <article class="crmCard"><header><h3>Recent verified sales</h3><span>Matched to a unit with DLD</span></header>${txList((verified.data||[]).map(t=>({when:t.transaction_date,title:`${t.cluster} ${t.unit}`,amount:t.amount,sub:t.area_sqft?`${fmt(t.area_sqft)} sq ft${t.area_type==='plot'?' plot':''}`:''})))}</article>
        <article class="crmCard"><header><h3>Latest DLD sales</h3><span>${fmt(market.count||0)} in your clusters · last 90 days</span></header>${txList((market.data||[]).map(t=>({when:t.transaction_date,title:`${t.crm_cluster}${t.rooms?' · '+t.rooms:''}`,amount:t.amount,sub:[t.area_sqft?`${fmt(t.area_sqft)} sq ft`:'',t.procedure].filter(Boolean).join(' · ')})))}</article>
        <article class="crmCard"><header><h3>Lead sources</h3><span>Where leads come from</span></header>${barList(Object.entries(s.lead_source||{}).sort((a,b)=>b[1]-a[1]),L.total,false)}</article>
      </div>
      <p class="crmFootnote">Loaded in ${Math.round(performance.now()-t0)} ms · figures include only records you are allowed to see.</p>`);
    v.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
      const a=b.dataset.action;
      if(a==='leads')return showLeadsView();
      if(a.startsWith('status:'))return showOwnersView().then(()=>quickStatus(a.slice(7)));
      showOwnersView();
    });
    v.querySelectorAll('.crmCard').forEach(card=>{
      const title=card.querySelector('h3')?.textContent;
      card.querySelectorAll('.crmBarRow[data-key]').forEach(row=>row.onclick=async()=>{
        const key=row.dataset.key;
        if(title==='Lead pipeline'){await showLeadsView();const f=$('leadStatusFilter');if(f){if(![...f.options].some(o=>o.value===key))f.add(new Option(key,key));f.value=key;leadPage=0;loadLeads();}}
        else {await showOwnersView();quickStatus(key==='-'?'':key);}
      });
    });
  };

  // ------------------------------------------------------------------ users (admin)
  let filterOptions=null;
  async function locationOptions(){
    if(filterOptions)return filterOptions;
    const {data,error}=await db.rpc('crm_filter_options');
    if(error)throw error;
    const map=new Map();
    for(const r of data||[]){
      if(!r.community)continue;
      if(!map.has(r.community))map.set(r.community,new Map());
      if(r.cluster){const m=map.get(r.community);m.set(r.cluster,(m.get(r.cluster)||0)+Number(r.records||0));}
    }
    filterOptions=[...map.entries()].sort((a,b)=>byName(a[0],b[0])).map(([community,clusters])=>({community,clusters:[...clusters.entries()].sort((a,b)=>byName(a[0],b[0]))}));
    return filterOptions;
  }
  const callAdmin=async body=>{
    const {data,error}=await db.functions.invoke('admin-users',{body});
    if(error){let msg=error.message;try{msg=(await error.context.json()).error||msg;}catch(_){}throw new Error(msg);}
    if(data?.error)throw new Error(data.error);
    return data;
  };
  function accessSummary(u){
    if(u.role==='admin')return 'Full access';
    const parts=[...(u.assigned_communities||[]).map(c=>`${c} (all clusters)`),...(u.assigned_clusters||[]).map(c=>c.replace('::',' › '))];
    return parts.length?parts.join(', '):'No owner access';
  }

  window.showUsersView=async function(){
    if(!isAdmin)return showDashboardView();
    buildShell();showOnly('usersView');setActive('v7NavUsers');
    const v=$('usersView');
    v.innerHTML=`<header class="crmPageHead"><div><h1>Users</h1><p>Create logins and choose exactly which communities, clusters and leads each person can see.</p></div>
      <div class="crmHeadActions"><button class="crmBtn crmBtnPrimary" id="crmAddUserBtn">${icon('plus')}Add New User</button></div></header>
      <div id="crmUsersList" class="crmCard"><div class="crmLoadingLine">Loading users…</div></div>`;
    $('crmAddUserBtn').onclick=()=>openUserEditor(null);
    try{
      const {users}=await callAdmin({action:'list'});
      const leadCounts=await db.from('leads').select('assigned_to').not('assigned_to','is',null);
      const counts={};(leadCounts.data||[]).forEach(r=>{const k=String(r.assigned_to).toLowerCase();counts[k]=(counts[k]||0)+1;});
      $('crmUsersList').innerHTML=users.length?`<div class="crmTableWrap"><table class="crmTable"><thead><tr><th>Name</th><th>Role</th><th>Owner access</th><th>Leads</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${users.map(u=>`<tr>
          <td data-label="Name"><strong>${esc(u.name||u.email.split('@')[0])}</strong><span class="crmSub">${esc(u.email)}</span></td>
          <td data-label="Role"><span class="crmTag">${u.role==='admin'?'Admin':'Agent'}</span></td>
          <td data-label="Owner access" class="crmAccessCell">${esc(accessSummary(u))}</td>
          <td data-label="Leads">${fmt(counts[String(u.email).toLowerCase()]||0)}</td>
          <td data-label="Status"><span class="crmStatus ${u.active?'on':'off'}">${u.active?'Active':'Deactivated'}</span>${u.has_login?'':'<span class="crmSub">No login yet</span>'}</td>
          <td data-label="Last sign-in">${u.last_sign_in_at?new Date(u.last_sign_in_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Never'}</td>
          <td><div class="crmRowActions">${String(u.email).toLowerCase()===ADMIN_EMAIL?'<span class="crmSub">Owner account</span>':`
            <button class="crmBtn crmBtnSm" data-edit="${esc(u.email)}">Edit</button>
            ${u.has_login?`<button class="crmBtn crmBtnSm" data-pass="${esc(u.email)}">Set password</button>`:''}
            <button class="crmBtn crmBtnSm ${u.active?'crmBtnDanger':''}" data-toggle="${esc(u.email)}" data-active="${u.active?1:0}">${u.active?'Deactivate':'Reactivate'}</button>`}</div></td>
        </tr>`).join('')}</tbody></table></div>`:'<div class="crmEmpty">No users yet.</div>';
      const find=email=>users.find(u=>u.email===email);
      $('crmUsersList').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openUserEditor(find(b.dataset.edit)));
      $('crmUsersList').querySelectorAll('[data-pass]').forEach(b=>b.onclick=()=>openPasswordEditor(b.dataset.pass));
      $('crmUsersList').querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{
        // Deactivation is reversible with Reactivate, so it does not need a blocking confirm dialog.
        const deactivate=b.dataset.active==='1';
        b.disabled=true;
        try{await callAdmin({action:deactivate?'deactivate':'reactivate',email:b.dataset.toggle});showUsersView();}
        catch(e){b.disabled=false;toast(e.message,true);}
      });
    }catch(e){$('crmUsersList').innerHTML=`<div class="crmEmpty">Could not load users: ${esc(e.message)}</div>`;}
  };

  function modal(title,bodyHtml,submitLabel){
    const wrap=document.createElement('div');
    wrap.className='crmModalScrim';
    wrap.innerHTML=`<form class="crmModal" novalidate><header><h2>${esc(title)}</h2><button type="button" class="crmIconBtn" data-close aria-label="Close">×</button></header>
      <div class="crmModalBody">${bodyHtml}</div><p class="crmFormError" hidden></p>
      <footer><button type="button" class="crmBtn" data-close>Cancel</button><button type="submit" class="crmBtn crmBtnPrimary">${esc(submitLabel)}</button></footer></form>`;
    wrap.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>wrap.remove());
    wrap.addEventListener('click',e=>{if(e.target===wrap)wrap.remove();});
    document.body.append(wrap);
    return wrap;
  }
  function toast(msg,isError){
    const t=document.createElement('div');t.className='crmToast'+(isError?' crmToastError':'');t.textContent=msg;
    document.body.append(t);setTimeout(()=>t.remove(),4200);
  }

  async function openUserEditor(user){
    const isNew=!user;
    const options=await locationOptions().catch(()=>[]);
    const comms=new Set(user?.assigned_communities||[]),clus=new Set(user?.assigned_clusters||[]);
    const w=modal(isNew?'Add new user':`Edit ${user.name||user.email}`,`
      <div class="crmFormGrid">
        <label>Name<input name="name" value="${esc(user?.name||'')}" autocomplete="off" required></label>
        <label>Email<input name="email" type="email" value="${esc(user?.email||'')}" ${isNew?'':'disabled'} autocomplete="off" required></label>
        ${isNew?'<label>Initial password<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" required></label>':''}
        <label>Role<select name="role"><option value="agent">Agent — only assigned data</option><option value="admin" ${user?.role==='admin'?'selected':''}>Admin — full access</option></select></label>
        <label class="crmCheck"><input type="checkbox" name="can_export" ${user?.can_export?'checked':''}> Can export CSV</label>
      </div>
      <div class="crmAccessPicker" ${user?.role==='admin'?'hidden':''}>
        <h4>Owner access</h4><p class="crmSub">Tick "All clusters" for a whole community, or pick clusters one by one. Leads are assigned separately from the Leads page.</p>
        <input class="crmAccessSearch" placeholder="Filter communities or clusters…">
        ${options.map(({community,clusters})=>`<details class="crmCommunity" ${comms.has(community)||clusters.some(([c])=>clus.has(`${community}::${c}`)||clus.has(c))?'open':''}>
          <summary><span>${esc(community)}</span><label class="crmCheck" onclick="event.stopPropagation()"><input type="checkbox" data-all="${esc(community)}" ${comms.has(community)?'checked':''}> All clusters</label></summary>
          <div class="crmClusterGrid">${clusters.map(([c,n])=>`<label class="crmCheck" data-filter="${esc((community+' '+c).toLowerCase())}"><input type="checkbox" data-cluster="${esc(community)}::${esc(c)}" ${clus.has(`${community}::${c}`)||clus.has(c)?'checked':''} ${comms.has(community)?'disabled':''}> ${esc(c)} <small>${fmt(n)}</small></label>`).join('')}</div>
        </details>`).join('')}
      </div>`,isNew?'Create user':'Save changes');
    const form=w.querySelector('form');
    form.role.onchange=()=>w.querySelector('.crmAccessPicker').hidden=form.role.value==='admin';
    w.querySelectorAll('[data-all]').forEach(box=>box.onchange=()=>{
      box.closest('details').querySelectorAll('[data-cluster]').forEach(c=>{c.disabled=box.checked;if(box.checked)c.checked=false;});
    });
    w.querySelector('.crmAccessSearch')?.addEventListener('input',e=>{
      const q=e.target.value.trim().toLowerCase();
      w.querySelectorAll('.crmCommunity').forEach(d=>{
        let any=false;d.querySelectorAll('[data-filter]').forEach(l=>{const hit=!q||l.dataset.filter.includes(q);l.hidden=!hit;any=any||hit;});
        d.hidden=!any;if(q&&any)d.open=true;
      });
    });
    form.onsubmit=async e=>{
      e.preventDefault();
      const err=w.querySelector('.crmFormError');err.hidden=true;
      const body={
        action:isNew?'create':'save',name:form.name.value.trim(),email:(isNew?form.email.value:user.email).trim().toLowerCase(),
        role:form.role.value,can_export:form.can_export.checked,
        assigned_communities:[...w.querySelectorAll('[data-all]:checked')].map(b=>b.dataset.all),
        assigned_clusters:[...w.querySelectorAll('[data-cluster]:checked:not(:disabled)')].map(b=>b.dataset.cluster)
      };
      if(isNew)body.password=form.password.value;
      if(!body.name||!body.email){err.textContent='Name and email are required.';err.hidden=false;return;}
      if(isNew&&String(body.password).length<8){err.textContent='The initial password must be at least 8 characters.';err.hidden=false;return;}
      const btn=form.querySelector('[type=submit]');btn.disabled=true;btn.textContent='Saving…';
      try{await callAdmin(body);w.remove();toast(isNew?'User created':'Changes saved');showUsersView();}
      catch(x){err.textContent=x.message;err.hidden=false;btn.disabled=false;btn.textContent=isNew?'Create user':'Save changes';}
    };
  }

  function openPasswordEditor(email){
    const w=modal('Set a new password',`<p class="crmSub">For ${esc(email)}. Share it with them privately; it is not shown again.</p>
      <label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>`,'Set password');
    const form=w.querySelector('form');
    form.onsubmit=async e=>{
      e.preventDefault();
      const err=w.querySelector('.crmFormError');
      if(form.password.value.length<8){err.textContent='At least 8 characters.';err.hidden=false;return;}
      try{await callAdmin({action:'set_password',email,password:form.password.value});w.remove();toast('Password updated');}
      catch(x){err.textContent=x.message;err.hidden=false;}
    };
  }

  // ------------------------------------------------------------------ lead assignment (admin)
  let assignees=null;
  async function loadAssignees(){
    if(!isAdmin)return [];
    if(assignees)return assignees;
    const {data}=await db.from('user_access').select('email,name,role,active').order('email');
    assignees=(data||[]).filter(u=>u.active!==false&&String(u.email).toLowerCase()!==ADMIN_EMAIL);
    return assignees;
  }
  const assigneeLabel=email=>{const u=(assignees||[]).find(a=>String(a.email).toLowerCase()===String(email||'').toLowerCase());return u?(u.name||u.email):(email||'');};

  async function addAssigneeField(row){
    if(!isAdmin)return;
    const status=$('form_status');if(!status)return;
    let field=$('form_assigned_to');
    if(!field){
      const holder=document.createElement('div');
      holder.innerHTML='<label>Assigned to</label><select id="form_assigned_to"></select>';
      status.closest('div').after(holder);field=$('form_assigned_to');
    }
    const list=await loadAssignees();
    field.innerHTML='<option value="">Not assigned (admin only)</option>'+list.map(u=>`<option value="${esc(u.email)}">${esc(u.name||u.email)}</option>`).join('');
    field.value=row?.assigned_to||'';
  }
  if(typeof openLeadModal==='function'){
    const base=openLeadModal;
    openLeadModal=function(row=null){const r=base.apply(this,arguments);addAssigneeField(row);return r;};
  }

  async function addLeadAssigneeFilter(){
    if(!isAdmin||$('leadAssigneeFilter'))return;
    const status=$('leadStatusFilter');if(!status)return;
    const sel=document.createElement('select');sel.id='leadAssigneeFilter';
    status.after(sel);
    const list=await loadAssignees();
    sel.innerHTML='<option value="">All assignees</option><option value="__none">Not assigned</option>'+list.map(u=>`<option value="${esc(u.email)}">${esc(u.name||u.email)}</option>`).join('');
    sel.onchange=()=>{leadPage=0;loadLeads();};
  }
  if(typeof applyLeadFilters==='function'){
    const base=applyLeadFilters;
    applyLeadFilters=function(q){
      q=base.call(this,q);
      const v=$('leadAssigneeFilter')?.value;
      if(v==='__none')q=q.is('assigned_to',null);else if(v)q=q.eq('assigned_to',v);
      return q;
    };
  }
  if(typeof showLeadsView==='function'){
    const base=window.showLeadsView;
    window.showLeadsView=async function(){const r=await base.apply(this,arguments);addLeadAssigneeFilter();return r;};
  }
  // Show the assignee under the lead name in the table.
  if(typeof renderLeads==='function'){
    const base=renderLeads;
    renderLeads=function(rows){
      const r=base.apply(this,arguments);
      if(isAdmin)loadAssignees().then(()=>{
        const body=$('leadsTableBody');if(!body)return;
        [...body.querySelectorAll('tr')].forEach((tr,i)=>{
          const lead=(rows||[])[i];const cell=tr.querySelector('td');
          if(!lead||!cell||cell.querySelector('.crmAssignee'))return;
          cell.insertAdjacentHTML('beforeend',`<span class="crmAssignee ${lead.assigned_to?'':'none'}">${lead.assigned_to?'→ '+esc(assigneeLabel(lead.assigned_to)):'Not assigned'}</span>`);
        });
      });
      return r;
    };
  }

  // ------------------------------------------------------------------ owner profile: transactions + ownership history
  const money=n=>{const v=Number(n);return v>=1e6?`AED ${String(Number((v/1e6).toFixed(2)))}M`:`AED ${fmt(v)}`;};
  const longDate=d=>new Date(d+(String(d).length===10?'T00:00:00':'')).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  async function enrichProfile(row){
    const left=document.querySelector('#profileContent .u6DetailLeft');
    if(!left||!row||left.querySelector('.crmHistory'))return;
    const box=document.createElement('div');box.className='crmHistory';
    box.innerHTML='<article class="crmCard"><header><h3>Transaction history</h3></header><div class="crmLoadingLine">Loading…</div></article><article class="crmCard"><header><h3>Ownership history</h3></header><div class="crmLoadingLine">Loading…</div></article>';
    left.append(box);
    const [tx,same,changes]=await Promise.all([
      db.from('property_transactions').select('*').eq('community',row.community).eq('cluster',row.cluster).eq('unit',row.unit).order('transaction_date',{ascending:false}),
      db.from('owners').select('id,owner,phone1,status,data_source').eq('community',row.community).eq('cluster',row.cluster).eq('unit',row.unit).neq('id',row.id),
      db.from('crm_change_log').select('changed_at,changed_by,old_row,new_row,action').eq('table_name','owners').eq('row_id',String(row.id)).order('changed_at',{ascending:false}).limit(20)
    ]);
    const [txCard,ownCard]=box.querySelectorAll('.crmCard');
    txCard.querySelector('.crmLoadingLine').outerHTML=tx.error?'<div class="crmEmpty">Transaction history is not available yet.</div>':(tx.data||[]).length?
      `<ul class="crmTimeline">${tx.data.map(t=>`<li><time>${longDate(t.transaction_date)}</time><strong>${esc(t.kind||'Sold')} ${money(t.amount)}</strong><span>${t.area_sqft?`${fmt(t.area_sqft)} sq ft${t.area_type==='plot'?' plot':''}`:''}${t.dld_transaction_number?` · DLD ${esc(t.dld_transaction_number)}`:''}</span></li>`).join('')}</ul>`:
      '<div class="crmEmpty">No verified transactions for this unit.</div>';
    const items=[];
    for(const c of changes.data||[]){
      const o=c.old_row||{},n=c.new_row||{};
      if(n.owner!==undefined&&o.owner!==n.owner)items.push(`<li><time>${longDate(c.changed_at)}</time><strong>Owner changed</strong><span>${esc(o.owner||'-')} → ${esc(n.owner||'-')}</span></li>`);
      else if(o.phone1!==n.phone1||o.phone2!==n.phone2)items.push(`<li><time>${longDate(c.changed_at)}</time><strong>Contact updated</strong><span>Previous: ${esc([o.phone1,o.phone2].filter(Boolean).join(', ')||'-')}</span></li>`);
      else if(o.status!==n.status)items.push(`<li><time>${longDate(c.changed_at)}</time><strong>Status ${esc(o.status||'-')} → ${esc(n.status||'-')}</strong><span>${esc(c.changed_by||'')}</span></li>`);
    }
    const others=(same.data||[]).map(r=>`<li><time>Same unit</time><strong>${esc(r.owner||'-')}</strong><span>${esc([r.status,r.data_source].filter(Boolean).join(' · '))}</span></li>`);
    ownCard.querySelector('.crmLoadingLine').outerHTML=(items.length||others.length)?`<ul class="crmTimeline">${items.join('')}${others.join('')}</ul>`:'<div class="crmEmpty">No other owners or earlier changes recorded for this unit.</div>';
  }
  if(typeof openOwnerProfile==='function'){
    const base=window.openOwnerProfile;
    window.openOwnerProfile=async function(row){const r=await base.apply(this,arguments);enrichProfile(row).catch(e=>console.warn('Profile history failed',e));return r;};
  }

  // ------------------------------------------------------------------ search: wait for typing to pause
  const search=$('searchInput');
  if(search&&!search.dataset.debounced){
    search.dataset.debounced='1';
    let timer;
    search.addEventListener('input',e=>{e.stopImmediatePropagation();clearTimeout(timer);timer=setTimeout(()=>{currentPage=0;loadData();},300);},true);
  }

  buildShell();
  // This script loads after login; replace the old launcher if it is on screen.
  if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&$('choiceView')&&!$('choiceView').classList.contains('hidden'))showDashboardView();
})();
