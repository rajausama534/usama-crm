(()=>{
  'use strict';

  const MIGRATION_KEY='fg2_notes_20260728_v1';
  const DATA_FILES=['data/fg2-part-1.txt','data/fg2-part-2.txt','data/fg2-part-3.txt','data/fg2-part-4.txt'];

  const normalizeUnit=value=>{
    const digits=String(value??'').match(/\d+/g)?.join('')||'';
    return digits?digits.padStart(3,'0').slice(-3):'';
  };

  const buildNote=item=>`Type: ${item.beds}BR\nPlot: ${item.plot} sqft\nLast Transaction: AED ${item.price} - ${item.date}`;

  function mergeNote(existing,note){
    const cleaned=String(existing||'').trim()
      .replace(/^Type:\s*[45]BR\s*\nPlot:\s*[\d,]+\s*sqft\s*\nLast Transaction:\s*AED\s*[\d,]+\s*-\s*[^\n]+(?:\n+)?/i,'')
      .trim();
    return cleaned?`${note}\n\n${cleaned}`:note;
  }

  async function loadDataFiles(){
    const texts=await Promise.all(DATA_FILES.map(async path=>{
      const response=await fetch(path,{cache:'no-store'});
      if(!response.ok)throw new Error(`Unable to load ${path}`);
      return response.text();
    }));
    return texts.join('\n').split(/\r?\n/).filter(Boolean).map(line=>{
      const [unit,beds,plot,price,date]=line.split('|');
      return {unit,beds,plot,price,date};
    });
  }

  async function runMigration(){
    if(localStorage.getItem(MIGRATION_KEY)==='done')return;
    if(typeof db==='undefined'||typeof TABLE_NAME==='undefined'||typeof isAdmin==='undefined'||!isAdmin||!currentUserEmail)return;

    try{
      const source=await loadDataFiles();
      const byUnit=new Map(source.map(item=>[item.unit,item]));
      const {data:rows,error}=await db.from(TABLE_NAME)
        .select('id,unit,community,cluster,admin_remarks')
        .ilike('community','%The Valley%')
        .ilike('cluster','%Farm Gardens 2%');
      if(error)throw error;

      let updated=0,failed=0;
      for(const row of rows||[]){
        const item=byUnit.get(normalizeUnit(row.unit));
        if(!item)continue;
        const admin_remarks=mergeNote(row.admin_remarks,buildNote(item));
        const {error:updateError}=await db.from(TABLE_NAME).update({admin_remarks}).eq('id',row.id);
        if(updateError){failed++;console.error(`FG2 Unit ${row.unit} failed`,updateError);}else updated++;
      }

      console.info(`Farm Gardens 2 CRM notes: ${updated} updated, ${failed} failed, ${(rows||[]).length} matched.`);
      if(failed===0&&updated>0){
        localStorage.setItem(MIGRATION_KEY,'done');
        if(typeof loadData==='function')loadData();
      }
    }catch(error){
      console.error('Farm Gardens 2 notes migration failed:',error);
    }
  }

  const timer=setInterval(()=>{
    if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&typeof isAdmin!=='undefined'&&isAdmin){
      clearInterval(timer);
      runMigration();
    }
  },1000);
  setTimeout(()=>clearInterval(timer),120000);

  console.info('Usama CRM stability patch and Farm Gardens 2 migration loaded.');
})();