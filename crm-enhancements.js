(()=>{
  const VERSION='20260722-6';
  const textOf=e=>(e?.textContent||'').trim().toLowerCase();
  const normalizeStatus=t=>String(t||'').trim().toLowerCase().replace(/\s+/g,' ');
  const pipelineOrder=['new','contacted','call back','interested','viewing','visit done','negotiation','won','lost'];
  let uiRefreshQueued=false;
  let badgeLoading=false;
  let taskQueueLoading=false;

  function calendarUrl(){return `calendar.html?v=${VERSION}&t=${Date.now()}`}
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  function fmtDateTime(v){return new Date(v).toLocaleString('en-AE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:true})}

  document.addEventListener('click',e=>{
    const target=e.target.closest('a,button');
    if(!target)return;
    const label=textOf(target).replace(/\d+/g,'').trim();
    if(label==='calendar'||target.getAttribute('data-module')==='calendar'){
      e.preventDefault();e.stopImmediatePropagation();location.href=calendarUrl();
    }
  },true);

  function calendarTargets(){
    return [...document.querySelectorAll('a,button,div')].filter(x=>{
      const t=textOf(x).replace(/\d+/g,'').trim();
      return t==='calendar'&&x.children.length<8;
    });
  }

  async function updateCalendarBadge(){
    if(badgeLoading||typeof db==='undefined')return;
    badgeLoading=true;
    try{
      const now=new Date(),start=new Date(now),end=new Date(now);
      start.setHours(0,0,0,0);end.setHours(23,59,59,999);
      const [l,o]=await Promise.all([
        db.from('lead_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%'),
        db.from('owner_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%')
      ]);
      const count=(l.count||0)+(o.count||0);
      calendarTargets().forEach(target=>{
        let badge=target.querySelector(':scope > .crmCalendarBadge');
        if(!badge){badge=document.createElement('span');badge.className='crmCalendarBadge';target.style.position='relative';target.appendChild(badge)}
        badge.textContent=count>99?'99+':String(count);badge.style.display=count?'inline-flex':'none';
      });
    }catch(error){console.warn('Calendar badge:',error)}finally{badgeLoading=false}
  }

  function styleAndOrderPipeline(){
    const candidates=[...document.querySelectorAll('button,a,[role="button"]')].filter(el=>pipelineOrder.includes(normalizeStatus(el.textContent)));
    candidates.forEach(el=>{const key=normalizeStatus(el.textContent).replace(/\s+/g,'-');if(el.dataset.crmStatus!==key)el.dataset.crmStatus=key});
    const parents=[...new Set(candidates.map(el=>el.parentElement).filter(Boolean))];
    parents.forEach(parent=>{
      const direct=[...parent.children].filter(el=>pipelineOrder.includes(normalizeStatus(el.textContent)));
      if(direct.length<5)return;
      const sorted=[...direct].sort((a,b)=>pipelineOrder.indexOf(normalizeStatus(a.textContent))-pipelineOrder.indexOf(normalizeStatus(b.textContent)));
      if(!direct.every((el,index)=>el===sorted[index]))sorted.forEach(el=>parent.appendChild(el));
      parent.classList.add('crmPipelineOrdered');
    });
  }

  function addScheduleEditLinks(){
    const nodes=[...document.querySelectorAll('div,li,article')].filter(n=>{const t=(n.innerText||'').trim();return t.startsWith('Scheduled:')&&t.length<700&&!n.dataset.crmScheduleLinked});
    nodes.forEach(n=>{
      n.dataset.crmScheduleLinked='1';
      const btn=document.createElement('button');btn.type='button';btn.className='crmEditScheduleBtn';btn.textContent='Edit date / time';
      btn.onclick=ev=>{ev.preventDefault();ev.stopPropagation();location.href=calendarUrl()};n.appendChild(btn);
    });
  }

  function findReminderRoot(){
    const heading=[...document.querySelectorAll('h1,h2,h3,h4,div')].find(x=>['follow-up reminders','follow-up tasks'].includes(textOf(x)));
    if(!heading)return null;
    let node=heading;
    for(let i=0;i<7&&node;i++,node=node.parentElement){
      const t=(node.innerText||'').toLowerCase();
      if((t.includes('overdue')&&t.includes('next 7 days'))||node.dataset.crmTaskQueue)return node;
    }
    return heading.parentElement;
  }

  function manualEvents(){try{return JSON.parse(localStorage.getItem('usama_crm_manual_events')||'[]')}catch{return[]}}
  function saveManualEvents(rows){localStorage.setItem('usama_crm_manual_events',JSON.stringify(rows))}

  window.crmCompleteCalendarTask=async(table,id,type)=>{
    if(!confirm('Mark this overdue item as done?'))return;
    if(table==='manual'){
      saveManualEvents(manualEvents().filter(x=>String(x.id)!==String(id)));
    }else{
      const cleanType=String(type||'Event').replace(/^Scheduled:\s*/,'');
      const {error}=await db.from(table).update({activity_type:`Completed: ${cleanType}`}).eq('id',id);
      if(error){alert(error.message);return}
    }
    await loadFollowupQueue();updateCalendarBadge();
  };

  function taskRow(e,overdue){
    return `<div class="crmSimpleTask ${overdue?'overdue':'coming'}"><div class="crmSimpleWhen"><strong>${esc(fmtDateTime(e.when))}</strong><span>${overdue?'Overdue':'Coming up'}</span></div><div class="crmSimpleMain"><strong>${esc(e.type)} — ${esc(e.name)}</strong><span>${esc(e.detail||'')}</span></div><div class="crmSimpleActions"><a href="${calendarUrl()}">Open</a>${overdue?`<button class="done" onclick="window.crmCompleteCalendarTask('${esc(e.table)}','${esc(e.id)}','${esc(e.type)}')">Done</button>`:''}</div></div>`;
  }

  async function loadFollowupQueue(){
    if(taskQueueLoading||typeof db==='undefined')return;
    const root=findReminderRoot();if(!root)return;
    taskQueueLoading=true;root.dataset.crmTaskQueue='1';
    root.innerHTML=`<div class="crmSimpleHeader"><div><h2>Calendar Tasks</h2><p>Overdue items and upcoming events.</p></div><button id="crmSimpleRefresh">Refresh</button></div><div class="crmTaskLoading">Loading calendar tasks…</div>`;
    root.querySelector('#crmSimpleRefresh').onclick=loadFollowupQueue;
    try{
      const now=new Date();
      const start=new Date(now);start.setMonth(start.getMonth()-3);
      const end=new Date(now);end.setMonth(end.getMonth()+6);
      const [la,oa]=await Promise.all([
        db.from('lead_activities').select('*').gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%').order('created_at'),
        db.from('owner_activities').select('*').gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%').order('created_at')
      ]);
      if(la.error||oa.error)throw(la.error||oa.error);
      const leadActs=la.data||[],ownerActs=oa.data||[];
      const leadIds=[...new Set(leadActs.map(x=>x.lead_id).filter(Boolean))];
      const ownerIds=[...new Set(ownerActs.map(x=>x.owner_id).filter(Boolean))];
      const [lm,om]=await Promise.all([
        leadIds.length?db.from('leads').select('id,name,project_inquired').in('id',leadIds):Promise.resolve({data:[]}),
        ownerIds.length?db.from('owners').select('id,owner,community,cluster,unit').in('id',ownerIds):Promise.resolve({data:[]})
      ]);
      const leadMap=Object.fromEntries((lm.data||[]).map(x=>[String(x.id),x]));
      const ownerMap=Object.fromEntries((om.data||[]).map(x=>[String(x.id),x]));
      const events=[
        ...leadActs.map(a=>{const p=leadMap[String(a.lead_id)]||{};return{id:a.id,table:'lead_activities',when:a.created_at,type:String(a.activity_type||'').replace('Scheduled: ','')||'Event',name:p.name||'Lead',detail:[p.project_inquired,a.details].filter(Boolean).join(' · ')}}),
        ...ownerActs.map(a=>{const p=ownerMap[String(a.owner_id)]||{};return{id:a.id,table:'owner_activities',when:a.created_at,type:String(a.activity_type||'').replace('Scheduled: ','')||'Event',name:p.owner||'Owner',detail:[p.community,p.cluster,p.unit?`Unit ${p.unit}`:'',a.details].filter(Boolean).join(' · ')}}),
        ...manualEvents().map(a=>({id:a.id,table:'manual',when:a.when,type:a.type||'Event',name:a.name||'Manual',detail:[a.title,a.details||a.location].filter(Boolean).join(' · ')}))
      ].sort((a,b)=>new Date(a.when)-new Date(b.when));
      const overdue=events.filter(e=>new Date(e.when)<now);
      const coming=events.filter(e=>new Date(e.when)>=now);
      root.innerHTML=`<div class="crmSimpleHeader"><div><h2>Calendar Tasks</h2><p>${overdue.length} overdue · ${coming.length} coming up</p></div><button id="crmSimpleRefresh">Refresh</button></div><div class="crmSimpleColumns"><section><div class="crmSimpleTitle overdueTitle"><span>Overdue</span><b>${overdue.length}</b></div><div class="crmSimpleList">${overdue.length?overdue.slice(0,8).map(e=>taskRow(e,true)).join(''):'<div class="crmTaskEmpty">No overdue items.</div>'}</div></section><section><div class="crmSimpleTitle comingTitle"><span>Coming Up</span><b>${coming.length}</b></div><div class="crmSimpleList">${coming.length?coming.slice(0,8).map(e=>taskRow(e,false)).join(''):'<div class="crmTaskEmpty">No upcoming events.</div>'}</div></section></div>`;
      root.querySelector('#crmSimpleRefresh').onclick=loadFollowupQueue;
    }catch(error){
      root.innerHTML=`<div class="crmSimpleHeader"><div><h2>Calendar Tasks</h2><p>Could not load calendar events.</p></div><button id="crmSimpleRefresh">Retry</button></div><div class="crmTaskError">${esc(error.message||error)}</div>`;
      root.querySelector('#crmSimpleRefresh').onclick=loadFollowupQueue;
    }finally{taskQueueLoading=false}
  }

  function queueUiRefresh(){
    if(uiRefreshQueued)return;uiRefreshQueued=true;
    requestAnimationFrame(()=>{uiRefreshQueued=false;addScheduleEditLinks();styleAndOrderPipeline();const root=findReminderRoot();if(root&&!root.dataset.crmTaskQueue)loadFollowupQueue()});
  }

  const observer=new MutationObserver(queueUiRefresh);observer.observe(document.documentElement,{subtree:true,childList:true});
  queueUiRefresh();setTimeout(updateCalendarBadge,1500);setTimeout(loadFollowupQueue,1800);setInterval(updateCalendarBadge,60000);setInterval(loadFollowupQueue,120000);
})();