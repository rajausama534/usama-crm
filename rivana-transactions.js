(()=>{
  'use strict';
  const MIGRATION_KEY='rivana_sales_transaction_activities_20261005_v1';
  const DATA_FILE='data/rivana-sales-transactions.txt';
  const ACTIVITY_TYPE='Property Transaction';
  const normalizeUnit=value=>{const parts=String(value??'').match(/\d+/g)||[];return parts.length?String(Number(parts[parts.length-1])):'';};
  const buildNote=item=>`Last Sale Transaction: AED ${item.amount} - ${item.date}`;
  async function loadTransactions(){
    const response=await fetch(DATA_FILE,{cache:'no-store'});
    if(!response.ok)throw new Error(`Unable to load ${DATA_FILE}`);
    return (await response.text()).split(/\r?\n/).filter(Boolean).map(line=>{const [unit,amount,date]=line.split('|');return {unit:normalizeUnit(unit),amount,date};});
  }
  async function run(){
    if(localStorage.getItem(MIGRATION_KEY)==='done')return;
    if(typeof db==='undefined'||typeof TABLE_NAME==='undefined'||typeof isAdmin==='undefined'||!isAdmin||!currentUserEmail||typeof U6_OWNER_ACTIVITIES==='undefined')return;
    try{
      const source=await loadTransactions(), byUnit=new Map();
      for(const item of source){if(!byUnit.has(item.unit))byUnit.set(item.unit,[]);byUnit.get(item.unit).push(item);}
      const {data:rows,error}=await db.from(TABLE_NAME).select('id,unit,community,cluster').or('cluster.ilike.%Rivana%,community.ilike.%Rivana%');
      if(error)throw error;
      const matched=[]; for(const row of rows||[]){for(const item of byUnit.get(normalizeUnit(row.unit))||[])matched.push({row,item});}
      if(!matched.length)throw new Error('No Rivana CRM villas matched the supplied sales report.');
      const ownerIds=[...new Set((rows||[]).map(x=>String(x.id)))]; let existing=[];
      for(let i=0;i<ownerIds.length;i+=50){const r=await db.from(U6_OWNER_ACTIVITIES).select('id,owner_id,activity_type,details').in('owner_id',ownerIds.slice(i,i+50));if(r.error)throw r.error;existing.push(...(r.data||[]));}
      const keys=new Set(existing.map(a=>`${String(a.owner_id)}|${String(a.details||'').trim()}`));
      const additions=matched.map(({row,item})=>({owner_id:String(row.id),activity_type:ACTIVITY_TYPE,details:buildNote(item),created_by:currentUserEmail||null})).filter(a=>!keys.has(`${a.owner_id}|${a.details}`));
      for(let i=0;i<additions.length;i+=50){const r=await db.from(U6_OWNER_ACTIVITIES).insert(additions.slice(i,i+50));if(r.error)throw r.error;}
      localStorage.setItem(MIGRATION_KEY,'done');
      console.info(`Rivana sales migration: ${additions.length} exact-match notes added.`);
      if(typeof loadData==='function')loadData();
    }catch(e){console.error('Rivana sales transaction migration failed:',e);}
  }
  const timer=setInterval(()=>{if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&typeof isAdmin!=='undefined'&&isAdmin){clearInterval(timer);run();}},1000);
  setTimeout(()=>clearInterval(timer),120000);
})();