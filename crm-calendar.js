(()=>{
  'use strict';
  // Lead-connected calendar, follow-ups and notifications (table: crm_events; RLS decides visibility).
  if(typeof db==='undefined')return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TYPES=['Call Back','Follow-Up','Phone Call','Meeting','Property Viewing','Reminder','Task','Other'];
  const TYPE_CLASS={'Call Back':'call','Follow-Up':'follow','Phone Call':'call','Meeting':'meet','Property Viewing':'view','Reminder':'remind','Task':'task','Other':'other'};
  const DAY=864e5;
  const pad=n=>String(n).padStart(2,'0');
  const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const hm=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const startOfWeek=d=>{const s=startOfDay(d);const wd=(s.getDay()+6)%7;return new Date(s.getTime()-wd*DAY);};
  const fmtDay=d=>d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  const fmtTime=d=>d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const me=()=>String(typeof currentUserEmail!=='undefined'?currentUserEmail:'').toLowerCase();
  const isOverdue=e=>e.status==='Scheduled'&&new Date(e.starts_at)<new Date();
  const toast=(m,err)=>{const t=document.createElement('div');t.className='crmToast'+(err?' crmToastError':'');t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),4200);};

  let view='month',cursor=startOfDay(new Date()),events=[],assignees=null;

  async function loadAssignees(){
    if(assignees)return assignees;
    if(!isAdmin){assignees=[{email:me(),name:'Me'}];return assignees;}
    const {data}=await db.from('user_access').select('email,name,active').order('email');
    assignees=(data||[]).filter(u=>u.active!==false);
    return assignees;
  }

  function range(){
    if(view==='day')return [cursor,new Date(cursor.getTime()+DAY)];
    if(view==='week'){const s=startOfWeek(cursor);return [s,new Date(s.getTime()+7*DAY)];}
    const first=new Date(cursor.getFullYear(),cursor.getMonth(),1);const s=startOfWeek(first);return [s,new Date(s.getTime()+42*DAY)];
  }

  async function fetchEvents(from,to){
    const {data,error}=await db.from('crm_events').select('*,leads(name,phone,status)').gte('starts_at',from.toISOString()).lt('starts_at',to.toISOString()).order('starts_at');
    if(error){toast(error.message,true);return [];}
    return data||[];
  }

  // ------------------------------------------------------------------ view
  function ensureView(){
    let v=$('crmCalendarView');
    if(v)return v;
    v=document.createElement('div');v.id='crmCalendarView';v.className='wrap crmPage hidden';
    ($('dashboardView')||$('v7Topbar')).after(v);
    // view switching: include this view in the global hide list
    const base=window.showOnly;
    window.showOnly=function(id){$('crmCalendarView')?.classList.add('hidden');return base.apply(this,arguments);};
    return v;
  }

  window.showCalendarModule=async function(date){
    const v=ensureView();
    showOnly('dashboardView');$('dashboardView').classList.add('hidden');v.classList.remove('hidden');
    document.querySelectorAll('#v7Topbar .v7Nav button').forEach(b=>b.classList.toggle('active',b.id==='v7NavCalendar'));
    document.body.classList.remove('crmNavOpen');
    if(date)cursor=startOfDay(new Date(date));
    if(!v.dataset.ready){
      v.dataset.ready='1';
      v.innerHTML=`<header class="crmPageHead"><div><h1>Calendar</h1><p>Follow-ups, calls, meetings and viewings linked to your leads.</p></div>
        <div class="crmHeadActions"><button class="crmBtn crmBtnPrimary" data-new>+ Add follow-up</button></div></header>
        <div class="crmCalLayout">
          <section class="crmCard crmCalMain">
            <div class="crmCalToolbar">
              <div class="crmCalNav"><button class="crmBtn crmBtnSm" data-prev aria-label="Previous">‹</button><button class="crmBtn crmBtnSm" data-today>Today</button><button class="crmBtn crmBtnSm" data-next aria-label="Next">›</button><h2 class="crmCalTitle"></h2></div>
              <div class="crmSeg">${['month','week','day'].map(k=>`<button data-view="${k}">${k[0].toUpperCase()+k.slice(1)}</button>`).join('')}</div>
            </div>
            <div class="crmCalBody"></div>
          </section>
          <aside class="crmCalSide"></aside>
        </div>`;
      v.querySelector('[data-new]').onclick=()=>openEventEditor({});
      v.querySelector('[data-prev]').onclick=()=>shift(-1);
      v.querySelector('[data-next]').onclick=()=>shift(1);
      v.querySelector('[data-today]').onclick=()=>{cursor=startOfDay(new Date());render();};
      v.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});
      if(window.innerWidth<700)view='day';
    }
    await render();
    renderSide();
  };
  function shift(n){
    if(view==='month')cursor=new Date(cursor.getFullYear(),cursor.getMonth()+n,1);
    else cursor=new Date(cursor.getTime()+n*(view==='week'?7:1)*DAY);
    render();
  }

  function chip(e){
    const d=new Date(e.starts_at);
    const cls=[`crmEv`,`crmEv-${TYPE_CLASS[e.event_type]||'other'}`,e.status!=='Scheduled'?`is-${e.status.toLowerCase()}`:'',isOverdue(e)?'is-overdue':''].join(' ');
    return `<button type="button" class="${cls}" data-ev="${e.id}" title="${esc(e.event_type+' · '+e.title)}"><span class="crmEvTime">${fmtTime(d)}</span><span class="crmEvTitle">${esc(e.leads?.name||e.title)}</span></button>`;
  }

  async function render(){
    const v=$('crmCalendarView');if(!v)return;
    const [from,to]=range();
    v.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    v.querySelector('.crmCalTitle').textContent=view==='month'?cursor.toLocaleDateString('en-GB',{month:'long',year:'numeric'}):view==='week'?`${fmtDay(from)} – ${fmtDay(new Date(to.getTime()-DAY))}`:cursor.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const body=v.querySelector('.crmCalBody');
    body.innerHTML='<div class="crmLoadingLine">Loading…</div>';
    events=await fetchEvents(from,to);
    const byDay={};events.forEach(e=>{const k=ymd(new Date(e.starts_at));(byDay[k]=byDay[k]||[]).push(e);});
    const today=ymd(new Date());
    if(view==='month'){
      const days=[...Array(42)].map((_,i)=>new Date(from.getTime()+i*DAY));
      body.innerHTML=`<div class="crmMonth"><div class="crmMonthHead">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div>
        <div class="crmMonthGrid">${days.map(d=>{const k=ymd(d),list=byDay[k]||[];return `<div class="crmDay ${d.getMonth()!==cursor.getMonth()?'is-out':''} ${k===today?'is-today':''}" data-day="${k}">
          <span class="crmDayNum">${d.getDate()}</span>${list.slice(0,3).map(chip).join('')}${list.length>3?`<button type="button" class="crmMore" data-goto="${k}">+${list.length-3} more</button>`:''}</div>`;}).join('')}</div></div>`;
    }else{
      const n=view==='week'?7:1;
      const days=[...Array(n)].map((_,i)=>new Date(from.getTime()+i*DAY));
      const hours=[...Array(15)].map((_,i)=>i+7);
      body.innerHTML=`<div class="crmAgenda" style="--cols:${n}">
        <div class="crmAgendaHead"><span></span>${days.map(d=>`<span class="${ymd(d)===today?'is-today':''}">${fmtDay(d)}</span>`).join('')}</div>
        <div class="crmAgendaGrid">${hours.map(h=>`<span class="crmHour">${pad(h)}:00</span>${days.map(d=>{const k=ymd(d);const list=(byDay[k]||[]).filter(e=>{const eh=new Date(e.starts_at).getHours();return h===7?eh<=7:h===21?eh>=21:eh===h;});return `<div class="crmSlot" data-slot="${k}T${pad(h)}:00">${list.map(chip).join('')}</div>`;}).join('')}`).join('')}</div></div>`;
    }
    body.querySelectorAll('[data-ev]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();const e=events.find(x=>x.id===b.dataset.ev);if(e)openEventEditor(e);});
    body.querySelectorAll('[data-goto]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();cursor=startOfDay(new Date(b.dataset.goto+'T00:00:00'));view='day';render();});
    body.querySelectorAll('[data-day]').forEach(c=>c.onclick=()=>openEventEditor({starts_at:new Date(c.dataset.day+'T10:00:00').toISOString()}));
    body.querySelectorAll('[data-slot]').forEach(c=>c.onclick=()=>openEventEditor({starts_at:new Date(c.dataset.slot+':00').toISOString()}));
  }

  async function renderSide(){
    const side=$('crmCalendarView')?.querySelector('.crmCalSide');if(!side)return;
    const now=new Date(),dayEnd=new Date(startOfDay(now).getTime()+DAY);
    const [{data:open},{data:done}]=await Promise.all([
      db.from('crm_events').select('*,leads(name)').eq('status','Scheduled').gte('starts_at',new Date(now.getTime()-30*DAY).toISOString()).lt('starts_at',new Date(now.getTime()+8*DAY).toISOString()).order('starts_at').limit(200),
      db.from('crm_events').select('*,leads(name)').eq('status','Completed').order('completed_at',{ascending:false,nullsFirst:false}).limit(5)
    ]);
    const list=open||[];
    const groups=[['Overdue',list.filter(e=>new Date(e.starts_at)<now),'overdue'],['Today',list.filter(e=>new Date(e.starts_at)>=now&&new Date(e.starts_at)<dayEnd),'today'],['Next 7 days',list.filter(e=>new Date(e.starts_at)>=dayEnd),'upcoming'],['Recently completed',done||[],'done']];
    side.innerHTML=groups.map(([title,items,k])=>`<section class="crmCard crmSideGroup is-${k}"><header><h3>${title}</h3><span>${items.length}</span></header>
      ${items.length?`<ul>${items.slice(0,8).map(e=>`<li><button type="button" data-side="${e.id}"><strong>${esc(e.leads?.name||e.title)}</strong><span>${esc(e.event_type)} · ${fmtDay(new Date(e.starts_at))} ${fmtTime(new Date(e.starts_at))}</span></button></li>`).join('')}</ul>`:'<p class="crmEmpty">Nothing here.</p>'}</section>`).join('');
    const all=[...list,...(done||[])];
    side.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{const e=all.find(x=>x.id===b.dataset.side);if(e)openEventEditor(e);});
  }

  // ------------------------------------------------------------------ editor
  async function searchLeads(q){
    const s=q.replace(/[%(),]/g,' ').trim();if(!s)return [];
    const {data}=await db.from('leads').select('id,name,phone,status').or(`name.ilike.%${s}%,phone.ilike.%${s}%`).order('name').limit(8);
    return data||[];
  }

  window.crmOpenEventEditor=openEventEditor;
  async function openEventEditor(e){
    const isNew=!e.id;
    const start=e.starts_at?new Date(e.starts_at):new Date(Date.now()+60*60*1000);
    const users=await loadAssignees();
    const wrap=document.createElement('div');wrap.className='crmModalScrim';
    const leadName=e.leads?.name||e.lead_name||'';
    wrap.innerHTML=`<form class="crmModal crmEventModal" novalidate>
      <header><h2>${isNew?'Add follow-up':esc(e.event_type)}</h2><button type="button" class="crmIconBtn" data-close aria-label="Close">×</button></header>
      <div class="crmModalBody">
        ${!isNew?`<div class="crmEventMeta"><span class="crmStatus ${e.status==='Scheduled'?(isOverdue(e)?'off':'on'):''}">${isOverdue(e)?'Overdue':esc(e.status)}</span>${e.lead_id?`<button type="button" class="crmBtn crmBtnSm" data-open-lead>Open lead: ${esc(leadName)}</button>`:''}</div>`:''}
        <div class="crmFormGrid">
          <label>Type<select name="event_type">${TYPES.map(t=>`<option ${t===(e.event_type||'Follow-Up')?'selected':''}>${t}</option>`).join('')}</select></label>
          <label>Lead<div class="crmLeadPick"><input name="lead_search" autocomplete="off" placeholder="Search lead name or phone" value="${esc(leadName)}"><input type="hidden" name="lead_id" value="${esc(e.lead_id||'')}"><div class="crmLeadResults" hidden></div></div></label>
          <label class="crmWide">Title<input name="title" maxlength="200" value="${esc(e.title||'')}" placeholder="e.g. Call back about Farm Gardens 5BR"></label>
          <label>Date<input name="date" type="date" value="${ymd(start)}"></label>
          <label>Time<input name="time" type="time" value="${hm(start)}"></label>
          <label>Reminder<select name="remind_minutes">${[[0,'At the time'],[15,'15 minutes before'],[30,'30 minutes before'],[60,'1 hour before'],[1440,'1 day before']].map(([m,t])=>`<option value="${m}" ${m===(e.remind_minutes??30)?'selected':''}>${t}</option>`).join('')}</select></label>
          <label>Assigned to<select name="assigned_to" ${isAdmin?'':'disabled'}>${users.map(u=>`<option value="${esc(u.email)}" ${String(u.email).toLowerCase()===String(e.assigned_to||me()).toLowerCase()?'selected':''}>${esc(u.name||u.email)}</option>`).join('')}</select></label>
          <label class="crmWide">Notes<textarea name="notes" maxlength="4000" rows="3">${esc(e.notes||'')}</textarea></label>
        </div>
      </div>
      <p class="crmFormError" hidden></p>
      <footer>${!isNew?`<button type="button" class="crmBtn crmBtnDanger" data-delete>Delete</button>${e.status==='Scheduled'?`<button type="button" class="crmBtn" data-cancel-ev>Cancel event</button><button type="button" class="crmBtn" data-complete>Mark done</button>`:''}`:''}
        <span class="crmSpacer"></span><button type="button" class="crmBtn" data-close>Close</button><button type="submit" class="crmBtn crmBtnPrimary">${isNew?'Save':'Save changes'}</button></footer></form>`;
    document.body.append(wrap);
    const f=wrap.querySelector('form'),err=wrap.querySelector('.crmFormError');
    const close=()=>wrap.remove();
    wrap.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
    wrap.addEventListener('click',ev=>{if(ev.target===wrap)close();});
    // lead picker
    const results=f.querySelector('.crmLeadResults');let timer;
    f.lead_search.addEventListener('input',()=>{
      f.lead_id.value='';clearTimeout(timer);
      timer=setTimeout(async()=>{const rows=await searchLeads(f.lead_search.value);results.hidden=!rows.length;
        results.innerHTML=rows.map(r=>`<button type="button" data-pick="${r.id}" data-name="${esc(r.name||'')}"><strong>${esc(r.name||'—')}</strong><span>${esc([r.phone,r.status].filter(Boolean).join(' · '))}</span></button>`).join('');
        results.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{f.lead_id.value=b.dataset.pick;f.lead_search.value=b.dataset.name;results.hidden=true;if(!f.title.value)f.title.value=`${f.event_type.value} — ${b.dataset.name}`;});
      },250);
    });
    const after=async msg=>{close();toast(msg);if(!$('crmCalendarView')?.classList.contains('hidden')){await render();renderSide();}document.dispatchEvent(new CustomEvent('crm:events-changed',{detail:{lead_id:e.lead_id||f.lead_id.value}}));refreshBell();};
    wrap.querySelector('[data-open-lead]')?.addEventListener('click',()=>{close();crmOpenLead(e.lead_id);});
    wrap.querySelector('[data-complete]')?.addEventListener('click',async()=>{const {error}=await db.from('crm_events').update({status:'Completed',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',e.id);if(error){err.textContent=error.message;err.hidden=false;return;}after('Marked as done');});
    wrap.querySelector('[data-cancel-ev]')?.addEventListener('click',async()=>{const {error}=await db.from('crm_events').update({status:'Cancelled',updated_at:new Date().toISOString()}).eq('id',e.id);if(error){err.textContent=error.message;err.hidden=false;return;}after('Event cancelled');});
    wrap.querySelector('[data-delete]')?.addEventListener('click',async()=>{
      const btn=wrap.querySelector('[data-delete]');
      if(btn.dataset.armed!=='1'){btn.dataset.armed='1';btn.textContent='Click again to delete';return;}
      const {error}=await db.from('crm_events').delete().eq('id',e.id);if(error){err.textContent=error.message;err.hidden=false;return;}after('Event deleted');
    });
    f.onsubmit=async ev=>{
      ev.preventDefault();err.hidden=true;
      const when=new Date(`${f.date.value}T${f.time.value||'10:00'}:00`);
      if(!f.date.value||isNaN(when)){err.textContent='Choose a date and time.';err.hidden=false;return;}
      const lead_id=f.lead_id.value||null;
      const title=f.title.value.trim()||`${f.event_type.value}${f.lead_search.value?` — ${f.lead_search.value}`:''}`;
      const payload={event_type:f.event_type.value,title,notes:f.notes.value.trim()||null,starts_at:when.toISOString(),remind_minutes:Number(f.remind_minutes.value),lead_id,assigned_to:isAdmin?f.assigned_to.value:me(),updated_at:new Date().toISOString()};
      const btn=f.querySelector('[type=submit]');btn.disabled=true;
      const {error}=isNew?await db.from('crm_events').insert(payload):await db.from('crm_events').update(payload).eq('id',e.id);
      btn.disabled=false;
      if(error){err.textContent=/row-level security/i.test(error.message)?'You can only schedule events for leads assigned to you.':error.message;err.hidden=false;return;}
      after(isNew?'Follow-up saved':'Event updated');
    };
  }

  // ------------------------------------------------------------------ open a lead from anywhere
  window.crmOpenLead=async function(id){
    if(!id)return;
    if(typeof showLeadsView==='function')await showLeadsView();
    if(typeof openLeadDetail==='function')openLeadDetail(id);
  };

  // ------------------------------------------------------------------ lead detail: follow-ups section
  async function leadFollowups(id){
    const box=$('leadDetailContent');if(!box||!id)return;
    box.querySelector('.crmLeadEvents')?.remove();
    const sec=document.createElement('section');sec.className='crmCard crmLeadEvents';
    sec.innerHTML='<header><h3>Follow-ups & activity</h3><button type="button" class="crmBtn crmBtnSm crmBtnPrimary" data-add>+ Add follow-up</button></header><div class="crmLoadingLine">Loading…</div>';
    (box.querySelector('.u6DetailLeft')||box.firstElementChild||box).append(sec);
    const {data:lead}=await db.from('leads').select('id,name').eq('id',id).maybeSingle();
    sec.querySelector('[data-add]').onclick=()=>openEventEditor({lead_id:id,lead_name:lead?.name||'',event_type:'Follow-Up'});
    const {data}=await db.from('crm_events').select('*').eq('lead_id',id).order('starts_at',{ascending:false});
    const list=data||[];
    const upcoming=list.filter(e=>e.status==='Scheduled').sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
    const past=list.filter(e=>e.status!=='Scheduled');
    const item=e=>`<li><button type="button" data-ev="${e.id}"><time>${fmtDay(new Date(e.starts_at))} · ${fmtTime(new Date(e.starts_at))}</time><strong>${esc(e.event_type)}${isOverdue(e)?' <em class="crmOver">Overdue</em>':''}</strong><span>${esc(e.title)}${e.status!=='Scheduled'?` · ${esc(e.status)}`:''}</span></button></li>`;
    sec.querySelector('.crmLoadingLine').outerHTML=`<div class="crmLeadEvCols"><div><h4>Upcoming</h4>${upcoming.length?`<ul class="crmEvList">${upcoming.map(item).join('')}</ul>`:'<p class="crmEmpty">No follow-up scheduled.</p>'}</div>
      <div><h4>History</h4>${past.length?`<ul class="crmEvList">${past.slice(0,10).map(item).join('')}</ul>`:'<p class="crmEmpty">No past activities.</p>'}</div></div>`;
    sec.querySelectorAll('[data-ev]').forEach(b=>b.onclick=()=>{const e=list.find(x=>x.id===b.dataset.ev);if(e)openEventEditor({...e,leads:{name:lead?.name}});});
  }
  if(typeof openLeadDetail==='function'){
    const base=window.openLeadDetail;
    window.openLeadDetail=async function(id){const r=await base.apply(this,arguments);leadFollowups(id).catch(e=>console.warn('Lead follow-ups failed',e));return r;};
  }
  document.addEventListener('crm:events-changed',ev=>{
    const open=$('leadDetailModal')?.classList.contains('show');
    if(open&&typeof activeLeadDetailId!=='undefined'&&activeLeadDetailId)window.openLeadDetail(activeLeadDetailId);
  });

  // ------------------------------------------------------------------ notifications (bell)
  let notes=[];
  async function refreshBell(){
    const {data,error}=await db.rpc('crm_my_notifications');
    if(error)return;
    notes=data||[];
    const unread=notes.filter(n=>!n.is_read).length;
    ['v7NotificationBadge','homeNotificationBadge'].forEach(id=>{const b=$(id);if(b){b.textContent=unread;b.style.display=unread?'':'none';}});
  }
  window.openTodayNotifications=async function(){
    await refreshBell();
    document.querySelector('.crmNotePanel')?.remove();
    const p=document.createElement('div');p.className='crmModalScrim crmNoteScrim';
    const label={overdue:'Overdue',due_soon:'Due soon',today:'Today'};
    p.innerHTML=`<div class="crmModal crmNotePanel"><header><h2>Notifications</h2><button type="button" class="crmIconBtn" data-close aria-label="Close">×</button></header>
      <div class="crmModalBody">${notes.length?`<ul class="crmNoteList">${notes.map(n=>`<li class="${n.is_read?'':'is-unread'} is-${n.kind}"><button type="button" data-note="${n.event_id}" data-kind="${n.kind}">
        <span class="crmNoteKind">${label[n.kind]||n.kind}</span><strong>${esc(n.event_type)}${n.lead_name?` · ${esc(n.lead_name)}`:''}</strong><span>${esc(n.title)} — ${fmtDay(new Date(n.starts_at))} ${fmtTime(new Date(n.starts_at))}</span></button></li>`).join('')}</ul>`:'<p class="crmEmpty">You are all caught up.</p>'}</div>
      ${notes.some(n=>!n.is_read)?'<footer><button type="button" class="crmBtn" data-read-all>Mark all as read</button></footer>':''}</div>`;
    document.body.append(p);
    const close=()=>p.remove();
    p.querySelector('[data-close]').onclick=close;p.addEventListener('click',ev=>{if(ev.target===p)close();});
    const markRead=list=>list.length?db.from('crm_notification_reads').upsert(list.map(n=>({user_email:me(),event_id:n.event_id,kind:n.kind})),{onConflict:'user_email,event_id,kind',ignoreDuplicates:true}):null;
    p.querySelector('[data-read-all]')?.addEventListener('click',async()=>{await markRead(notes.filter(n=>!n.is_read));close();refreshBell();});
    p.querySelectorAll('[data-note]').forEach(b=>b.onclick=async()=>{
      const n=notes.find(x=>x.event_id===b.dataset.note&&x.kind===b.dataset.kind);close();
      await markRead([n]);refreshBell();
      if(n.lead_id)crmOpenLead(n.lead_id);else showCalendarModule(n.starts_at);
    });
  };
  if(typeof currentUserEmail!=='undefined'&&currentUserEmail){refreshBell();setInterval(refreshBell,120000);}
  else{const t=setInterval(()=>{if(typeof currentUserEmail!=='undefined'&&currentUserEmail){clearInterval(t);refreshBell();setInterval(refreshBell,120000);}},1000);}

  // Deep links: index.html#calendar, index.html#lead=<id>
  const hash=location.hash;
  if(hash==='#calendar')setTimeout(()=>showCalendarModule(),300);
  const m=hash.match(/^#lead=([0-9a-f-]{36})$/i);if(m)setTimeout(()=>crmOpenLead(m[1]),300);
})();
