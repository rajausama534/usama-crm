(()=>{
  'use strict';
  const load=src=>new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    s.onload=resolve;
    s.onerror=()=>reject(new Error(`Unable to load ${src}`));
    document.body.appendChild(s);
  });
  load('crm-enhancements-core.js?v=20260911')
    .then(()=>load('caya-transactions.js?v=20260911'))
    .then(()=>load('palmiera-transactions.js?v=20260914b'))
    .then(()=>load('numeric-unit-sort.js?v=20260914b'))
    .then(()=>load('lead-contacted-hotfix.js?v=20260914a'))
    .catch(error=>console.error('CRM enhancement loader failed:',error));
})();
