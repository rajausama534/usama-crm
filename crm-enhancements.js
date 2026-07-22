(()=>{
  const VERSION='20260722-5';
  const textOf=e=>(e?.textContent||'').trim().toLowerCase();
  const normalizeStatus=t=>String(t||'').trim().toLowerCase().replace(/\s+/g,' ');
  const pipelineOrder=['new','contacted','call back','interested','viewing','visit done','negotiation','won','lost'];
  let uiRefreshQueued=false;
  let badgeLoading=false;
  let taskQueueLoading=false;

  function calendarUrl(){return `calendar.html?v=${VERSION}&t=${Date.now()}`}
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  function digits(v){return String(v||'').replace(/\D/g,'')}
  function formatTime(v){if(!v)return'';const [h,m]=String(v).split(':');const d=new Date();d.setHours(Number(h)||0,Number(m)||0,0,0);return d.toLocaleTimeString('en-AE',{hour:'2-digit',minute:'2-digit',hour12:true})}
  function isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

  document.addEventListener('click',e=>{
    const target=e.target.closest('a,button');
    if(!target)return;
    const label=textOf(target).replace(/\d+/g,'').trim();
    if(label==='calendar'||target.getAttribute('data-module')==='calendar'){
      e.preventDefault();
      e.stopImmediatePropagation();
      location.href=calendarUrl();
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
        const next=count>99?'99+':String(count);
        if(badge.textContent!==next)badge.textContent=next;
        badge.style.display=count?'inline-flex':'none';
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
    const heading=[...document.querySelectorAll('h1,h2,h3,h4,div')].find(x=>textOf(x)==='follow-up reminders');
    if(!heading)return null;
    let node=heading;
    for(let i=0;i<6&&node;i++,node=node.parentElement){
      const t=(node.innerText||'').toLowerCase();
      if(t.includes('overdue')&&t.includes('next 7 days'))return node;
    }
    return heading.parentElement;
  }

  function ensureRescheduleModal(){
    if(document.getElementById('crmRescheduleBack'))return;
    const wrap=document.createElement('div');wrap.id='crmRescheduleBack';wrap.className='crmRescheduleBack';
    wrap.innerHTML=`<div class="crmRescheduleModal"><div class="crmRescheduleHead"><strong>Reschedule Follow-up</strong><button type="button" onclick="window.crmCloseReschedule()">×</button></div><div class="crmRescheduleBody"><input id="crmRescheduleLeadId" type="hidden"><label>Date<input id="crmRescheduleDate" type="date"></label><label>Time<input id="crmRescheduleTime" type="time"></label><label>Reminder type<select id="crmRescheduleType"><option>Call</option><option>Meeting</option><option>Viewing</option><option>Follow-up</option><option>Task</option></select></label><label>Note<input id="crmRescheduleNote" placeholder="What needs to be done?"></label><div class="crmRescheduleActions"><button type="button" onclick="window.crmCloseReschedule()">Cancel</button><button class="primary" type="button" onclick="window.crmSaveReschedule()">Save</button></div></div></div>`;
    document.body.appendChild(wrap);
  }

  window.crmCloseReschedule=()=>document.getElementById('crmRescheduleBack')?.classList.remove('show');
  window.crmOpenReschedule=(id,date,time,type,note)=>{
    ensureRescheduleModal();
    document.getElementById('crmRescheduleLeadId').value=id;
    document.getElementById('crmRescheduleDate').value=date||isoDate(new Date());
    document.getElementById('crmRescheduleTime').value=(time||'10:00').slice(0,5);
    document.getElementById('crmRescheduleType').value=type||'Call';
    document.getElementById('crmRescheduleNote').value=note||'';
    document.getElementById('crmRescheduleBack').classList.add('show');
  };
  window.crmSaveReschedule=async()=>{
    const id=document.getElementById('crmRescheduleLeadId').value;
    const payload={follow_up_date:document.getElementById('crmRescheduleDate').value,follow_up_time:document.getElementById('crmRescheduleTime').value,reminder_type:document.getElementById('crmRescheduleType').value,reminder_note:document.getElementById('crmRescheduleNote').value.trim()};
    const {error}=await db.from('leads').update(payload).eq('id',id);
    if(error){alert(error.message);return}
    window.crmCloseReschedule();await loadFollowupQueue();
  };
  window.crmMarkFollowupDone=async id=>{
    if(!confirm('Mark this follow-up as completed?'))return;
    const {error}=await db.from('leads').update({follow_up_date:null,follow_up_time:null,reminder_type:null,reminder_note:null}).eq('id',id);
    if(error){alert(error.message);return}
    await loadFollowupQueue();
  };
  window.crmOpenLead=id=>{
    try{
      if(typeof showLeadsView==='function')Promise.resolve(showLeadsView()).then(()=>{if(typeof openLeadDetail==='function')openLeadDetail(String(id))});
      else if(typeof openLeadDetail==='function')openLeadDetail(String(id));
    }catch(e){console.warn(e)}
  };

  function taskCard(row,bucket){
    const phone=digits(row.phone||row.mobile||row.contact||row.phone_number);
    const wa=phone?`https://wa.me/${phone}`:'#';
    const dateLabel=bucket==='overdue'?'Overdue':bucket==='today'?'Today':new Date(`${row.follow_up_date}T00:00:00`).toLocaleDateString('en-AE',{weekday:'short',day:'numeric',month:'short'});
    const meta=[row.reminder_type||'Follow-up',row.project_inquired||'',row.reminder_note||''].filter(Boolean).join(' · ');
    return `<div class="crmTaskRow ${bucket}"><div class="crmTaskTime"><strong>${esc(formatTime(row.follow_up_time)||'Any time')}</strong><span>${esc(dateLabel)}</span></div><div class="crmTaskMain"><strong>${esc(row.name||'Unnamed lead')}</strong><span>${esc(meta||'Follow-up required')}</span></div><div class="crmTaskActions">${phone?`<a href="tel:+${phone}">Call</a><a class="wa" target="_blank" href="${wa}">WhatsApp</a>`:''}<button onclick="window.crmOpenLead('${esc(row.id)}')">Open</button><button onclick="window.crmOpenReschedule('${esc(row.id)}','${esc(row.follow_up_date||'')}','${esc(row.follow_up_time||'')}','${esc(row.reminder_type||'Call')}','${esc(row.reminder_note||'')}')">Reschedule</button><button class="done" onclick="window.crmMarkFollowupDone('${esc(row.id)}')">Done</button></div></div>`;
  }

  async function loadFollowupQueue(){
    if(taskQueueLoading||typeof db==='undefined')return;
    const root=findReminderRoot();if(!root)return;
    taskQueueLoading=true;
    root.dataset.crmTaskQueue='1';
    root.innerHTML=`<div class="crmTaskHeader"><div><h2>Follow-up Tasks</h2><p>Calls, meetings and reminders that need action.</p></div><button id="crmTaskRefresh">Refresh</button></div><div class="crmTaskLoading">Loading follow-ups…</div>`;
    root.querySelector('#crmTaskRefresh').onclick=loadFollowupQueue;
    try{
      const today=isoDate(new Date()),future=new Date();future.setDate(future.getDate()+7);const end=isoDate(future);
      const {data,error}=await db.from('leads').select('*').not('follow_up_date','is',null).lte('follow_up_date',end).order('follow_up_date').order('follow_up_time');
      if(error)throw error;
      const rows=(data||[]).map(r=>({...r,bucket:r.follow_up_date<today?'overdue':r.follow_up_date===today?'today':'upcoming'}));
      const counts={overdue:rows.filter(r=>r.bucket==='overdue').length,today:rows.filter(r=>r.bucket==='today').length,upcoming:rows.filter(r=>r.bucket==='upcoming').length};
      root.innerHTML=`<div class="crmTaskHeader"><div><h2>Follow-up Tasks</h2><p>Calls, meetings and reminders that need action.</p></div><button id="crmTaskRefresh">Refresh</button></div><div class="crmTaskSummary"><button data-filter="all" class="active">All <b>${rows.length}</b></button><button data-filter="overdue">Overdue <b>${counts.overdue}</b></button><button data-filter="today">Today <b>${counts.today}</b></button><button data-filter="upcoming">Next 7 Days <b>${counts.upcoming}</b></button></div><div id="crmTaskList" class="crmTaskList">${rows.length?rows.map(r=>taskCard(r,r.bucket)).join(''):'<div class="crmTaskEmpty">No pending follow-ups.</div>'}</div>`;
      root.querySelector('#crmTaskRefresh').onclick=loadFollowupQueue;
      root.querySelectorAll('.crmTaskSummary button').forEach(btn=>btn.onclick=()=>{
        root.querySelectorAll('.crmTaskSummary button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
        const f=btn.dataset.filter;root.querySelectorAll('.crmTaskRow').forEach(row=>row.style.display=f==='all'||row.classList.contains(f)?'grid':'none');
      });
    }catch(error){root.innerHTML=`<div class="crmTaskHeader"><div><h2>Follow-up Tasks</h2><p>Could not load reminders.</p></div><button id="crmTaskRefresh">Retry</button></div><div class="crmTaskError">${esc(error.message||error)}</div>`;root.querySelector('#crmTaskRefresh').onclick=loadFollowupQueue}
    finally{taskQueueLoading=false}
  }

  function queueUiRefresh(){
    if(uiRefreshQueued)return;uiRefreshQueued=true;
    requestAnimationFrame(()=>{uiRefreshQueued=false;addScheduleEditLinks();styleAndOrderPipeline();const root=findReminderRoot();if(root&&!root.dataset.crmTaskQueue)loadFollowupQueue()});
  }

  const observer=new MutationObserver(queueUiRefresh);observer.observe(document.documentElement,{subtree:true,childList:true});
  queueUiRefresh();setTimeout(updateCalendarBadge,1500);setTimeout(loadFollowupQueue,1800);setInterval(updateCalendarBadge,60000);setInterval(loadFollowupQueue,120000);
})();