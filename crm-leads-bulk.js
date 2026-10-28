// Leads table: one View button per row (edit / delete live inside the lead view),
// row checkboxes, and bulk status / assign / delete once something is ticked.
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const selected=new Set();
  let pageIds=[],users=null;

  async function loadUsers(){
    if(users||!isAdmin)return users||[];
    const {data}=await db.from('user_access').select('email,name,active').order('name');
    users=(data||[]).filter(u=>u.active!==false&&u.email);
    if(!users.some(u=>u.email.toLowerCase()===String(currentUserEmail||'').toLowerCase()))users.unshift({email:currentUserEmail,name:'Me'});
    return users;
  }

  function bar(){
    let b=$('crmLeadBulkBar');if(b)return b;
    const box=document.querySelector('#leadsView .tablebox');if(!box)return null;
    b=document.createElement('div');b.id='crmLeadBulkBar';b.className='crmLeadBulkBar';
    box.before(b);
    return b;
  }

  async function paintBar(){
    const b=bar();if(!b)return;
    const n=selected.size,stages=getPipelineStages(),people=await loadUsers();
    b.hidden=!n;
    b.innerHTML=n?`<div class="crmBulkActions"><strong>${n} selected</strong>
        <select data-status><option value="">Change status…</option>${stages.map(s=>`<option>${esc(s)}</option>`).join('')}</select>
        ${isAdmin?`<select data-assign><option value="">Assign to…</option><option value="__none">Not assigned</option>${people.map(u=>`<option value="${esc(u.email)}">${esc(u.name||u.email)}</option>`).join('')}</select>
        <button type="button" class="crmBulkDelete" data-delete>Delete</button>`:''}<button type="button" data-clear>Clear</button></div>`:'';
    b.querySelector('[data-clear]')?.addEventListener('click',()=>{selected.clear();syncBoxes();});
    b.querySelector('[data-status]')?.addEventListener('change',e=>e.target.value&&bulkStatus(e.target.value));
    b.querySelector('[data-assign]')?.addEventListener('change',e=>e.target.value&&bulkAssign(e.target.value==='__none'?null:e.target.value));
    b.querySelector('[data-delete]')?.addEventListener('click',bulkDelete);
  }

  function syncBoxes(){
    document.querySelectorAll('#leadsTableBody .crmLeadPick').forEach(c=>{c.checked=selected.has(c.value);c.closest('tr')?.classList.toggle('crmPicked',c.checked);});
    const all=$('crmLeadPickAll');if(all){all.checked=pageIds.length>0&&pageIds.every(id=>selected.has(id));all.indeterminate=!all.checked&&pageIds.some(id=>selected.has(id));}
    paintBar();
  }

  async function done(msg){
    selected.clear();
    if(typeof showLeadSaved==='function')showLeadSaved();
    await loadLeads();
    $('leadStatusFilter')?.dispatchEvent(new Event('change')); // refreshes the stage counts
    if(typeof loadFollowupDashboard==='function')loadFollowupDashboard();
    if(msg)console.info(msg);
  }

  async function bulkStatus(status){
    const ids=[...selected];
    if(!confirm(`Change ${ids.length} lead${ids.length>1?'s':''} to "${status}"?`))return paintBar();
    const {data:old}=await db.from(LEADS_TABLE).select('id,status').in('id',ids);
    const {error}=await db.from(LEADS_TABLE).update({status,last_contacted:today()}).in('id',ids);
    if(error){alert('Failed to change status: '+error.message);return paintBar();}
    const logs=(old||[]).filter(r=>(r.status||'New')!==status).map(r=>({lead_id:r.id,activity_type:'Status Change',details:`Status changed from ${r.status||'-'} to ${status}.`,created_by:currentUserEmail||null}));
    if(logs.length)await db.from('lead_activities').insert(logs);
    done();
  }

  async function bulkAssign(email){
    const ids=[...selected],who=email?((users||[]).find(u=>u.email===email)?.name||email):'nobody';
    if(!confirm(`Assign ${ids.length} lead${ids.length>1?'s':''} to ${who}?`))return paintBar();
    const {error}=await db.from(LEADS_TABLE).update({assigned_to:email}).in('id',ids);
    if(error){alert('Failed to assign: '+error.message);return paintBar();}
    await db.from('lead_activities').insert(ids.map(id=>({lead_id:id,activity_type:'Assigned',details:email?`Assigned to ${who}.`:'Unassigned.',created_by:currentUserEmail||null})));
    done();
  }

  async function bulkDelete(){
    const ids=[...selected];
    if(!confirm(`Delete ${ids.length} lead${ids.length>1?'s':''}? This cannot be undone.`))return;
    const {error}=await db.from(LEADS_TABLE).delete().in('id',ids);
    if(error){alert('Failed to delete leads: '+error.message);return;}
    done();
  }

  // Runs after crm-workspace's fitLeadsTable (both are scheduled with setTimeout 0, this one later).
  function decorate(rows){
    const table=document.querySelector('#leadsView .leadsTable');if(!table)return;
    pageIds=(rows||[]).map(r=>String(r.id));
    [...selected].forEach(id=>{if(!pageIds.includes(id))selected.delete(id);});
    const headRow=table.querySelector('thead tr');
    if(headRow&&!headRow.querySelector('[data-col="select"]')){
      headRow.insertAdjacentHTML('afterbegin','<th data-col="select"><input type="checkbox" id="crmLeadPickAll" aria-label="Select all leads on this page"></th>');
      $('crmLeadPickAll').onchange=e=>{pageIds.forEach(id=>e.target.checked?selected.add(id):selected.delete(id));syncBoxes();};
    }
    table.querySelectorAll('#leadsTableBody tr[data-record-id]').forEach(tr=>{
      const id=tr.dataset.recordId;
      if(!tr.querySelector('[data-col="select"]')){
        tr.insertAdjacentHTML('afterbegin',`<td data-col="select"><input type="checkbox" class="crmLeadPick" value="${esc(id)}" aria-label="Select lead"></td>`);
        tr.querySelector('.crmLeadPick').onchange=e=>{e.target.checked?selected.add(id):selected.delete(id);syncBoxes();};
      }
      const acts=tr.querySelector('.leadActions');
      if(acts&&!acts.dataset.view){acts.dataset.view='1';acts.innerHTML=`<button type="button" class="crmBtn crmLeadViewBtn" onclick="openLeadDetail('${esc(id)}')">View</button>`;}
    });
    table.querySelectorAll('#leadsTableBody td[colspan]').forEach(td=>{td.colSpan=table.querySelectorAll('thead th').length;});
    syncBoxes();
  }

  if(typeof renderLeads==='function'){
    const base=renderLeads;
    renderLeads=function(rows){const r=base.apply(this,arguments);setTimeout(()=>decorate(rows),0);return r;};
  }

  // Delete lives in the lead view next to Edit Lead (admins only, same as the database rule).
  if(typeof renderLeadDetail==='function'){
    const base=renderLeadDetail;
    renderLeadDetail=function(lead){
      const r=base.apply(this,arguments);
      const acts=document.querySelector('#leadDetailContent .u6HeaderActions');
      if(isAdmin&&acts&&!acts.querySelector('.crmLeadDeleteBtn')){
        const b=document.createElement('button');b.type='button';b.className='darkBtn crmLeadDeleteBtn';b.textContent='Delete';
        b.onclick=async()=>{if(!confirm('Delete this lead? This cannot be undone.'))return;const {error}=await db.from(LEADS_TABLE).delete().eq('id',lead.id);if(error){alert('Failed to delete lead: '+error.message);return;}closeLeadDetail();done();};
        acts.append(b);
      }
      return r;
    };
  }

  if(!$('leadsView')?.classList.contains('hidden')&&$('leadsTableBody')?.children.length&&typeof loadLeads==='function')loadLeads();
})();
