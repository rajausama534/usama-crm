(()=>{
  'use strict';

  async function autoMarkLeadContacted(id){
    try{
      const { data, error } = await db.from(LEADS_TABLE).select('status').eq('id', id).single();
      if (error) throw error;

      const currentStatus = (data?.status || 'New').trim();
      const payload = { last_contacted: today() };
      if (currentStatus === 'New') payload.status = 'Contacted';

      const { error: updateError } = await db.from(LEADS_TABLE).update(payload).eq('id', id);
      if (updateError) throw updateError;

      if (currentStatus === 'New' && typeof logLeadActivity === 'function') {
        try { await logLeadActivity(id, 'Status Change', 'Status changed from New to Contacted automatically after contact.'); } catch (_) {}
      }

      if (typeof loadLeads === 'function') loadLeads();
    } catch (e) {
      console.warn('Auto contact status update failed:', e);
    }
  }

  window.autoMarkLeadContacted = autoMarkLeadContacted;

  // Existing WhatsApp buttons already call markLeadContacted().
  // Upgrade that function so it also changes New -> Contacted.
  window.markLeadContacted = autoMarkLeadContacted;

  // Lead detail WhatsApp uses u6LogLeadWhatsApp(). Keep its existing logging,
  // then apply the same automatic status update.
  if (typeof window.u6LogLeadWhatsApp === 'function') {
    const originalLogWhatsApp = window.u6LogLeadWhatsApp;
    window.u6LogLeadWhatsApp = async function(leadId){
      await originalLogWhatsApp(leadId);
      await autoMarkLeadContacted(leadId);
    };
  }

  function wireCallButtons(rows){
    if (!Array.isArray(rows)) return;
    const phoneToId = new Map();
    rows.forEach(row => {
      const formatted = typeof formatPhone === 'function' ? formatPhone(row.phone) : String(row.phone || '').replace(/\D/g,'');
      if (formatted) phoneToId.set(formatted, String(row.id));
    });

    ['leadsTableBody','leadMobileCards'].forEach(containerId => {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.querySelectorAll('a.callBtn[href^="tel:"]').forEach(btn => {
        const phone = (btn.getAttribute('href') || '').replace('tel:+','').replace(/\D/g,'');
        const id = phoneToId.get(phone);
        if (id) btn.onclick = () => { autoMarkLeadContacted(id); };
      });
    });
  }

  // Re-wire table/mobile Call buttons every time leads render.
  if (typeof window.renderLeads === 'function') {
    const originalRenderLeads = window.renderLeads;
    window.renderLeads = function(rows){
      const result = originalRenderLeads.apply(this, arguments);
      wireCallButtons(rows);
      return result;
    };
  }

  // Lead detail Call button does not carry an ID, so wire it after detail opens.
  if (typeof window.openLeadDetail === 'function') {
    const originalOpenLeadDetail = window.openLeadDetail;
    window.openLeadDetail = async function(id){
      const result = await originalOpenLeadDetail.apply(this, arguments);
      const modal = document.getElementById('leadDetailModal');
      modal?.querySelectorAll('a.callBtn[href^="tel:"]').forEach(btn => {
        btn.onclick = () => { autoMarkLeadContacted(id); };
      });
      return result;
    };
  }
})();
