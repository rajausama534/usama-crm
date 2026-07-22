(()=>{
  const textOf=e=>(e?.textContent||'').trim().toLowerCase();
  document.addEventListener('click',e=>{
    const target=e.target.closest('a,button');
    if(!target)return;
    if(textOf(target)==='calendar'||target.getAttribute('data-module')==='calendar'){
      e.preventDefault();e.stopImmediatePropagation();location.href='calendar.html';
    }
  },true);

  function addScheduleEditLinks(){
    const nodes=[...document.querySelectorAll('div,li,article')].filter(n=>{
      const t=(n.innerText||'').trim();
      return t.startsWith('Scheduled:')&&t.length<700&&!n.dataset.crmScheduleLinked;
    });
    nodes.forEach(n=>{
      n.dataset.crmScheduleLinked='1';
      const btn=document.createElement('button');
      btn.type='button';btn.className='crmEditScheduleBtn';btn.textContent='Edit date / time';
      btn.onclick=ev=>{ev.preventDefault();ev.stopPropagation();location.href='calendar.html';};
      n.appendChild(btn);
    });
  }

  const obs=new MutationObserver(()=>requestAnimationFrame(addScheduleEditLinks));
  obs.observe(document.documentElement,{subtree:true,childList:true});
  addScheduleEditLinks();
})();
