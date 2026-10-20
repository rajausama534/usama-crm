/* Session workspace state. Only navigation/filter metadata is persisted, never CRM records. */
(()=>{
  'use strict';
  const fields={appView:['communityFilter','clusterFilter','unitFilter','searchInput','statusFilter','sourceFilter','ownerSortField','ownerSortDirection'],leadsView:['leadSearchInput','leadStatusFilter','leadSourceFilter','leadProjectFilter','leadFollowUpFilter','leadSortField','leadSortDirection','leadAssigneeFilter']};
  const $=id=>document.getElementById(id);
  let email='',state={views:{}},active='',restoring=false,scrollTimer;
  const key=()=>`crm.workspace.v1:${email}`;
  const readValues=id=>Object.fromEntries((fields[id]||[]).filter(f=>$(f)).map(f=>[f,$(f).value]));
  const signature=id=>JSON.stringify([readValues(id),id==='appView'?currentPage:leadPage]);
  function position(id){
    const root=$(id),box=root?.querySelector('.tablebox');
    const cards=root?.querySelector(id==='appView'?'#mobileCards':'#leadMobileCards');
    const container=cards&&getComputedStyle(cards).display!=='none'?cards:root?.querySelector('tbody');
    const line=container===cards?64:(box?.getBoundingClientRect().top||0)+44;
    const node=[...(container?.querySelectorAll('[data-record-id]')||[])].find(n=>n.getBoundingClientRect().bottom>line);
    return {x:scrollX,y:scrollY,tableTop:box?.scrollTop||0,tableLeft:box?.scrollLeft||0,anchor:node?.dataset.recordId,offset:node?.getBoundingClientRect().top||0};
  }
  function store(){
    if(!email||restoring)return;
    state.savedAt=Date.now();state.active=active;
    try{sessionStorage.setItem(key(),JSON.stringify(state));}catch(_){/* Private browsing/storage quota must not break navigation. */}
  }
  function save(){
    if(!active||restoring||!email)return;
    const previous=state.views[active]||{};
    state.views[active]={...previous,values:readValues(active),page:active==='appView'?currentPage:leadPage,mode:typeof leadViewMode!=='undefined'?leadViewMode:'table',advancedOpen:$(active)?.querySelector('.crmAdvFilters')?.hidden===false,position:position(active)};
    store();
  }
  function applyValues(id,values){
    for(const [f,v] of Object.entries(values||{})){
      const node=$(f);if(!node)continue;
      // Populate dependent cluster options after restoring the community.
      if(f==='clusterFilter'&&typeof updateClusterDropdown==='function')updateClusterDropdown();
      if(node.tagName==='SELECT'&&v&&![...node.options].some(o=>o.value===v))node.add(new Option(v,v));
      node.value=v;
    }
  }
  function restorePosition(id,p){
    if(!p||active!==id)return;
    const root=$(id),box=root?.querySelector('.tablebox');
    if(box){box.scrollLeft=p.tableLeft||0;box.scrollTop=p.tableTop||0;}
    window.scrollTo(p.x||0,p.y||0);
    const nodes=root?.querySelectorAll('[data-record-id]')||[];
    const node=[...nodes].find(n=>n.dataset.recordId===p.anchor&&n.getClientRects().length);
    if(node){
      const delta=node.getBoundingClientRect().top-p.offset;
      if(Math.abs(delta)>1){
        if(node.tagName==='TR'&&box)box.scrollTop+=delta;
        else window.scrollBy(0,delta);
      }
    }
  }
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  window.CRMWorkspace={
    signature,position,save,restorePosition,
    async resume(user){
      email=user.toLowerCase();
      try{const s=JSON.parse(sessionStorage.getItem(key())||'null');if(s&&Date.now()-s.savedAt<86400000&&s.views)state=s;}catch(_){}
      const requested=window.__crmInitialHash||location.hash;
      if(requested)return false; // Explicit deep links take priority over the last workspace.
      const id=state.active;
      if(!fields[id])return false;
      const saved=state.views[id];if(!saved)return false;
      restoring=true;
      try{
        // Dropdowns must exist before their values are restored; no stale row cache crosses reloads.
        if(id==='appView'){
          await loadDropdowns();applyValues(id,saved.values);currentPage=Math.max(0,Number(saved.page)||0);
          await showOwnersView({restoring:true});
        }else{
          await loadLeadSources();await loadProjects();refreshLeadStatusUI();await window.crmPrepareLeadFilters?.();applyValues(id,saved.values);
          leadPage=Math.max(0,Number(saved.page)||0);leadViewMode=saved.mode==='kanban'?'kanban':'table';
          await showLeadsView();
        }
        active=id;
        const advanced=$(id)?.querySelector('.crmAdvFilters');if(advanced)advanced.hidden=!saved.advancedOpen;
        $(id)?.querySelector('.crmFilterToggle')?.classList.toggle('active',!!saved.advancedOpen);
        await frame();restorePosition(id,saved.position);
        if(saved.record?.type==='owner'){
          const {data}=await db.from(TABLE_NAME).select('*').eq('id',saved.record.id).maybeSingle();
          if(data)await openOwnerProfile(data);
        }else if(saved.record?.type==='lead')await openLeadDetail(saved.record.id);
      }finally{restoring=false;}
      save();return true;
    },
    beforeView(id){if(id!==active)save();},
    afterView(id){
      const old=active;active=id;
      if(old!==id&&!restoring){const p=state.views[id]?.position;if(p)restorePosition(id,p);else window.scrollTo(0,0);}
      if(id==='loginView'){active='';return;}
      store();
    },
    record(type,id){if(restoring)return;save();if(state.views[active])state.views[active].record=id?{type,id}:null;store();},
    clear(){try{sessionStorage.removeItem(key());}catch(_){}state={views:{}};email='';active='';},
    async settled(id){await frame();if(active===id&&!restoring)save();}
  };
  addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(save,250);},{capture:true,passive:true});
  document.addEventListener('click',e=>{if(e.target.closest('a[href*="wa.me/"],a[href*="whatsapp.com/"],a[href^="whatsapp:"]'))save();},true);
  addEventListener('pagehide',save);
  let hiddenAt=0;
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){hiddenAt=Date.now();save();return;}
    const elapsed=hiddenAt?Date.now()-hiddenAt:0;hiddenAt=0;
    // Long app switches revalidate in place. Short WhatsApp hops retain the live DOM.
    if(elapsed>60000&&email){
      const refresh=active==='appView'?loadData:active==='leadsView'?loadLeads:null;
      if(refresh)Promise.resolve(refresh()).catch(e=>console.warn('Workspace refresh failed',e));
      window.crmRefreshNotifications?.();
    }
  });
  // A retained page/BFCache keeps its DOM and scroll. Do not refetch or reconstruct it on focus.
})();
