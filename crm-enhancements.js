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
  load('crm-enhancements-core.js?v=20260911')
    .then(()=>load('crm-stability.js?v=20260914c'))
    .then(()=>load('owner-data-update-20260914.js?v=1'))
    .then(()=>load('alana-transactions.js?v=20261005'))
    .catch(error=>console.error('CRM enhancement loader failed:',error));
})();