(()=>{
  'use strict';
  // CRM add-on modules. They used to be fetched one after another (each download waited for the
  // previous one to run); now they all download in parallel and still RUN in this exact order
  // (dynamic scripts with async=false keep insertion order). A module that fails to load is
  // reported and the others still run.
  const MODULES=[
    'crm-enhancements-core.js?v=20261024-notes',
    'crm-stability.js?v=20261024-notes',
    'owner-data-update-20260914.js?v=1',
    // alana-transactions.js is no longer loaded: its patterns were double-escaped, so it deleted
    // existing Alana sale notes and attached one wrong sale to every Alana villa.
    // rivana-transactions.js is retired: sale notes now use one format (20261024100000_sale_note_format.sql).
    'owner-related-rows.js?v=20261020-ui1',
    'crm-upgrade.js?v=20261102',
    'crm-calendar.js?v=20261028',
    'crm-workspace.js?v=20261104b',
    'crm-dxb.js?v=20261020b',
    'crm-broadcast.js?v=20261020',
    'crm-status-system.js?v=2',
    'crm-leads-bulk.js?v=2',
    'lead-contacted-hotfix.js?v=2',
    'crm-breakdown-doc.js?v=2',
    'crm-breakdown.js?v=3',
    'crm-cluster-data.js?v=3'
  ];
  const load=src=>new Promise(resolve=>{
    const s=document.createElement('script');
    s.src=src;s.async=false;
    s.onload=()=>resolve(true);
    s.onerror=()=>{console.error('CRM enhancement loader failed:',src);resolve(false);};
    document.body.appendChild(s);
  });
  window.crmEnhancementsReady=Promise.all(MODULES.map(load));
})();
