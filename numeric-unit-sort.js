(()=>{
  'use strict';

  const unitNumber=value=>{
    const parts=String(value??'').match(/\d+/g)||[];
    return parts.length?Number(parts[parts.length-1]):Number.MAX_SAFE_INTEGER;
  };

  const numericUnitSort=rows=>(rows||[]).sort((a,b)=>{
    const diff=unitNumber(a.unit_sort??a.unit)-unitNumber(b.unit_sort??b.unit);
    if(diff!==0)return diff;
    return String(a.unit_sort??a.unit??'').localeCompare(String(b.unit_sort??b.unit??''),undefined,{numeric:true,sensitivity:'base'});
  });

  function install(){
    let installed=false;

    if(typeof renderData==='function'&&!renderData.__numericUnitSortPatch){
      const original=renderData;
      const patched=function(rows,...args){
        return original.call(this,numericUnitSort(Array.isArray(rows)?[...rows]:rows),...args);
      };
      patched.__numericUnitSortPatch=true;
      renderData=patched;
      installed=true;
    }

    if(typeof loadData==='function'&&!loadData.__numericUnitSortPatch){
      const original=loadData;
      const patched=async function(...args){
        const result=await original.apply(this,args);
        if(Array.isArray(window.currentOwnerPageRows)){
          window.currentOwnerPageRows=numericUnitSort([...window.currentOwnerPageRows]);
          if(typeof renderData==='function')renderData(window.currentOwnerPageRows);
        }
        return result;
      };
      patched.__numericUnitSortPatch=true;
      loadData=patched;
      installed=true;
    }

    return installed;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    install();
    if(attempts>=120)clearInterval(timer);
  },500);

  install();
  console.info('Numeric ascending villa/unit sorting patch loaded.');
})();
