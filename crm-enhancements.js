(()=>{
  const VERSION='20260722-4';
  const textOf=e=>(e?.textContent||'').trim().toLowerCase();
  const normalizeStatus=t=>String(t||'').trim().toLowerCase().replace(/\s+/g,' ');
  const pipelineOrder=['new','contacted','call back','interested','viewing','visit done','negotiation','won','lost'];
  let uiRefreshQueued=false;
  let badgeLoading=false;

  function calendarUrl(){return `calendar.html?v=${VERSION}&t=${Date.now()}`}

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
      start.setHours(0,0,0,0);
      end.setHours(23,59,59,999);
      const [l,o]=await Promise.all([
        db.from('lead_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%'),
        db.from('owner_activities').select('id',{count:'exact',head:true}).gte('created_at',start.toISOString()).lte('created_at',end.toISOString()).like('activity_type','Scheduled:%')
      ]);
      const count=(l.count||0)+(o.count||0);
      calendarTargets().forEach(target=>{
        let badge=target.querySelector(':scope > .crmCalendarBadge');
        if(!badge){
          badge=document.createElement('span');
          badge.className='crmCalendarBadge';
          target.style.position='relative';
          target.appendChild(badge);
        }
        const next=count>99?'99+':String(count);
        if(badge.textContent!==next)badge.textContent=next;
        badge.style.display=count?'inline-flex':'none';
      });
    }catch(error){
      console.warn('Calendar badge:',error);
    }finally{
      badgeLoading=false;
    }
  }

  function styleAndOrderPipeline(){
    const candidates=[...document.querySelectorAll('button,a,[role="button"]')]
      .filter(el=>pipelineOrder.includes(normalizeStatus(el.textContent)));
    candidates.forEach(el=>{
      const status=normalizeStatus(el.textContent);
      const key=status.replace(/\s+/g,'-');
      if(el.dataset.crmStatus!==key)el.dataset.crmStatus=key;
    });

    const parents=[...new Set(candidates.map(el=>el.parentElement).filter(Boolean))];
    parents.forEach(parent=>{
      const direct=[...parent.children].filter(el=>pipelineOrder.includes(normalizeStatus(el.textContent)));
      if(direct.length<5)return;
      const sorted=[...direct].sort((a,b)=>pipelineOrder.indexOf(normalizeStatus(a.textContent))-pipelineOrder.indexOf(normalizeStatus(b.textContent)));
      const alreadySorted=direct.every((el,index)=>el===sorted[index]);
      if(!alreadySorted)sorted.forEach(el=>parent.appendChild(el));
      parent.classList.add('crmPipelineOrdered');
    });
  }

  function addScheduleEditLinks(){
    const nodes=[...document.querySelectorAll('div,li,article')].filter(n=>{
      const t=(n.innerText||'').trim();
      return t.startsWith('Scheduled:')&&t.length<700&&!n.dataset.crmScheduleLinked;
    });
    nodes.forEach(n=>{
      n.dataset.crmScheduleLinked='1';
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='crmEditScheduleBtn';
      btn.textContent='Edit date / time';
      btn.onclick=ev=>{
        ev.preventDefault();
        ev.stopPropagation();
        location.href=calendarUrl();
      };
      n.appendChild(btn);
    });
  }

  function queueUiRefresh(){
    if(uiRefreshQueued)return;
    uiRefreshQueued=true;
    requestAnimationFrame(()=>{
      uiRefreshQueued=false;
      addScheduleEditLinks();
      styleAndOrderPipeline();
    });
  }

  const observer=new MutationObserver(queueUiRefresh);
  observer.observe(document.documentElement,{subtree:true,childList:true});

  queueUiRefresh();
  setTimeout(updateCalendarBadge,1500);
  setInterval(updateCalendarBadge,60000);
})();