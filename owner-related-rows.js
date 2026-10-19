(()=>{
  'use strict';
  // "More Unit" and the owner profile need every row that shares the owner's name or phone.
  // They used to search a browser copy of the whole owners table; now the database returns
  // just the related rows for what is on screen (crm_related_rows, RLS applies).

  if(typeof db==='undefined'||typeof renderData!=='function')return;

  const loaded=new Set();

  function merge(rows){
    const byId=new Map(allMiniRows.map(x=>[String(x.id),x]));
    for(const row of rows||[])byId.set(String(row.id),row);
    allMiniRows=[...byId.values()];
  }

  async function ensureRelated(ids){
    const missing=[...new Set(ids.map(String))].filter(id=>!loaded.has(id));
    if(!missing.length)return false;
    const {data,error}=await db.rpc('crm_related_rows',{owner_ids:missing.map(Number)});
    if(error){console.warn('Related owner rows unavailable:',error.message);return false;}
    missing.forEach(id=>loaded.add(id));
    merge(data);
    return true;
  }
  window.crmEnsureRelatedRows=ensureRelated;

  // Draw the page immediately, then redraw once if any row turns out to have more units.
  let latest=0;
  const baseRender=renderData;
  renderData=function(rows){
    const result=baseRender.apply(this,arguments);
    const token=++latest;
    const ids=(rows||[]).map(r=>r?.id).filter(id=>id!==undefined&&id!==null);
    ensureRelated(ids).then(changed=>{
      if(changed&&token===latest&&rows.some(r=>getRelatedRows(r).length>1))baseRender(rows);
    });
    return result;
  };

  // This script loads after the first page may already be on screen.
  if(typeof currentOwnerPageRows!=='undefined'&&currentOwnerPageRows.length)renderData(currentOwnerPageRows);

  // Profiles and the More Units list can be opened for rows that are not on the current page.
  for(const name of ['openOwnerProfile','openProperties']){
    const base=window[name];
    if(typeof base!=='function')continue;
    window[name]=async function(row){
      if(row&&row.id!==undefined)await ensureRelated([row.id]);
      return base.apply(this,arguments);
    };
  }
})();
