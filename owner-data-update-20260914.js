(()=>{
  'use strict';

  const PATCH_KEY='owner_data_update_20260914_v1';

  const norm=value=>String(value??'').trim().toLowerCase();
  const normUnit=value=>{
    const m=String(value??'').match(/\d+/g)||[];
    return m.length?String(Number(m[m.length-1])):'';
  };

  async function run(){
    if(localStorage.getItem(PATCH_KEY)==='done')return;
    if(typeof db==='undefined'||typeof TABLE_NAME==='undefined'||typeof currentUserEmail==='undefined'||!currentUserEmail)return;
    if(typeof isAdmin!=='undefined'&&!isAdmin)return;

    try{
      const {data,error}=await db.from(TABLE_NAME)
        .select('*')
        .ilike('community','%The Valley%')
        .ilike('cluster','%Farm Gardens%');
      if(error)throw error;

      const exact=(data||[]).filter(r=>norm(r.community)==='the valley'&&norm(r.cluster)==='farm gardens');
      const villa97=exact.filter(r=>normUnit(r.unit)==='97');
      const villa129=exact.filter(r=>normUnit(r.unit)==='129');

      const payload97={
        owner:'Ijaz',
        phone1:'+971 58 545 8998',
        status:'For Rent'
      };

      if(villa97.length){
        for(const row of villa97){
          const {error:updateError}=await db.from(TABLE_NAME).update(payload97).eq('id',row.id);
          if(updateError)throw updateError;
        }
      }else{
        const {error:insertError}=await db.from(TABLE_NAME).insert([{
          community:'The Valley',
          cluster:'Farm Gardens',
          unit:'97',
          owner:'Ijaz',
          phone1:'+971 58 545 8998',
          status:'For Rent'
        }]);
        if(insertError)throw insertError;
      }

      if(!villa129.length)throw new Error('Farm Gardens Villa 129 was not found, so its contact number was not changed.');
      for(const row of villa129){
        const {error:updateError}=await db.from(TABLE_NAME).update({phone1:'971569727674'}).eq('id',row.id);
        if(updateError)throw updateError;
      }

      localStorage.setItem(PATCH_KEY,'done');
      console.info(`Owner data patch complete: Villa 97 ${villa97.length?'updated':'inserted'}; Villa 129 phone updated.`);
      if(typeof loadData==='function')await loadData();
    }catch(e){
      console.error('Owner data patch failed:',e);
    }
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&(typeof isAdmin==='undefined'||isAdmin)){
      clearInterval(timer);
      run();
    }else if(attempts>=120){
      clearInterval(timer);
    }
  },500);
})();
