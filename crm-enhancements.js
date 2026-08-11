(()=>{
  'use strict';

  const MIGRATION_KEY='fg2_notes_20260807_v2';
  const DATA_FILES=['data/fg2-part-1.txt','data/fg2-part-2.txt','data/fg2-part-3.txt','data/fg2-part-4.txt'];

  const normalizeUnit=value=>{
    const digits=String(value??'').match(/\d+/g)?.join('')||'';
    return digits?digits.padStart(3,'0').slice(-3):'';
  };

  const buildNote=item=>`Type: ${item.beds}BR\nPlot: ${item.plot} sqft\nLast Transaction: AED ${item.price} - ${item.date}`;

  function cleanGeneratedContactRemark(value){
    return String(value||'')
      .split(/\r?\n/)
      .filter(line=>!/^\s*(WhatsApp message initiated|Call initiated)\s*$/i.test(line))
      .join('\n')
      .trim();
  }

  function mergeNote(existing,note){
    const cleaned=cleanGeneratedContactRemark(existing)
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

      console.info(`Farm Gardens 2 CRM notes repair: ${updated} updated, ${failed} failed, ${(rows||[]).length} matched.`);
      if(failed===0){
        localStorage.setItem(MIGRATION_KEY,'done');
        if(typeof loadData==='function')loadData();
      }
    }catch(error){
      console.error('Farm Gardens 2 notes repair failed:',error);
    }
  }

  async function markOwnerContacted(ownerId,type){
    try{
      if(typeof db==='undefined'||typeof TABLE_NAME==='undefined')return;
      await db.from(TABLE_NAME).update({status:'Contacted',last_contacted:today()}).eq('id',ownerId);
      if(typeof U6_OWNER_ACTIVITIES!=='undefined'){
        await db.from(U6_OWNER_ACTIVITIES).insert([{
          owner_id:String(ownerId),
          activity_type:type,
          details:type==='WhatsApp'?'WhatsApp message initiated':'Call initiated',
          created_by:currentUserEmail||null
        }]);
      }
      if(typeof loadData==='function')loadData();
    }catch(e){console.warn('Unable to mark owner contacted',e);}
  }

  function installContactFixes(){
    let changed=false;

    if(typeof getOwnerStatuses==='function'&&!getOwnerStatuses.__contactedPatch){
      const originalGetOwnerStatuses=getOwnerStatuses;
      const patched=function(){
        const statuses=originalGetOwnerStatuses();
        return statuses.includes('Contacted')?statuses:[...statuses.slice(0,1),'Contacted',...statuses.slice(1)];
      };
      patched.__contactedPatch=true;
      getOwnerStatuses=patched;
      if(typeof refreshOwnerStatusUI==='function')refreshOwnerStatusUI();
      changed=true;
    }

    if(typeof u6LogOwnerWhatsApp==='function'&&!u6LogOwnerWhatsApp.__preserveRemarksPatch){
      const patched=async function(ownerId,message){
        try{
          if(typeof U6_OWNER_ACTIVITIES!=='undefined'){
            await db.from(U6_OWNER_ACTIVITIES).insert([{
              owner_id:String(ownerId),
              activity_type:'WhatsApp',
              details:message||'WhatsApp message initiated',
              created_by:currentUserEmail||null
            }]);
          }
          await db.from(TABLE_NAME).update({
            status:'Contacted',
            last_contacted:today()
          }).eq('id',ownerId);
          if(typeof loadData==='function')loadData();
        }catch(e){console.warn(e);}
      };
      patched.__preserveRemarksPatch=true;
      u6LogOwnerWhatsApp=patched;
      changed=true;
    }

    if(typeof callButton==='function'&&!callButton.__contactedPatch){
      const patched=function(row){
        const phone=get(row,['phone1','phone2','phone','mobile','contact']);
        const formatted=formatPhone(phone);
        if(!formatted)return '';
        return `<a class="callBtn" href="tel:+${formatted}" onclick="markOwnerContacted('${row.id}','Call')">Call</a>`;
      };
      patched.__contactedPatch=true;
      callButton=patched;
      changed=true;
    }

    return changed;
  }

  window.markOwnerContacted=markOwnerContacted;

  function openUnitFinder(){ location.href='unit-finder.html'; }
  function openOwnerFinder(){ location.href='owner-finder.html'; }

  function addFinderEntries(){
    const launcher=document.querySelector('.crmAppLauncher');
    if(launcher){
      if(!launcher.querySelector('[data-unit-finder-entry]')){
        const tile=document.createElement('button');
        tile.type='button';
        tile.className='crmAppTile';
        tile.dataset.unitFinderEntry='home';
        tile.innerHTML=`<span class="crmAppIcon" style="display:grid;place-items:center;font-size:48px;color:#27c8bc">⌖</span><span>Unit Finder</span>`;
        tile.addEventListener('click',openUnitFinder);
        launcher.appendChild(tile);
      }

      if(!launcher.querySelector('[data-owner-finder-entry]')){
        const tile=document.createElement('button');
        tile.type='button';
        tile.className='crmAppTile';
        tile.dataset.ownerFinderEntry='home';
        tile.innerHTML=`<span class="crmAppIcon" style="display:grid;place-items:center;font-size:44px;color:#27c8bc">◎</span><span>Owner Finder</span>`;
        tile.addEventListener('click',openOwnerFinder);
        launcher.appendChild(tile);
      }
    }

    const nav=document.querySelector('.v7Nav');
    if(nav){
      if(!nav.querySelector('[data-unit-finder-entry]')){
        const btn=document.createElement('button');
        btn.type='button';
        btn.dataset.unitFinderEntry='nav';
        btn.textContent='Unit Finder';
        btn.addEventListener('click',openUnitFinder);
        nav.appendChild(btn);
      }
      if(!nav.querySelector('[data-owner-finder-entry]')){
        const btn=document.createElement('button');
        btn.type='button';
        btn.dataset.ownerFinderEntry='nav';
        btn.textContent='Owner Finder';
        btn.addEventListener('click',openOwnerFinder);
        nav.appendChild(btn);
      }
    }

    return Boolean(document.querySelector('[data-unit-finder-entry]')&&document.querySelector('[data-owner-finder-entry]'));
  }

  const migrationTimer=setInterval(()=>{
    if(typeof currentUserEmail!=='undefined'&&currentUserEmail&&typeof isAdmin!=='undefined'&&isAdmin){
      clearInterval(migrationTimer);
      runMigration();
    }
  },1000);
  setTimeout(()=>clearInterval(migrationTimer),120000);

  let attempts=0;
  const uiTimer=setInterval(()=>{
    attempts++;
    const added=addFinderEntries();
    installContactFixes();
    if((added&&attempts>20)||attempts>120)clearInterval(uiTimer);
  },500);

  console.info('Usama CRM note-preservation, Contacted status, Unit Finder, Owner Finder and FG2 repair patch loaded.');
})();