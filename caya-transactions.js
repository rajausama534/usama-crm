(()=>{
  'use strict';

  const MIGRATION_KEY='caya_sale_rental_transaction_activities_20260909_v1';
  const DATA_FILE='data/caya-latest-transactions.txt';
  const ACTIVITY_TYPE='Property Transaction';

  const normalizeUnit=value=>{
    const parts=String(value??'').match(/\d+/g)||[];
    return parts.length?String(Number(parts[parts.length-1])):'';
  };

  const buildNote=item=>{
    if(item.category==='Sale'){
      return `Last Sale Transaction: AED ${item.amount} - ${item.startDate}`;
    }
    const label=item.type==='Renewed'?'Rental Renewal':'Last Rental Transaction';
    return `${label}: AED ${item.amount} - ${item.startDate}${item.endDate?` to ${item.endDate}`:''}`;
  };

  async function loadCayaTransactions(){
    const response=await fetch(DATA_FILE,{cache:'no-store'});
    if(!response.ok)throw new Error(`Unable to load ${DATA_FILE}`);
    return (await response.text()).split(/\r?\n/).filter(Boolean).map(line=>{
      const [unit,category,type,amount,startDate,endDate]=line.split('|');
      return {unit:normalizeUnit(unit),category,type,amount,startDate,endDate};
    });
  }

  async function runCayaMigration(){
    if(localStorage.getItem(MIGRATION_KEY)==='done')return;
    if(typeof db==='undefined'||typeof TABLE_NAME==='undefined'||typeof isAdmin==='undefined'||!isAdmin||!currentUserEmail)return;
    if(typeof U6_OWNER_ACTIVITIES==='undefined')return;

    try{
      const source=await loadCayaTransactions();
      const byUnit=new Map();
      for(const item of source){
        if(!byUnit.has(item.unit))byUnit.set(item.unit,[]);
        byUnit.get(item.unit).push(item);
      }

      const {data:rows,error}=await db.from(TABLE_NAME)
        .select('id,unit,community,cluster')
        .or('cluster.ilike.%Caya%,community.ilike.%Caya%');
      if(error)throw error;

      const matched=[];
      for(const row of rows||[]){
        const items=byUnit.get(normalizeUnit(row.unit))||[];
        for(const item of items)matched.push({row,item});
      }
      if(!matched.length)throw new Error('No Caya CRM villas matched the supplied transaction reports.');

      const ownerIds=[...new Set(matched.map(x=>String(x.row.id)))];
      let existing=[];
      for(let index=0;index<ownerIds.length;index+=50){
        const result=await db.from(U6_OWNER_ACTIVITIES)
          .select('owner_id,details')
          .eq('activity_type',ACTIVITY_TYPE)
          .in('owner_id',ownerIds.slice(index,index+50));
        if(result.error)throw result.error;
        existing.push(...(result.data||[]));
      }

      const existingKeys=new Set(existing.map(a=>`${String(a.owner_id)}|${String(a.details||'').trim()}`));
      const additions=matched.map(({row,item})=>({
        owner_id:String(row.id),
        activity_type:ACTIVITY_TYPE,
        details:buildNote(item),
        created_by:currentUserEmail||null
      })).filter(a=>!existingKeys.has(`${a.owner_id}|${a.details}`));

      for(let index=0;index<additions.length;index+=50){
        const {error:insertError}=await db.from(U6_OWNER_ACTIVITIES).insert(additions.slice(index,index+50));
        if(insertError)throw insertError;
      }

      console.info(`Caya transaction notes: ${additions.length} added, ${matched.length-additions.length} already present.`);
      localStorage.setItem(MIGRATION_KEY,'done');
      if(typeof loadData==='function')loadData();
    }catch(error){
      console.error('Caya transaction notes migration failed:',error);
    }
  }

  const timer=setInterval(()=>{
    if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&typeof isAdmin!=='undefined'&&isAdmin){
      clearInterval(timer);
      runCayaMigration();
    }
  },1000);
  setTimeout(()=>clearInterval(timer),120000);

  console.info('Caya sale and rental transaction activity migration loaded.');
})();
