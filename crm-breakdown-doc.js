// Property breakdown: maths, client page and PDF, shared by the CRM page (crm-breakdown.js)
// and the public client page (breakdown.html). Same fields as property-breakdown-generator.vercel.app.
(function(root){
  'use strict';
  const FIELDS=['whatsapp','title','subtitle','project','developer','area','type','bedrooms','bathrooms','size','floor','view','completion',
    'unitPrice','paymentSeller','brokeragePercent','notes'];
  const MEDIA=[['floorPlans','Floor Plan'],['clusterPlans','Cluster Plan'],['pictures','Photos']];
  const DETAILS=[['project','Project'],['developer','Developer'],['area','Area'],['type','Type'],['bedrooms','Bedrooms'],['bathrooms','Bathrooms'],
    ['size','Size'],['floor','Floor'],['view','View'],['completion','Completion']];
  // Images live in the public "breakdown-media" storage bucket; the breakdown only keeps their paths.
  const MEDIA_BASE='https://vnydxkmhrcesdffpfjpc.supabase.co/storage/v1/object/public/breakdown-media/';
  const DLD_RATE=0.04,VAT=0.05,TITLE_DEED=580;
  const trusteeFor=price=>price<=0?0:price>500000?4200:2100;

  const num=v=>Number(String(v??'').replace(/[^\d.]/g,''))||0;
  const money=v=>'AED '+Math.round(v).toLocaleString('en-AE');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const phone=v=>String(v||'').replace(/\D/g,'');
  const mediaUrl=p=>/^https?:/.test(p)?p:MEDIA_BASE+String(p).split('/').map(encodeURIComponent).join('/');

  function normalize(d){
    const out={brokeragePercent:'2'};
    FIELDS.forEach(k=>{if(d&&d[k]!==undefined&&d[k]!==null&&d[k]!=='')out[k]=String(d[k]);});
    out.installments=Array.isArray(d?.installments)?d.installments.map(x=>({label:String(x?.label||''),amount:String(x?.amount??'')})):[];
    // Only stored images are kept (the old generator embedded images in the link itself).
    MEDIA.forEach(([k])=>{out[k]=Array.isArray(d?.[k])?d[k].filter(x=>x&&typeof x.path==='string'&&!x.path.startsWith('data:')).map(x=>({path:x.path,name:String(x.name||'')})):[];});
    return out;
  }

  // DLD 4%, brokerage % + 5% VAT, trustee 4,200 above AED 500K (2,100 at or below), title deed 580: all automatic.
  function calc(d){
    const unitPrice=num(d.unitPrice),paymentSeller=num(d.paymentSeller)||unitPrice;
    const dldFee=unitPrice*DLD_RATE;
    const brokerageVat=unitPrice*num(d.brokeragePercent)/100*(1+VAT);
    const trusteeFee=trusteeFor(unitPrice),titleDeed=unitPrice>0?TITLE_DEED:0;
    const plan=(d.installments||[]).filter(x=>x.label&&num(x.amount));
    const remainingPlan=plan.reduce((s,x)=>s+num(x.amount),0);
    const totalTransfer=paymentSeller+dldFee+trusteeFee+titleDeed+brokerageVat;
    return {unitPrice,paymentSeller,dldFee,brokerageVat,trusteeFee,titleDeed,plan,remainingPlan,totalTransfer,totalBuyer:totalTransfer+remainingPlan};
  }
  function rows(d,c){
    const r=[['Unit Price',c.unitPrice,'strong'],['Payment to Seller',c.paymentSeller],['DLD Fee (4%)',c.dldFee],['Trustee Office Fee',c.trusteeFee],
      ['Title Deed Fee',c.titleDeed],[`Brokerage Fee (${num(d.brokeragePercent)}%) + VAT`,c.brokerageVat],['Total on Transfer',c.totalTransfer,'transfer']];
    if(c.plan.length)r.push(['Total Remaining Payment Plan',c.remainingPlan,'plan']);
    r.push(['Total Cost for Buyer',c.totalBuyer,'total']);
    return r;
  }
  const waLink=d=>{
    const c=calc(d),text=`Hi, I am interested in this property:\n\n${d.title||'Property'}\n${[d.project,d.area].filter(Boolean).join(' - ')}\nPrice: ${money(c.unitPrice)}\n\nPlease share more details.`;
    return `https://wa.me/${phone(d.whatsapp)}?text=${encodeURIComponent(text)}`;
  };

  // ------------------------------------------------------------------ web page
  function render(raw){
    const d=normalize(raw),c=calc(d);
    const details=DETAILS.filter(([k])=>d[k]).map(([k,l])=>`<div class="pbCell"><span>${l}</span><strong>${esc(d[k])}</strong></div>`).join('');
    const cls={strong:'pbStrong',transfer:'pbTransfer',plan:'pbPlan',total:'pbTotal'};
    const row=([l,v,k])=>`<tr class="${cls[k]||''}"><td>${esc(l)}</td><td>${money(v)}</td></tr>`;
    const media=MEDIA.filter(([k])=>d[k].length).map(([k,label])=>`<section class="pbMedia pbMedia-${k}"><h2>${label}${k!=='pictures'&&d[k].length>1?'s':''}</h2>
      <div class="pbMediaGrid">${d[k].map(x=>`<a href="${esc(mediaUrl(x.path))}" target="_blank" rel="noopener"><img src="${esc(mediaUrl(x.path))}" alt="${esc(x.name||label)}" loading="lazy"></a>`).join('')}</div></section>`).join('');
    return `<article class="pbDoc">
      <header class="pbHead"><h1>${esc(d.title||'Property')}</h1>${d.subtitle?`<p>${esc(d.subtitle)}</p>`:''}</header>
      ${details?`<section><h2>Property Details</h2><div class="pbGrid">${details}</div></section>`:''}
      <section><h2>Payment Breakdown</h2><table class="pbTable"><tbody>${rows(d,c).map(row).join('')}</tbody></table></section>
      ${c.plan.length?`<section><h2>Remaining Installments</h2><table class="pbTable"><tbody>${c.plan.map(x=>row([x.label,num(x.amount)])).join('')}</tbody></table></section>`:''}
      ${d.notes?`<p class="pbNotes">${esc(d.notes)}</p>`:''}
      ${phone(d.whatsapp)?`<a class="pbWa" href="${esc(waLink(d))}" target="_blank" rel="noopener">Contact on WhatsApp</a>`:''}
      <p class="pbFoot">Figures are indicative and subject to final confirmation.</p>
      ${media}
    </article>`;
  }

  // ------------------------------------------------------------------ PDF (vector text, images embedded at full resolution)
  const loadScript=src=>new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>fail(new Error('Could not load '+src));document.head.append(s);});
  let pdfLib=null;
  function pdfMake(){
    if(!pdfLib)pdfLib=loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js')
      .then(()=>loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js')).then(()=>window.pdfMake)
      .catch(e=>{pdfLib=null;throw e;});
    return pdfLib;
  }
  async function dataUrl(path){
    const r=await fetch(mediaUrl(path),{cache:'force-cache'});
    if(!r.ok)throw new Error('Image missing: '+path);
    const b=await r.blob();
    return await new Promise((ok,fail)=>{const f=new FileReader();f.onload=()=>ok(f.result);f.onerror=fail;f.readAsDataURL(b);});
  }

  async function buildPdf(raw){
    const d=normalize(raw),c=calc(d),pm=await pdfMake();
    const INK='#0f172a',MUTED='#64748b',LINE='#e2e8f0',SOFT='#f8fafc';
    const fills={strong:SOFT,transfer:'#fdecec',plan:'#e9f7ef',total:INK};
    const lines={hLineWidth:(i,n)=>i===0||i===n.table.body.length?0:0.6,vLineWidth:()=>0,hLineColor:()=>LINE,paddingLeft:()=>9,paddingRight:()=>9,paddingTop:()=>6,paddingBottom:()=>6};
    const content=[{text:d.title||'Property',style:'h1'}];
    if(d.subtitle)content.push({text:d.subtitle,style:'sub'});
    content.push({canvas:[{type:'line',x1:0,y1:0,x2:515,y2:0,lineWidth:2,lineColor:INK}],margin:[0,8,0,16]});
    const det=DETAILS.filter(([k])=>d[k]).map(([k,l])=>({stack:[{text:l.toUpperCase(),style:'lab'},{text:d[k],style:'val'}],fillColor:SOFT}));
    if(det.length){
      while(det.length%4)det.push({text:''});
      const body=[];for(let i=0;i<det.length;i+=4)body.push(det.slice(i,i+4));
      content.push({text:'Property Details',style:'h2'},{table:{widths:['*','*','*','*'],body},layout:{hLineWidth:()=>3,vLineWidth:()=>3,hLineColor:()=>'#fff',vLineColor:()=>'#fff',paddingLeft:()=>8,paddingRight:()=>8,paddingTop:()=>6,paddingBottom:()=>6},margin:[-3,0,-3,14]});
    }
    const payRow=([l,v,k])=>[{text:l,bold:!!k,color:k==='total'?'#fff':INK,fillColor:fills[k]},{text:money(v),bold:true,alignment:'right',color:k==='total'?'#fff':INK,fillColor:fills[k],noWrap:true}];
    content.push({text:'Payment Breakdown',style:'h2'},{table:{widths:['*','auto'],body:rows(d,c).map(payRow)},layout:lines,margin:[0,0,0,14]});
    if(c.plan.length)content.push({text:'Remaining Installments',style:'h2'},{table:{widths:['*','auto'],body:c.plan.map(x=>payRow([x.label,num(x.amount)]))},layout:lines,margin:[0,0,0,14]});
    if(d.notes)content.push({table:{widths:['*'],body:[[{text:d.notes,fillColor:SOFT,margin:[4,4,4,4]}]]},layout:{hLineWidth:()=>0,vLineWidth:i=>i===0?3:0,vLineColor:()=>'#4338ca'},margin:[0,0,0,12]});
    if(phone(d.whatsapp))content.push({text:[{text:'Contact on WhatsApp: '},{text:'+'+phone(d.whatsapp),link:waLink(d),color:'#15803d',bold:true,decoration:'underline'}],margin:[0,0,0,8]});
    content.push({text:'Figures are indicative and subject to final confirmation.',style:'foot'});

    for(const [k,label] of MEDIA){
      if(!d[k].length)continue;
      const imgs=await Promise.all(d[k].map(x=>dataUrl(x.path)));
      if(k==='pictures'){
        for(let i=0;i<imgs.length;i+=6){
          const page=imgs.slice(i,i+6),body=[];
          for(let j=0;j<page.length;j+=2)body.push([0,1].map(n=>page[j+n]?{image:page[j+n],fit:[250,205],alignment:'center'}:{text:''}));
          content.push({text:label,style:'h2',pageBreak:'before'},{table:{widths:['*','*'],body},layout:{hLineWidth:()=>0,vLineWidth:()=>0,paddingTop:()=>5,paddingBottom:()=>5}});
        }
      }else{
        imgs.forEach((img,i)=>content.push({text:imgs.length>1?`${label} ${i+1}`:label,style:'h2',pageBreak:'before'},{image:img,fit:[515,700],alignment:'center'}));
      }
    }
    const doc={pageSize:'A4',pageMargins:[40,40,40,46],content,
      info:{title:[d.title,d.subtitle].filter(Boolean).join(' · ')||'Property Breakdown'},
      defaultStyle:{fontSize:10.5,color:INK,lineHeight:1.2},
      styles:{h1:{fontSize:22,bold:true},sub:{fontSize:12,bold:true,color:MUTED,margin:[0,3,0,0]},h2:{fontSize:13,bold:true,margin:[0,0,0,7]},
        lab:{fontSize:7,bold:true,color:MUTED,characterSpacing:0.4},val:{fontSize:10,bold:true,margin:[0,2,0,0]},foot:{fontSize:8.5,color:MUTED,margin:[0,4,0,0]}},
      footer:(p,n)=>({text:`${d.title||'Property Breakdown'} · ${p} / ${n}`,alignment:'center',fontSize:8,color:MUTED,margin:[0,14,0,0]})};
    return await new Promise((ok,fail)=>{try{pm.createPdf(doc).getBlob(ok);}catch(e){fail(e);}});
  }
  const pdfName=d=>((d.title||'Property breakdown')+(d.subtitle?' - '+d.subtitle:'')).replace(/[\\/:*?"<>|]+/g,' ').trim()+'.pdf';
  async function downloadPdf(raw){
    const blob=await buildPdf(raw),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=pdfName(normalize(raw));document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return blob;
  }

  // ------------------------------------------------------------------ links
  // Share links carry the breakdown in the URL (UTF-8 safe base64url), so clients need no login.
  function encode(d){
    const b=btoa(unescape(encodeURIComponent(JSON.stringify(normalize(d)))));
    return b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decode(s){
    let b=String(s||'').trim().replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';
    return normalize(JSON.parse(decodeURIComponent(escape(atob(b)))));
  }
  // Accepts a CRM client link, an old property-breakdown-generator link, or the raw data string.
  function fromLink(text){
    const t=String(text||'').trim(),m=t.match(/[?&](?:d|data)=([^&#\s]+)/);
    return decode(m?decodeURIComponent(m[1]):t);
  }

  root.PropertyBreakdown={FIELDS,MEDIA,normalize,calc,render,encode,decode,fromLink,money,num,mediaUrl,buildPdf,downloadPdf,pdfName,trusteeFor};
})(window);
