(()=>{
  'use strict';

  async function hydrateLatestOwnerRemarks(){
    try{
      if(typeof currentOwnerPageRows==='undefined' || !Array.isArray(currentOwnerPageRows) || !currentOwnerPageRows.length) return;
      if(typeof db==='undefined' || typeof U6_OWNER_ACTIVITIES==='undefined') return;

      const ids=currentOwnerPageRows.map(r=>String(r.id)).filter(Boolean);
      if(!ids.length) return;

      const {data,error}=await db.from(U6_OWNER_ACTIVITIES)
        .select('*')
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
        if(typeof u10LatestManualText==='function'){
          row.__u10_latest=u10LatestManualText(grouped[String(row.id)]||[],fallback);
        }else{
          const activities=grouped[String(row.id)]||[];
          const manual=activities.find(a=>{
            const type=String(a.activity_type||'').toLowerCase();
            const details=String(a.details||'').trim();
            if(!details) return false;
            if(details.toLowerCase().includes('whatsapp message initiated')) return false;
            if(details.toLowerCase().startsWith('status changed')) return false;
            return !['whatsapp','status change'].includes(type);
          });
          row.__u10_latest=manual?.details?.trim() || fallback;
        }
      });

      if(typeof renderData==='function') renderData(currentOwnerPageRows);
    }catch(e){
      console.warn('Latest owner remark refresh failed:',e);
    }
  }

  window.hydrateLatestOwnerRemarks=hydrateLatestOwnerRemarks;

  // This script loads last. Wrap the final loadData implementation so numeric
  // sorting/filtering can finish first, then refresh the latest activity text.
  if(typeof window.loadData==='function' && !window.loadData.__latestRemarkFinalPatch){
    const originalLoadData=window.loadData;
    const patched=async function(){
      const result=await originalLoadData.apply(this,arguments);
      await hydrateLatestOwnerRemarks();
      return result;
    };
    patched.__latestRemarkFinalPatch=true;
    window.loadData=patched;
  }

  // Also refresh after a profile activity is added/edited and the modal closes.
  setTimeout(hydrateLatestOwnerRemarks,500);

  console.info('Owner latest remark table hotfix loaded.');
})();
