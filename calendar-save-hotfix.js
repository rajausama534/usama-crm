/* Fix manual calendar events incorrectly inserting null lead_id */
window.saveEvent = async function saveEventHotfix(){
  const get=id=>document.getElementById(id);
  const id=get('eventId')?.value||'';
  const table=get('eventTable')?.value||'';
  const source=get('participantSource')?.value||'manual';
  const type=get('eventType')?.value||'Meeting';
  const date=get('eventDate')?.value||'';
  const time=get('eventTime')?.value||'';
  const title=(get('eventTitle')?.value||'').trim();
  const location=(get('eventDetails')?.value||'').trim();

  if(!date||!time){ alert('Select date and time'); return; }
  const when=new Date(`${date}T${time}:00`).toISOString();
  const combined=title ? `${title}${location?`\n${location}`:''}` : location;

  try{
    // Manual participants must never be inserted into lead_activities.
    if(source==='manual' || table==='manual'){
      const name=(get('manualName')?.value||'').trim();
      if(!name){ alert('Enter participant name'); return; }
      let rows=typeof manualEvents==='function' ? manualEvents() : JSON.parse(localStorage.getItem('usama_crm_manual_events')||'[]');
      if(id){
        rows=rows.map(x=>String(x.id)===String(id)?{...x,type,name,title,details:location,when,kind:'manual',table:'manual'}:x);
      }else{
        rows.push({id:`m_${Date.now()}`,table:'manual',kind:'manual',personId:null,type,name,title,details:location,when});
      }
      if(typeof saveManualEvents==='function') saveManualEvents(rows);
      else localStorage.setItem('usama_crm_manual_events',JSON.stringify(rows));
      closeModal();
      if(typeof toast==='function') toast('Event saved');
      await loadCalendar();
      return;
    }

    const personId=get('participantSelect')?.value||'';
    if(!personId){ alert(`Select a ${source}`); return; }
    const targetTable=source==='owner'?'owner_activities':'lead_activities';
    const foreignKey=source==='owner'?'owner_id':'lead_id';

    if(id && table && table!=='manual'){
      const {error}=await db.from(table).update({activity_type:`Scheduled: ${type}`,details:combined,created_at:when}).eq('id',id);
      if(error) throw error;
    }else{
      const payload={[foreignKey]:personId,activity_type:`Scheduled: ${type}`,details:combined,created_at:when};
      const {error}=await db.from(targetTable).insert(payload);
      if(error) throw error;
    }

    closeModal();
    if(typeof toast==='function') toast('Event saved');
    await loadCalendar();
  }catch(error){
    console.error('Calendar save failed',error);
    alert(error?.message||'Failed to save event');
  }
};
