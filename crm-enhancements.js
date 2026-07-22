(()=>{
  const VERSION='20260722-8';
  const textOf=e=>(e?.textContent||'').trim().toLowerCase();
  const normalizeStatus=t=>String(t||'').trim().toLowerCase().replace(/\s+/g,' ');
  const pipelineOrder=['new','contacted','call back','interested','viewing','visit done','negotiation','won','lost'];
  let uiRefreshQueued=false;
  let badgeLoading=false;
  let reminderLoading=false;

  function calendarUrl(range=''){const q=range?`&range=${encodeURIComponent(range)}`:'';return `calendar.html?v=${VERSION}&t=${Date.now()}${q}`}
  function dayStart(d){const x=new Date(d);x.setHours(0,0,0,0);return x}
  function dayEnd(d){const x=new Date(d);x.setHours(23,59,59,999);return x}

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
      const now=new Date(),start=dayStart(now),end=dayEnd(now);
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
    const heading=[...document.querySelectorAll('h1,h2,h3,h4,div')].find(x=>['follow-up reminders','follow-up tasks','calendar tasks'].includes(textOf(x)));
    if(!heading)return null;
    let node=heading;
    for(let i=0;i<9&&node;i++,node=node.parentElement){
      const t=(node.innerText||'').toLowerCase();
      if(node.dataset.crmReminderSummary)return node;
      if(t.includes('follow-up reminders')&&t.includes('overdue')&&t.includes('next 7 days'))return node;
    }
    return heading.parentElement;
  }

  function hideLegacyReminderUi(root){
    const legacyPattern=/^(overdue|today|next\s*7\s*days)\s*:\s*\d+/i;
    [...document.querySelectorAll('div,section,article')].forEach(node=>{
      if(root&&root.contains(node))return;
      const own=(node.childNodes.length===1?node.textContent:(node.firstChild?.textContent||'')).trim();
      if(!legacyPattern.test(own))return;
      let card=node;
      for(let i=0;i<4&&card.parentElement;i++){
        const txt=(card.innerText||'').trim();
        if(txt.length<160&&/(nothing due|overdue|today|next 7 days)/i.test(txt))card=card.parentElement;
        else break;
      }
      card.style.display='none';
      card.dataset.crmLegacyReminderHidden='1';
    });
    [...document.querySelectorAll('button')].forEach(btn=>{
      if(root&&root.contains(btn))return;
      if(textOf(btn)!=='refresh')return;
      const area=btn.closest('section,article,div');
      if(area&&/follow-up reminders|overdue|next 7 days/i.test(area.innerText||''))btn.style.display='none';
    });
  }

  function manualEvents(){try{return JSON.parse(localStorage.getItem('usama_crm_manual_events')||'[]')}catch{return[]}}

  async function countScheduled(start,end){
    const [l,o]=await Promise.all([
      db.from('lead_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%'),
      db.from('owner_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%')
    ]);
    if(l.error||o.error)throw(l.error||o.error);
    const manual=manualEvents().filter(e=>{const d=new Date(e.when);return d>=start&&d<=end}).length;
    return (l.count||0)+(o.count||0)+manual;
  }

  async function loadReminderSummary(){
    if(reminderLoading||typeof db==='undefined')return;
    const root=findReminderRoot();if(!root)return;
    reminderLoading=true;root.dataset.crmReminderSummary='1';
    root.innerHTML='<div class="crmReminderLoading">Loading reminders…</div>';
    try{
      const now=new Date();
      const todayStart=dayStart(now),todayEnd=dayEnd(now);
      const nextStart=new Date(todayEnd.getTime()+1);
      const nextEnd=dayEnd(new Date(now.getFullYear(),now.getMonth(),now.getDate()+7));
      const [todayCount,nextCount]=await Promise.all([
        countScheduled(todayStart,todayEnd),
        countScheduled(nextStart,nextEnd)
      ]);
      root.innerHTML=`<div class="crmReminderHeader"><div><h2>Follow-up Reminders</h2><p>Quick view of your scheduled calendar activity.</p></div></div><div class="crmReminderCards"><article class="crmReminderCard today"><div><span>Today</span><strong>${todayCount}</strong></div><a href="${calendarUrl('today')}">View →</a></article><article class="crmReminderCard upcoming"><div><span>Next 7 Days</span><strong>${nextCount}</strong></div><a href="${calendarUrl('7days')}">View →</a></article></div>`;
      hideLegacyReminderUi(root);
    }catch(error){
      root.innerHTML=`<div class="crmReminderHeader"><div><h2>Follow-up Reminders</h2><p>Could not load calendar counts.</p></div><button id="crmReminderRetry">Retry</button></div>`;
      root.querySelector('#crmReminderRetry').onclick=loadReminderSummary;
      hideLegacyReminderUi(root);
    }finally{reminderLoading=false}
  }

  function queueUiRefresh(){
    if(uiRefreshQueued)return;uiRefreshQueued=true;
    requestAnimationFrame(()=>{uiRefreshQueued=false;addScheduleEditLinks();styleAndOrderPipeline();const root=findReminderRoot();if(root&&!root.dataset.crmReminderSummary)loadReminderSummary();else hideLegacyReminderUi(root)});
  }

  const observer=new MutationObserver(queueUiRefresh);observer.observe(document.documentElement,{subtree:true,childList:true});
  queueUiRefresh();setTimeout(updateCalendarBadge,1500);setTimeout(loadReminderSummary,1800);setInterval(updateCalendarBadge,60000);setInterval(loadReminderSummary,120000);
})();