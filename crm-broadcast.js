(()=>{
  'use strict';
  // WhatsApp Broadcast: custom "From # / To #" range and a one-click send queue.
  // WhatsApp only lets a person press Send (wa.me / web.whatsapp.com links pre-fill the text); opening
  // many chats on a timer was blocked by the browser after the first one. Each click here opens the next
  // chat in the same WhatsApp tab (or the desktop app), so nothing is blocked and nothing is sent unseen.
  if(typeof db==='undefined')return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ---------------------------------------------------------------- custom range
  function addRangeInputs(){
    const sel=$('broadcastRange');if(!sel||$('crmRangeFrom'))return;
    const box=document.createElement('div');box.className='crmRangeBox';
    box.innerHTML='<label>From #<input id="crmRangeFrom" type="number" min="1" placeholder="1"></label><label>To #<input id="crmRangeTo" type="number" min="1" placeholder="20"></label><button type="button" class="crmBtn crmBtnSm" id="crmRangeApply">Select</button>';
    sel.closest('div').after(box);
    const apply=()=>{
      const rows=typeof v8BroadcastRows!=='undefined'?v8BroadcastRows:[];
      if(!rows.length){$('broadcastRangeInfo').textContent='Choose a community and cluster first.';return;}
      let a=Math.max(1,Number($('crmRangeFrom').value||1)),b=Math.min(rows.length,Number($('crmRangeTo').value||rows.length));
      if(b<a)[a,b]=[b,a];
      sel.add(new Option(`${a}–${b}`,`${a-1}:${b}`),1);sel.value=`${a-1}:${b}`;
      loadBroadcastRangeContacts();
    };
    $('crmRangeApply').onclick=apply;
    ['crmRangeFrom','crmRangeTo'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply();}}));
  }
  // number the contacts in the picker so a range is easy to choose
  const baseLoad=window.loadBroadcastRangeContacts;
  if(typeof baseLoad==='function'){
    window.loadBroadcastRangeContacts=function(){
      const r=baseLoad.apply(this,arguments);
      const [start]=String($('broadcastRange')?.value||'0:0').split(':').map(Number);
      document.querySelectorAll('#broadcastPicker .broadcastPickRow strong').forEach((s,i)=>{if(!s.dataset.n){s.dataset.n=1;s.insertAdjacentHTML('afterbegin',`<span class="crmPickNo">#${start+i+1}</span> `);}});
      return r;
    };
  }

  // ---------------------------------------------------------------- send queue
  let queue=[],pos=0;
  const phoneOf=r=>formatPhone(get(r,['phone1','phone2']));
  const msgOf=r=>typeof buildBroadcastMessage==='function'?buildBroadcastMessage(r):applyBroadcastTemplate($('broadcastMessage').value.trim(),r);
  function panel(){
    let p=$('crmSendQueue');
    if(!p){p=document.createElement('div');p.id='crmSendQueue';p.className='crmSendQueue';($('broadcastQueue')||$('broadcastProgressText')).before(p);}
    return p;
  }
  function render(){
    const p=panel();
    if(!queue.length){p.innerHTML='';return;}
    const done=queue.filter(x=>x.state).length;
    $('broadcastProgressBar').style.width=Math.round(done/queue.length*100)+'%';
    $('broadcastProgressText').textContent=`${done} of ${queue.length} handled`;
    if(pos>=queue.length){p.innerHTML=`<div class="crmQDone"><strong>All ${queue.length} contacts handled.</strong> ${queue.filter(x=>x.state==='opened').length} opened in WhatsApp, ${queue.filter(x=>x.state==='skipped').length} skipped.</div>`;return;}
    const c=queue[pos];
    p.innerHTML=`<div class="crmQHead"><span>Contact ${pos+1} of ${queue.length}</span><label class="crmQApp">Open in <select id="crmQApp"><option value="web">WhatsApp Web</option><option value="app">WhatsApp app</option></select></label></div>
      <div class="crmQCard"><strong>${esc(c.row.owner||'Owner')}</strong><span>${esc([c.row.community,c.row.cluster,c.row.unit&&('Unit '+c.row.unit)].filter(Boolean).join(' · '))} · +${esc(c.phone)}</span><p>${esc(c.msg)}</p></div>
      <div class="crmQActions"><button type="button" class="crmBtn" data-q="stop">Stop</button><button type="button" class="crmBtn" data-q="skip">Skip</button>
      <button type="button" class="crmBtn crmBtnPrimary" data-q="open">Open in WhatsApp (${pos+1} of ${queue.length})</button></div>
      <p class="crmSub">Press <b>Enter</b> in WhatsApp to send, then come back and click again. Shortcut here: <b>Enter</b> opens the next chat.</p>`;
    try{$('crmQApp').value=localStorage.getItem('crm_wa_app')||'web';}catch(_){}
    $('crmQApp').onchange=e=>{try{localStorage.setItem('crm_wa_app',e.target.value);}catch(_){}};
    p.querySelector('[data-q="open"]').onclick=openCurrent;
    p.querySelector('[data-q="skip"]').onclick=()=>{queue[pos].state='skipped';mark(queue[pos],'Skipped','badgeSkip');pos++;render();};
    p.querySelector('[data-q="stop"]').onclick=()=>{pos=queue.length;render();};
    p.querySelector('[data-q="open"]').focus();
  }
  function mark(c,text,cls){const n=$(`bq_${c.row.id}`)?.lastElementChild;if(n){n.textContent=text;n.className=cls;}}
  async function openCurrent(){
    const c=queue[pos];if(!c)return;
    const app=$('crmQApp')?.value==='app';
    const url=app?`whatsapp://send?phone=${c.phone}&text=${encodeURIComponent(c.msg)}`:`https://web.whatsapp.com/send?phone=${c.phone}&text=${encodeURIComponent(c.msg)}`;
    if(app)location.href=url;else window.open(url,'crmWhatsApp');
    c.state='opened';mark(c,'Opened','badgeOk');pos++;render();
    await db.from('whatsapp_broadcast_log').insert([{owner_id:String(c.row.id),phone:c.phone,message:c.msg,status:'opened',sent_by:currentUserEmail||null}]);
    await db.from(TABLE_NAME).update({last_contacted:today()}).eq('id',c.row.id);
  }
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||!$('broadcastModal')?.classList.contains('show')||!queue.length||pos>=queue.length)return;
    if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')&&!document.activeElement.closest('#crmSendQueue'))return;
    e.preventDefault();openCurrent();
  });

  window.startBroadcast=async function(){
    let rows=await getBroadcastRecipientRows();
    const seen=new Set();rows=rows.filter(r=>{const p=phoneOf(r);if(!p||seen.has(p))return false;seen.add(p);return true;});
    if(!rows.length){alert('Choose at least one contact with a valid phone number.');return;}
    queue=rows.map(row=>({row,phone:phoneOf(row),msg:msgOf(row),state:null}));pos=0;
    $('broadcastQueue').innerHTML=rows.map(r=>`<div class="broadcastQueueRow" id="bq_${r.id}"><span>${esc(clean(r.owner))} · ${esc(clean(r.unit))}</span><span class="badgeWait">Waiting</span></div>`).join('');
    render();
  };
  window.stopBroadcast=function(){pos=queue.length;render();};

  const baseOpen=window.openBroadcastModal;
  if(typeof baseOpen==='function'){
    window.openBroadcastModal=async function(){queue=[];pos=0;const r=await baseOpen.apply(this,arguments);addRangeInputs();render();
      const d=$('broadcastDelay');if(d)d.closest('div').style.display='none';
      const start=[...document.querySelectorAll('#broadcastModal button')].find(b=>/start/i.test(b.textContent));if(start)start.textContent='Prepare send queue';
      return r;};
  }
})();
