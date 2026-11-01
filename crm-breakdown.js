(()=>{
  'use strict';
  // Breakdown page: build a property price breakdown, save it (table crm_breakdowns, RLS decides who sees it),
  // and send the client a read-only link (breakdown.html) on WhatsApp. Maths and layout: crm-breakdown-doc.js.
  if(typeof db==='undefined'||!window.PropertyBreakdown)return;
  const PB=window.PropertyBreakdown;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=(m,err)=>{const t=document.createElement('div');t.className='crmToast'+(err?' crmToastError':'');t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),4200);};
  const WA_KEY='crm_breakdown_whatsapp';
  const myWhatsapp=()=>{try{return localStorage.getItem(WA_KEY)||'';}catch(_){return '';}};

  // current breakdown: id null = not saved yet; lead = {name,phone} for the WhatsApp button
  let cur=blank(),saved=[],dirty=false,timer;
  function blank(extra){return {id:null,owner_id:null,lead_id:null,lead:null,data:PB.normalize({whatsapp:myWhatsapp(),...(extra||{})})};}

  const GROUPS=[
    ['Property',[['title','Main title','pbWide','e.g. 5-Bedroom Semi-Detached'],['subtitle','Subtitle','pbWide','e.g. Arabian Ranches 3'],
      ['project','Project'],['developer','Developer'],['area','Area'],['type','Type'],['bedrooms','Bedrooms'],['bathrooms','Bathrooms'],
      ['size','Size','pbWide','e.g. Plot 4,520 | BUA: 3,426 sqft'],['floor','Floor'],['view','View'],['completion','Completion']]],
    ['Price',[['unitPrice','Unit price (AED)','','5700000','numeric'],['paymentSeller','Payment to seller (AED)','','Same as price','numeric'],
      ['brokeragePercent','Brokerage %','','2','decimal']]]
  ];
  const UPLOADS=[['floorPlans','Floor plan','Images or PDF'],['clusterPlans','Cluster plan','Images or PDF'],['pictures','Photos','Images']];

  // ------------------------------------------------------------------ view + sidebar item (below Calendar)
  function ensureNav(){
    if($('v7NavBreakdown'))return;
    const cal=$('v7NavCalendar');if(!cal)return;
    const b=document.createElement('button');b.id='v7NavBreakdown';b.type='button';
    b.innerHTML='<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>Breakdown';
    b.onclick=()=>showBreakdownView();
    cal.after(b);
  }
  function ensureView(){
    let v=$('crmBreakdownView');if(v)return v;
    v=document.createElement('div');v.id='crmBreakdownView';v.className='wrap crmPage hidden';
    ($('dashboardView')||$('v7Topbar')).after(v);
    const base=window.showOnly;
    window.showOnly=function(){$('crmBreakdownView')?.classList.add('hidden');$('v7NavBreakdown')?.classList.remove('active');return base.apply(this,arguments);};
    return v;
  }

  window.showBreakdownView=async function(prefill){
    const v=ensureView();
    if(prefill&&dirty&&!confirm('Discard the unsaved changes to the current breakdown?'))prefill=null;
    showOnly('dashboardView');$('dashboardView')?.classList.add('hidden');v.classList.remove('hidden');
    window.CRMWorkspace?.afterView?.('crmBreakdownView');
    document.querySelectorAll('#v7Topbar .v7Nav button').forEach(b=>b.classList.toggle('active',b.id==='v7NavBreakdown'));
    document.body.classList.remove('crmNavOpen');
    if(!v.dataset.ready){v.dataset.ready='1';build(v);}
    if(prefill)load(prefill);
    await loadSaved();
  };

  function build(v){
    v.innerHTML=`<header class="crmPageHead"><div><h1>Breakdown</h1></div>
        <div class="pbActions">
          <button type="button" class="crmBtn" data-new>New</button>
          <button type="button" class="crmBtn" data-import>Import link</button>
          <button type="button" class="crmBtn" data-pdf>Download PDF</button>
          <button type="button" class="crmBtn" data-save>Save</button>
          <div class="pbShare"><button type="button" class="crmBtn crmBtnPrimary" data-share aria-haspopup="menu">Share with client ▾</button>
            <div class="pbShareMenu" role="menu" hidden>
              <button type="button" data-wa><strong>Send link on WhatsApp</strong><small>Opens WhatsApp with the client link ready to send</small></button>
              <button type="button" data-share-pdf><strong>Send PDF</strong><small>Share the PDF file (WhatsApp, email…)</small></button>
              <button type="button" data-copy><strong>Copy client link</strong><small>Paste it anywhere</small></button>
              <button type="button" data-open-link><strong>Open client page</strong><small>See exactly what the client sees</small></button>
            </div></div>
        </div></header>
      <div class="pbLayout">
        <aside class="pbSaved"><h3>Saved</h3><input type="search" placeholder="Search saved…" data-search><ul class="pbSavedList"></ul></aside>
        <form class="pbForm" novalidate>
          <p class="pbLinked" hidden></p>
          ${GROUPS.map(([title,fields])=>`<div><h3>${title}</h3><fieldset>${fields.map(([k,label,cls,ph,mode])=>
            `<label class="${cls||''}">${label}<input name="${k}" ${mode?`inputmode="${mode}"`:''} placeholder="${esc(ph||'')}" autocomplete="off"></label>`).join('')}${title==='Price'?'<dl class="pbCalc" data-calc></dl>':''}</fieldset></div>`).join('')}
          <div><h3>Remaining payment plan</h3><div data-inst></div>
            <button type="button" class="crmBtn crmBtnSm" data-add-inst style="margin-top:8px">+ Add installment</button>
            <p class="pbHint">Only for off-plan resales still paying the developer. Leave empty for ready properties.</p></div>
          <div><h3>Plans & photos</h3><div class="pbUploads">${UPLOADS.map(([k,label,hint])=>`<div class="pbUpload" data-up="${k}">
            <header><strong>${label}</strong><label class="crmBtn crmBtnSm">+ Add<input type="file" multiple accept="${k==='pictures'?'image/*':'image/*,application/pdf'}" data-file="${k}" aria-label="Add ${label.toLowerCase()} (${hint})"></label></header>
            <div class="pbThumbs"></div></div>`).join('')}</div></div>
          <div><h3>Notes & contact</h3><fieldset>
            <label class="pbWide">Notes on the page<textarea name="notes" rows="3" placeholder="e.g. Ready to move, vacant on transfer"></textarea></label>
            <label class="pbWide">Your WhatsApp number (shown to the client)<input name="whatsapp" inputmode="tel" placeholder="9715…" autocomplete="off"></label>
          </fieldset></div>
          <button type="button" class="crmBtn crmBtnDanger" data-delete hidden>Delete this breakdown</button>
        </form>
        <section class="pbPreview" aria-label="Client preview"></section>
      </div>`;
    const f=v.querySelector('.pbForm');
    f.addEventListener('input',ev=>{
      const n=ev.target.name;if(!n||n.startsWith('inst'))return;
      if(n==='unitPrice'&&(!cur.data.paymentSeller||cur.data.paymentSeller===cur.data.unitPrice)){cur.data.paymentSeller=ev.target.value;f.paymentSeller.value=ev.target.value;}
      cur.data[n]=ev.target.value;
      if(n==='whatsapp'){try{localStorage.setItem(WA_KEY,ev.target.value);}catch(_){}}
      changed();
    });
    v.querySelector('[data-add-inst]').onclick=()=>{cur.data.installments.push({label:'',amount:''});paintInst();changed();};
    v.querySelector('[data-new]').onclick=()=>{if(dirty&&!confirm('Discard the unsaved changes?'))return;load(blank());};
    v.querySelector('[data-save]').onclick=save;
    const menu=v.querySelector('.pbShareMenu');
    v.querySelector('[data-share]').onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden;};
    document.addEventListener('click',e=>{if(!e.target.closest?.('.pbShare'))menu.hidden=true;});
    menu.addEventListener('click',()=>{menu.hidden=true;});
    v.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(clientLink());toast('Client link copied');}catch(_){prompt('Copy this link:',clientLink());}};
    v.querySelector('[data-open-link]').onclick=()=>window.open(clientLink(),'_blank','noopener');
    v.querySelector('[data-wa]').onclick=sendWhatsApp;
    v.querySelector('[data-pdf]').onclick=()=>withPdf(btnBusy(v.querySelector('[data-pdf]'),'Making PDF…'),blob=>{download(blob);toast('PDF downloaded');});
    v.querySelector('[data-share-pdf]').onclick=()=>withPdf(btnBusy(v.querySelector('[data-share]'),'Making PDF…'),sharePdf);
    v.querySelectorAll('[data-file]').forEach(inp=>inp.onchange=()=>{const files=[...inp.files];inp.value='';addFiles(inp.dataset.file,files);});
    v.querySelector('[data-import]').onclick=()=>{
      const t=prompt('Paste a breakdown link (from this CRM or the old breakdown generator):');if(!t)return;
      try{if(dirty&&!confirm('Discard the unsaved changes?'))return;load({...blank(),data:PB.fromLink(t)});dirty=true;toast('Imported — press Save to keep it');}
      catch(_){toast('That link could not be read',true);}
    };
    v.querySelector('[data-delete]').onclick=async()=>{
      if(!cur.id||!confirm(`Delete "${cur.data.title||'this breakdown'}"?`))return;
      const {error}=await db.from('crm_breakdowns').delete().eq('id',cur.id);
      if(error)return toast(error.message,true);
      toast('Breakdown deleted');load(blank());loadSaved();
    };
    v.querySelector('[data-search]').oninput=paintSaved;
    load(cur);
  }

  function paintInst(){
    const box=document.querySelector('#crmBreakdownView [data-inst]');if(!box)return;
    box.innerHTML=cur.data.installments.map((x,i)=>`<div class="pbInst"><input name="instLabel" data-i="${i}" value="${esc(x.label)}" placeholder="e.g. 60% on completion"><input name="instAmount" data-i="${i}" inputmode="numeric" value="${esc(x.amount)}" placeholder="AED"><button type="button" class="crmBtn" data-rm="${i}" aria-label="Remove installment">×</button></div>`).join('');
    box.querySelectorAll('input').forEach(inp=>inp.oninput=()=>{cur.data.installments[inp.dataset.i][inp.name==='instLabel'?'label':'amount']=inp.value;changed();});
    box.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{cur.data.installments.splice(Number(b.dataset.rm),1);paintInst();changed();});
  }

  function load(item){
    cur={id:item.id||null,owner_id:item.owner_id||null,lead_id:item.lead_id||null,lead:item.lead||null,data:PB.normalize(item.data)};
    if(!cur.data.whatsapp)cur.data.whatsapp=myWhatsapp();
    dirty=false;
    const v=$('crmBreakdownView');if(!v?.dataset.ready)return;
    const f=v.querySelector('.pbForm');
    PB.FIELDS.forEach(k=>{if(f[k])f[k].value=cur.data[k]||'';});
    paintInst();paintMedia();
    v.querySelector('[data-delete]').hidden=!cur.id;
    const linked=v.querySelector('.pbLinked');
    linked.hidden=!(cur.lead||cur.owner_id);
    linked.textContent=cur.lead?`For lead: ${cur.lead.name||'—'}${cur.lead.phone?' · '+cur.lead.phone:''}`:cur.owner_id?'Started from an owner record':'';
    paintPreview();paintSaved();
  }
  function changed(){dirty=true;clearTimeout(timer);timer=setTimeout(paintPreview,120);}
  function paintPreview(){
    const p=document.querySelector('#crmBreakdownView .pbPreview');if(p)p.innerHTML=PB.render(cur.data);
    const box=document.querySelector('#crmBreakdownView [data-calc]');if(!box)return;
    const c=PB.calc(cur.data);
    box.innerHTML=[['DLD fee (4%)',c.dldFee],['Trustee office fee',c.trusteeFee],['Title deed fee',c.titleDeed],['Brokerage + 5% VAT',c.brokerageVat]]
      .map(([l,v])=>`<dt>${l}</dt><dd>${PB.money(v)}</dd>`).join('')+`<dt class="pbCalcTotal">Total on transfer</dt><dd class="pbCalcTotal">${PB.money(c.totalTransfer)}</dd>`;
  }

  // ------------------------------------------------------------------ PDF + sharing
  function btnBusy(btn,label){const old=btn.textContent;btn.disabled=true;btn.textContent=label;return ()=>{btn.disabled=false;btn.textContent=old;};}
  async function withPdf(done,use){
    try{const blob=await PB.buildPdf(cur.data);await use(blob);}
    catch(e){console.error(e);toast('Could not make the PDF: '+(e.message||e),true);}
    finally{done();}
  }
  function download(blob){
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=PB.pdfName(cur.data);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  // Phones (and Safari/Edge on desktop) can attach the file straight to WhatsApp; elsewhere it downloads.
  async function sharePdf(blob){
    const file=new File([blob],PB.pdfName(cur.data),{type:'application/pdf'});
    if(navigator.canShare?.({files:[file]})){
      try{await navigator.share({files:[file],title:file.name});return;}catch(e){if(e.name==='AbortError')return;}
    }
    download(blob);toast('PDF downloaded — attach it in WhatsApp');
  }

  // ------------------------------------------------------------------ plans & photos (public storage bucket)
  let pdfjs=null;
  function loadPdfJs(){
    if(!pdfjs)pdfjs=new Promise((ok,fail)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';ok(window.pdfjsLib);};
      s.onerror=()=>{pdfjs=null;fail(new Error('Could not load the PDF reader'));};document.head.append(s);});
    return pdfjs;
  }
  // JPEG on a white background; plans keep more pixels so small print stays readable in the PDF.
  function toJpeg(src,w,h,maxSide,q){
    const k=Math.min(1,maxSide/Math.max(w,h)),c=document.createElement('canvas');
    c.width=Math.round(w*k);c.height=Math.round(h*k);
    const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.imageSmoothingQuality='high';g.drawImage(src,0,0,c.width,c.height);
    return new Promise((ok,fail)=>c.toBlob(b=>b?ok(b):fail(new Error('Image could not be converted')),'image/jpeg',q));
  }
  async function fileToJpegs(file,kind){
    const plan=kind!=='pictures',max=plan?2800:2000,q=plan?0.92:0.86;
    if(file.type==='application/pdf'){
      const lib=await loadPdfJs(),pdf=await lib.getDocument({data:await file.arrayBuffer()}).promise,out=[];
      for(let i=1;i<=Math.min(pdf.numPages,8);i++){
        const page=await pdf.getPage(i),base=page.getViewport({scale:1}),vp=page.getViewport({scale:Math.min(4,max/Math.max(base.width,base.height))});
        const c=document.createElement('canvas');c.width=Math.round(vp.width);c.height=Math.round(vp.height);
        const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);
        await page.render({canvasContext:g,viewport:vp}).promise;
        out.push({blob:await toJpeg(c,c.width,c.height,max,q),name:`${file.name} p${i}`});
      }
      return out;
    }
    if(!file.type.startsWith('image/'))throw new Error(`${file.name} is not an image or PDF`);
    const bmp=await createImageBitmap(file);
    try{return [{blob:await toJpeg(bmp,bmp.width,bmp.height,max,q),name:file.name}];}finally{bmp.close?.();}
  }
  async function addFiles(kind,files){
    const box=document.querySelector(`#crmBreakdownView [data-up="${kind}"]`);if(!box||!files.length)return;
    const note=document.createElement('p');note.className='pbUploading';box.append(note);
    let added=0,failed=[];
    for(const f of files){
      note.textContent=`Uploading ${f.name}…`;
      try{
        for(const img of await fileToJpegs(f,kind)){
          const path=`${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}.jpg`;
          const {error}=await db.storage.from('breakdown-media').upload(path,img.blob,{contentType:'image/jpeg',cacheControl:'31536000',upsert:false});
          if(error)throw error;
          cur.data[kind].push({path,name:img.name});added++;
        }
      }catch(e){console.warn(e);failed.push(`${f.name}: ${e.message||e}`);}
    }
    note.remove();paintMedia(kind);changed();
    if(failed.length)toast('Some files could not be added — '+failed.join('; '),true);
    else if(added)toast(added===1?'Added':`${added} images added`);
  }
  function paintMedia(kind){
    const kinds=kind?[kind]:UPLOADS.map(u=>u[0]);
    kinds.forEach(k=>{
      const box=document.querySelector(`#crmBreakdownView [data-up="${k}"] .pbThumbs`);if(!box)return;
      const list=cur.data[k];
      box.innerHTML=list.map((x,i)=>`<figure class="pbThumb"><img src="${esc(PB.mediaUrl(x.path))}" alt="${esc(x.name)}" loading="lazy">
        <div><button type="button" data-mv="-1" data-i="${i}" ${i?'':'disabled'} aria-label="Move left">‹</button><button type="button" data-del data-i="${i}" aria-label="Remove">×</button><button type="button" data-mv="1" data-i="${i}" ${i<list.length-1?'':'disabled'} aria-label="Move right">›</button></div></figure>`).join('');
      box.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{const i=+b.dataset.i,j=i+Number(b.dataset.mv);[list[i],list[j]]=[list[j],list[i]];paintMedia(k);changed();});
      box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{list.splice(+b.dataset.i,1);paintMedia(k);changed();});
    });
  }
  const clientLink=()=>`${location.origin}/breakdown.html?d=${PB.encode(cur.data)}`;

  // ------------------------------------------------------------------ saved list
  async function loadSaved(){
    const {data,error}=await db.from('crm_breakdowns').select('id,title,data,owner_id,lead_id,created_by,updated_at,leads(name,phone)').order('updated_at',{ascending:false}).limit(300);
    if(error){saved=[];const ul=document.querySelector('#crmBreakdownView .pbSavedList');if(ul)ul.innerHTML=`<li class="crmEmpty">${esc(error.message)}</li>`;return;}
    saved=data||[];paintSaved();
  }
  function paintSaved(){
    const ul=document.querySelector('#crmBreakdownView .pbSavedList');if(!ul)return;
    const q=(document.querySelector('#crmBreakdownView [data-search]')?.value||'').toLowerCase().trim();
    const list=saved.filter(s=>!q||[s.title,s.data?.subtitle,s.data?.project,s.leads?.name].join(' ').toLowerCase().includes(q));
    ul.innerHTML=list.map(s=>{
      const price=PB.num(s.data?.unitPrice);
      const meta=[s.data?.subtitle||s.data?.project,price?PB.money(price):'',new Date(s.updated_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})].filter(Boolean).join(' · ');
      return `<li><button type="button" data-open="${s.id}" class="${s.id===cur.id?'is-active':''}"><strong>${esc(s.title)}</strong><span>${esc(meta)}${s.leads?.name?` · ${esc(s.leads.name)}`:''}</span></button></li>`;
    }).join('')||'<li class="crmEmpty">No saved breakdowns yet.</li>';
    ul.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{
      if(dirty&&!confirm('Discard the unsaved changes?'))return;
      const s=saved.find(x=>x.id===b.dataset.open);if(s)load({...s,lead:s.leads||null});
    });
  }

  async function save(){
    const title=(cur.data.title||'').trim()||[cur.data.bedrooms&&`${cur.data.bedrooms}BR`,cur.data.type,cur.data.project].filter(Boolean).join(' ')||'Property breakdown';
    const payload={title:title.slice(0,200),data:PB.normalize(cur.data),owner_id:cur.owner_id,lead_id:cur.lead_id,updated_at:new Date().toISOString()};
    const btn=document.querySelector('#crmBreakdownView [data-save]');btn.disabled=true;
    const res=cur.id?await db.from('crm_breakdowns').update(payload).eq('id',cur.id).select('id').single():await db.from('crm_breakdowns').insert(payload).select('id').single();
    btn.disabled=false;
    if(res.error)return toast('Could not save: '+res.error.message,true);
    cur.id=res.data.id;dirty=false;
    document.querySelector('#crmBreakdownView [data-delete]').hidden=false;
    toast('Breakdown saved');loadSaved();
  }

  function sendWhatsApp(){
    const d=cur.data,first=String(cur.lead?.name||'').trim().split(/\s+/)[0];
    const what=[d.title||'the property',d.subtitle].filter(Boolean).join(' – ');
    const text=`Hi${first?' '+first:''}, please find the price breakdown for ${what}:\n${clientLink()}`;
    const to=String(cur.lead?.phone||'').replace(/\D/g,'');
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`,'_blank','noopener');
  }

  // ------------------------------------------------------------------ start from an owner or a lead
  const digits=v=>(String(v||'').match(/\d+/)||[''])[0];
  const sqft=v=>v?Math.round(v).toLocaleString('en-US'):'';
  function parseBudget(v){
    const m=String(v||'').replace(/,/g,'').match(/([\d.]+)\s*([mk])?/i);if(!m)return '';
    const n=Number(m[1])*(m[2]?.toLowerCase()==='m'?1e6:m[2]?.toLowerCase()==='k'?1e3:1);
    return n>=10000?String(Math.round(n)):'';
  }
  const titleFor=(beds,type)=>[beds&&`${beds}-Bedroom`,type].filter(Boolean).join(' ');

  // Owner name and unit number stay in the CRM: the client page only gets location and size.
  window.crmBreakdownFromOwner=async function(row){
    if(!row)return;
    const {data:u}=await db.from('unit_details').select('property_type,bedrooms,bua_sqft,plot_sqft').match({community:row.community,cluster:row.cluster,unit:row.unit}).maybeSingle();
    const beds=digits(u?.bedrooms),type=u?.property_type||'';
    const size=[u?.plot_sqft&&`Plot ${sqft(u.plot_sqft)}`,u?.bua_sqft&&`BUA: ${sqft(u.bua_sqft)}`].filter(Boolean).join(' | ');
    if(typeof closeOwnerProfile==='function')closeOwnerProfile();
    showBreakdownView({...blank({title:titleFor(beds,type),subtitle:[row.cluster,row.community].filter(Boolean).join(', '),project:row.cluster||'',area:row.community||'',type,bedrooms:beds,size:size?size+' sqft':''}),owner_id:row.id});
  };
  window.crmBreakdownFromLead=async function(id){
    const {data:l}=await db.from('leads').select('id,name,phone,project_inquired,bedroom,property_type,budget').eq('id',id).maybeSingle();
    if(!l)return;
    const beds=digits(l.bedroom),price=parseBudget(l.budget);
    if(typeof closeLeadDetail==='function')closeLeadDetail();
    showBreakdownView({...blank({title:titleFor(beds,l.property_type),subtitle:l.project_inquired||'',project:l.project_inquired||'',type:l.property_type||'',bedrooms:beds,unitPrice:price,paymentSeller:price}),lead_id:l.id,lead:{name:l.name,phone:l.phone}});
  };

  function addButton(container,label,onclick){
    if(!container||container.querySelector('.crmBreakdownBtn'))return;
    const b=document.createElement('button');b.type='button';b.className='darkBtn crmBreakdownBtn';b.textContent=label;b.onclick=onclick;
    container.append(b);
  }
  if(typeof openOwnerProfile==='function'){
    const base=window.openOwnerProfile;
    window.openOwnerProfile=async function(row){
      const r=await base.apply(this,arguments);
      addButton(document.querySelector('#profileContent .u6HeaderActions'),'Breakdown',()=>crmBreakdownFromOwner(row));
      return r;
    };
  }
  if(typeof renderLeadDetail==='function'){
    const base=renderLeadDetail;
    renderLeadDetail=function(lead){
      const r=base.apply(this,arguments);
      addButton(document.querySelector('#leadDetailContent .u6HeaderActions'),'Breakdown',()=>crmBreakdownFromLead(lead.id));
      return r;
    };
  }

  ensureNav();
  const hash=window.__crmInitialHash||location.hash;
  if(hash==='#breakdown')setTimeout(()=>showBreakdownView(),300);
})();
