(()=>{
  'use strict';

  function meaningfulActivityText(activities,fallback='-'){
    for(const activity of (activities||[])){
      const details=String(activity?.details||'').trim();
      if(!details) continue;
      const lower=details.toLowerCase();

      // Ignore only auto-generated contact/status entries.
      if(lower==='whatsapp message initiated') continue;
      if(lower==='call initiated') continue;
      if(lower.startsWith('status changed')) continue;

      return details;
    }
    return fallback || '-';
  }

  async function hydrateLatestOwnerRemarks(){
    try{
      if(typeof currentOwnerPageRows==='undefined' || !Array.isArray(currentOwnerPageRows) || !currentOwnerPageRows.length) return;
      if(typeof db==='undefined' || typeof U6_OWNER_ACTIVITIES==='undefined') return;

      const ids=currentOwnerPageRows.map(r=>String(r.id)).filter(Boolean);
      if(!ids.length) return;

      const {data,error}=await db.from(U6_OWNER_ACTIVITIES)
        .select('owner_id,activity_type,details,created_at')
        .in('owner_id',ids)
        .order('created_at',{ascending:false});
      if(error) throw error;

      const grouped={};
      (data||[]).forEach(activity=>{
        const key=String(activity.owner_id);
        if(!grouped[key]) grouped[key]=[];
        grouped[key].push(activity);
      });

      currentOwnerPageRows.forEach(row=>{
        const fallback=(typeof ownerRemarkValue==='function' ? ownerRemarkValue(row) : '') || '-';
        row.__u10_latest=meaningfulActivityText(grouped[String(row.id)]||[],fallback);
      });

      if(typeof renderData==='function') renderData(currentOwnerPageRows);
    }catch(e){
      console.warn('Latest owner remark refresh failed:',e);
    }
  }

  window.hydrateLatestOwnerRemarks=hydrateLatestOwnerRemarks;

  // Run after every final Owners load, including numeric sorting/filtering.
  if(typeof window.loadData==='function' && !window.loadData.__latestRemarkFinalPatchV2){
    const originalLoadData=window.loadData;
    const patched=async function(){
      const result=await originalLoadData.apply(this,arguments);
      await hydrateLatestOwnerRemarks();
      return result;
    };
    patched.__latestRemarkFinalPatchV2=true;
    window.loadData=patched;
  }

  // Refresh shortly after initial render too.
  setTimeout(hydrateLatestOwnerRemarks,300);
  setTimeout(hydrateLatestOwnerRemarks,1000);

  console.info('Owner latest remark table hotfix V2 loaded.');
})();
