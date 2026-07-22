(()=>{
  const VERSION='20260722-2';
  const textOf=e=>(e?.textContent||'').trim().toLowerCase();
  function calendarUrl(){return `calendar.html?v=${VERSION}&t=${Date.now()}`}
  document.addEventListener('click',e=>{
    const target=e.target.closest('a,button');
    if(!target)return;
    const label=textOf(target).replace(/\d+/g,'').trim();
    if(label==='calendar'||target.getAttribute('data-module')==='calendar'){
      e.preventDefault();e.stopImmediatePropagation();location.href=calendarUrl();
    }
  },true);

  function calendarTargets(){return [...document.querySelectorAll('a,button,div')].filter(x=>{
    const t=textOf(x).replace(/\d+/g,'').trim();
    return t==='calendar'&&x.children.length<8;
  })}
  async function updateCalendarBadge(){
    try{
      if(typeof db==='undefined')return;
      const now=new Date(),start=new Date(now),end=new Date(now);
      start.setHours(0,0,0,0);end.setHours(23,59,59,999);
      const [l,o]=await Promise.all([
        db.from('lead_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%'),
        db.from('owner_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%')
      ]);
      const count=(l.count||0)+(o.count||0);
      calendarTargets().forEach(target=>{
        let badge=target.querySelector('.crmCalendarBadge');
        if(!badge){badge=document.createElement('span');badge.className='crmCalendarBadge';target.style.position='relative';target.appendChild(badge)}
        badge.textContent=count>99?'99+':String(count);badge.style.display=count?'inline-flex':'none';
      });
    }catch(e){console.warn('Calendar badge:',e)}
  }

  function addScheduleEditLinks(){
    const nodes=[...document.querySelectorAll('div,li,article')].filter(n=>{
      const t=(n.innerText||'').trim();return t.startsWith('Scheduled:')&&t.length<700&&!n.dataset.crmScheduleLinked;
    });
    nodes.forEach(n=>{
      n.dataset.crmScheduleLinked='1';const btn=document.createElement('button');btn.type='button';btn.className='crmEditScheduleBtn';btn.textContent='Edit date / time';btn.onclick=ev=>{ev.preventDefault();ev.stopPropagation();location.href=calendarUrl()};n.appendChild(btn);
    });
  }
  const obs=new MutationObserver(()=>requestAnimationFrame(()=>{addScheduleEditLinks();updateCalendarBadge()}));
  obs.observe(document.documentElement,{subtree:true,childList:true});
  addScheduleEditLinks();updateCalendarBadge();setInterval(updateCalendarBadge,60000);
})();