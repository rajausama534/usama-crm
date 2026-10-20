(()=>{
  'use strict';
  const load=src=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    s.onload=resolve;
    s.onerror=()=>reject(new Error(`Unable to load ${src}`));
    document.body.appendChild(s);
  });

  // Keep the original CRM enhancement core, then load ONE final stability layer.
  window.crmEnhancementsReady = load('crm-enhancements-core.js?v=20261020-ui2')
    .then(()=>load('crm-stability.js?v=20261020-ui1'))
    .then(()=>load('owner-data-update-20260914.js?v=1'))
    // alana-transactions.js is no longer loaded: its patterns were double-escaped, so it deleted
    // existing Alana sale notes and attached one wrong sale to every Alana villa.
    .then(()=>load('rivana-transactions.js?v=20261005'))
    .then(()=>load('owner-related-rows.js?v=20261020-ui1'))
    .then(()=>load('crm-upgrade.js?v=20261020-ui1'))
    .then(()=>load('crm-calendar.js?v=20261020-ui1'))
    .then(()=>load('crm-workspace.js?v=20261020-ui2'))
    .then(()=>load('crm-dxb.js?v=20261020b'))
    .then(()=>load('crm-broadcast.js?v=20261020'))
    .then(()=>load('crm-status-system.js?v=2'))
    .catch(error=>console.error('CRM enhancement loader failed:',error));
})();