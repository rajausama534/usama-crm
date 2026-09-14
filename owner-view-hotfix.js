(()=>{
  'use strict';

  const ownerId = value => String(value ?? '').trim();

  async function markOwnerContactedFinal(id, type='Contact') {
    id = ownerId(id);
    if (!id || typeof db === 'undefined' || typeof TABLE_NAME === 'undefined') return;

    try {
      const { data, error } = await db.from(TABLE_NAME)
        .select('status')
        .eq('id', id)
        .single();
      if (error) throw error;

      const currentStatus = String(data?.status || 'New').trim();
      const payload = { last_contacted: typeof today === 'function' ? today() : new Date().toISOString().slice(0,10) };
      if (!currentStatus || currentStatus === 'New') payload.status = 'Contacted';

      const { error: updateError } = await db.from(TABLE_NAME).update(payload).eq('id', id);
      if (updateError) throw updateError;

      if (typeof U6_OWNER_ACTIVITIES !== 'undefined') {
        try {
          await db.from(U6_OWNER_ACTIVITIES).insert([{
            owner_id: id,
            activity_type: type,
            details: type === 'WhatsApp' ? 'WhatsApp message initiated' : 'Call initiated',
            created_by: typeof currentUserEmail !== 'undefined' ? (currentUserEmail || null) : null
          }]);
        } catch (_) {}
      }

      if (typeof loadData === 'function') loadData();
    } catch (e) {
      console.warn('Owner automatic Contacted update failed:', e);
    }
  }

  window.markOwnerContactedFinal = markOwnerContactedFinal;
  window.markOwnerContacted = markOwnerContactedFinal;

  // WhatsApp buttons throughout Owners already call this function.
  // Replace it at the final load stage so New -> Contacted always persists.
  window.u6LogOwnerWhatsApp = async function(ownerId, message) {
    await markOwnerContactedFinal(ownerId, 'WhatsApp');
  };

  // Make any callButton generated after this patch update status as well.
  if (typeof window.callButton === 'function') {
    window.callButton = function(row) {
      const phone = typeof get === 'function'
        ? get(row, ['phone1','phone2','phone','mobile','contact'])
        : (row.phone1 || row.phone2 || row.phone || row.mobile || row.contact || '');
      const formatted = typeof formatPhone === 'function' ? formatPhone(phone) : String(phone).replace(/\D/g,'');
      if (!formatted) return '';
      return `<a class="callBtn" href="tel:+${formatted}" onclick="markOwnerContactedFinal('${row.id}','Call')">Call</a>`;
    };
  }

  // Owner profile Call buttons are rendered separately. Wire them after profile opens.
  if (typeof window.openOwnerProfile === 'function') {
    const originalOpenOwnerProfile = window.openOwnerProfile;
    window.openOwnerProfile = async function(row) {
      const result = await originalOpenOwnerProfile.apply(this, arguments);
      setTimeout(() => {
        document.querySelectorAll('.modalOverlay a.callBtn[href^="tel:"], .profileModal a.callBtn[href^="tel:"]').forEach(btn => {
          btn.onclick = () => { markOwnerContactedFinal(row?.id, 'Call'); };
        });
      }, 0);
      return result;
    };
  }

  function forceUnitSortForCluster() {
    const cluster = document.getElementById('clusterFilter');
    const sortField = document.getElementById('ownerSortField');
    const sortDirection = document.getElementById('ownerSortDirection');
    if (!cluster || !sortField) return false;

    if (cluster.value) {
      sortField.value = 'unit';
      if (sortDirection) sortDirection.value = 'asc';
      return true;
    }
    return false;
  }

  const clusterFilter = document.getElementById('clusterFilter');
  if (clusterFilter) {
    clusterFilter.addEventListener('change', () => {
      if (forceUnitSortForCluster() && typeof currentPage !== 'undefined') currentPage = 0;
      setTimeout(() => { if (typeof loadData === 'function') loadData(); }, 0);
    });
  }

  // Also enforce numeric unit order whenever data loads with a cluster selected.
  if (typeof window.loadData === 'function') {
    const originalLoadData = window.loadData;
    const patchedLoadData = async function() {
      forceUnitSortForCluster();
      return originalLoadData.apply(this, arguments);
    };
    patchedLoadData.__ownerViewFinalHotfix = true;
    window.loadData = patchedLoadData;
  }

  console.info('Owner view hotfix loaded: numeric cluster sorting + New to Contacted on WhatsApp/Call.');
})();
