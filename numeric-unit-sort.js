(()=>{
  'use strict';

  const unitNumber=value=>{
    const raw=String(value??'').trim();
    const match=raw.match(/\d+(?:\.\d+)?/);
    return match?Number(match[0]):Number.MAX_SAFE_INTEGER;
  };

  const unitText=value=>String(value??'').trim();

  const numericUnitSort=(rows,direction='asc')=>{
    const factor=direction==='desc'?-1:1;
    return [...(rows||[])].sort((a,b)=>{
      const aValue=unitNumber(a.unit_sort??a.unit);
      const bValue=unitNumber(b.unit_sort??b.unit);
      if(aValue!==bValue)return (aValue-bValue)*factor;
      return unitText(a.unit_sort??a.unit).localeCompare(
        unitText(b.unit_sort??b.unit),undefined,{numeric:true,sensitivity:'base'}
      )*factor;
    });
  };

  async function fetchAllFilteredOwners(){
    const batchSize=1000;
    let from=0;
    const rows=[];

    while(true){
      let query=db.from(TABLE_NAME).select('*').range(from,from+batchSize-1);
      query=applyAccessFilter(query);
      query=applyFilters(query);
      const {data,error}=await query;
      if(error)throw error;
      rows.push(...(data||[]));
      if(!data||data.length<batchSize)break;
      from+=batchSize;
    }
    return rows;
  }

  function install(){
    if(typeof loadData!=='function'||loadData.__numericUnitSortV2)return false;

    const originalLoadData=loadData;

    const patched=async function(...args){
      const field=document.getElementById('ownerSortField')?.value||'unit';
      const direction=document.getElementById('ownerSortDirection')?.value||'asc';

      // Unit numbers must be sorted numerically BEFORE pagination.
      // Server-side text ordering produces 1, 11, 12, 103, 2... which is wrong.
      if(field==='unit'){
        try{
          if(typeof showLoading==='function')showLoading();

          const allRows=numericUnitSort(await fetchAllFilteredOwners(),direction);
          const count=allRows.length;
          const from=currentPage*PAGE_SIZE;
          const to=from+PAGE_SIZE;
          const pageRows=allRows.slice(from,to);

          totalCount=count;
          if(typeof hideLoading==='function')hideLoading();
          renderData(pageRows);

          const start=count===0?0:from+1;
          const end=Math.min(to,count);
          const totalPages=Math.max(1,Math.ceil(count/PAGE_SIZE));

          const statusNode=document.getElementById('status');
          const pageInfo=document.getElementById('pageInfo');
          const prevBtn=document.getElementById('prevBtn');
          const nextBtn=document.getElementById('nextBtn');
          if(statusNode)statusNode.textContent=`Showing ${start}-${end} of ${count} records`;
          if(pageInfo)pageInfo.textContent=`${currentPage+1} / ${totalPages}`;
          if(prevBtn)prevBtn.disabled=currentPage===0;
          if(nextBtn)nextBtn.disabled=currentPage+1>=totalPages;
          return;
        }catch(error){
          console.error('Numeric unit sorting failed; falling back to normal loader.',error);
          if(typeof hideLoading==='function')hideLoading();
        }
      }

      return originalLoadData.apply(this,args);
    };

    patched.__numericUnitSortV2=true;
    loadData=patched;
    console.info('Numeric unit sorting installed before pagination.');
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(install()||attempts>=120)clearInterval(timer);
  },500);

  install();
})();
