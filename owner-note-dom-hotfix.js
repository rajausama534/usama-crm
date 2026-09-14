(()=>{
  'use strict';

  function isRealOwnerNote(activity){
    const details=String(activity?.details||'').trim();
    if(!details) return false;
    const lower=details.toLowerCase();
    if(lower==='whatsapp message initiated') return false;
    if(lower==='call initiated') return false;
    if(lower.startsWith('status changed')) return false;
    return true;
  }

  async function patchOwnerNoteCells(rows){
    try{
      if(!Array.isArray(rows)||!rows.length) return;
      if(typeof db==='undefined'||typeof U6_OWNER_ACTIVITIES==='undefined') return;

      const ids=rows.map(r=>String(r.id)).filter(Boolean);
      if(!ids.length) return;

      const {data,error}=await db.from(U6_OWNER_ACTIVITIES)
        .select('owner_id,activity_type,details,created_at')
        .in('owner_id',ids)
        .order('created_at',{ascending:false});
      if(error) throw error;

      const grouped={};
      (data||[]).forEach(a=>{
        const key=String(a.owner_id);
        if(!grouped[key]) grouped[key]=[];
        grouped[key].push(a);
      });

      const trs=[...document.querySelectorAll('#tableBody tr')];
      rows.forEach((row,index)=>{
        const activities=grouped[String(row.id)]||[];
        const latest=activities.find(isRealOwnerNote);
        const fallback=(typeof ownerRemarkValue==='function' ? ownerRemarkValue(row) : '') || '-';
        const text=(latest?.details||fallback||'-').trim()||'-';
        const cell=trs[index]?.querySelector('td.owner-col-remarks');
        if(!cell) return;
        cell.innerHTML=`<div class="latestRemarkRead" title="${typeof escapeHtml==='function'?escapeHtml(text):text}">${typeof escapeHtml==='function'?escapeHtml(text):text}</div>`;
      });
    }catch(e){
      console.warn('Owner note DOM refresh failed:',e);
    }
  }

  window.patchOwnerNoteCells=patchOwnerNoteCells;

  if(typeof window.renderData==='function'&&!window.renderData.__ownerNoteDomPatch){
    const originalRenderData=window.renderData;
    const patched=function(rows){
      const result=originalRenderData.apply(this,arguments);
      setTimeout(()=>patchOwnerNoteCells(rows||[]),0);
      return result;
    };
    patched.__ownerNoteDomPatch=true;
    window.renderData=patched;
  }

  setTimeout(()=>{
    try{
      if(typeof currentOwnerPageRows!=='undefined'&&Array.isArray(currentOwnerPageRows)) patchOwnerNoteCells(currentOwnerPageRows);
    }catch(_){ }
  },400);

  console.info('Owner Notes DOM hotfix loaded.');
})();
