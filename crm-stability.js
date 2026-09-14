(()=>{
  'use strict';

  const ACTIVITY_TABLE = typeof U6_OWNER_ACTIVITIES !== 'undefined' ? U6_OWNER_ACTIVITIES : 'owner_activities';
  let renderToken = 0;

  const esc = value => String(value ?? '');
  const normalizeUnit = value => {
    const parts = esc(value).match(/\d+/g) || [];
    return parts.length ? String(Number(parts[parts.length - 1])) : '';
  };
  const numberFromUnit = value => {
    const match = esc(value).match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
  };
  const normalizedForMatch = value => esc(value).toLowerCase().replace(/,/g,'').replace(/\s+/g,' ').trim();

  function isSystemOnlyActivity(activity){
    const type = normalizedForMatch(activity?.activity_type);
    const details = normalizedForMatch(activity?.details);
    if(!details) return true;
    if(details === 'whatsapp message initiated' || details === 'call initiated') return true;
    if(details.startsWith('status changed')) return true;
    if(type === 'status change') return true;
    return false;
  }

  function latestVisibleRemark(activities, fallback='-'){
    const real = (activities || []).filter(a => !isSystemOnlyActivity(a));
    const manual = real.find(a => normalizedForMatch(a.activity_type) !== 'property transaction');
    return esc(manual?.details || real[0]?.details || fallback || '-').trim() || '-';
  }

  async function hydrateVisibleOwnerNotes(rows, token){
    try{
      if(!Array.isArray(rows) || !rows.length || typeof db === 'undefined') return;
      const ids = rows.map(r => String(r.id)).filter(Boolean);
      const {data,error} = await db.from(ACTIVITY_TABLE)
        .select('owner_id,activity_type,details,created_at')
        .in('owner_id',ids)
        .order('created_at',{ascending:false});
      if(error) throw error;
      if(token !== renderToken) return;

      const grouped = {};
      (data || []).forEach(a => {
        const key = String(a.owner_id);
        if(!grouped[key]) grouped[key] = [];
        grouped[key].push(a);
      });

      const trs = [...(document.querySelectorAll('#tableBody tr') || [])];
      rows.forEach((row,index) => {
        const fallback = typeof ownerRemarkValue === 'function'
          ? ownerRemarkValue(row)
          : (row.admin_remarks || row.agent_remarks || row.remarks || '-');
        const text = latestVisibleRemark(grouped[String(row.id)] || [], fallback);
        row.__u10_latest = text;

        const tr = trs[index];
        const cell = tr?.querySelector('.owner-col-remarks');
        if(cell){
          let node = cell.querySelector('.latestRemarkRead,.latestRemarkView,.remarksRead');
          if(!node){
            node = document.createElement('div');
            node.className = 'latestRemarkRead';
            cell.innerHTML = '';
            cell.appendChild(node);
          }
          node.textContent = text;
          node.title = text;
        }
      });
    }catch(error){
      console.warn('Owner notes hydration failed:', error);
    }
  }

  // One render hook only. It updates the visible Notes cells directly and never re-renders recursively.
  if(typeof window.renderData === 'function'){
    const baseRenderData = window.renderData;
    window.renderData = function(rows){
      const result = baseRenderData.apply(this, arguments);
      const token = ++renderToken;
      Promise.resolve().then(() => hydrateVisibleOwnerNotes(rows || [], token));
      return result;
    };
  }

  async function markOwnerContacted(id, type='Contact'){
    try{
      if(!id || typeof db === 'undefined' || typeof TABLE_NAME === 'undefined') return;
      const {data,error} = await db.from(TABLE_NAME).select('status').eq('id',id).single();
      if(error) throw error;

      const current = esc(data?.status || 'New').trim();
      const payload = { last_contacted: typeof today === 'function' ? today() : new Date().toISOString().slice(0,10) };
      if(!current || current === 'New') payload.status = 'Contacted';

      const {error:updateError} = await db.from(TABLE_NAME).update(payload).eq('id',id);
      if(updateError) throw updateError;

      try{
        await db.from(ACTIVITY_TABLE).insert([{
          owner_id:String(id),
          activity_type:type,
          details:type === 'WhatsApp' ? 'WhatsApp message initiated' : 'Call initiated',
          created_by:typeof currentUserEmail !== 'undefined' ? (currentUserEmail || null) : null
        }]);
      }catch(_){ }

      if(typeof loadData === 'function') await loadData();
    }catch(error){
      console.warn('Automatic owner Contacted update failed:', error);
    }
  }
  window.crmMarkOwnerContacted = markOwnerContacted;
  window.markOwnerContacted = markOwnerContacted;

  // Ensure Contacted exists in owner status menus.
  if(typeof window.getOwnerStatuses === 'function'){
    const baseStatuses = window.getOwnerStatuses;
    window.getOwnerStatuses = function(){
      const statuses = [...new Set(baseStatuses.apply(this,arguments) || [])];
      if(!statuses.includes('Contacted')){
        const newIndex = statuses.indexOf('New');
        statuses.splice(newIndex >= 0 ? newIndex + 1 : 0, 0, 'Contacted');
      }
      return statuses;
    };
  }

  // Final owner action buttons. They do not touch remarks.
  window.whatsappButton = function(row){
    const phone = typeof get === 'function' ? get(row,['phone1','phone2','phone','mobile','contact']) : (row.phone1 || row.phone2 || row.phone || '');
    const formatted = typeof formatPhone === 'function' ? formatPhone(phone) : esc(phone).replace(/\D/g,'');
    if(!formatted) return '-';
    const msg = typeof buildOwnerMessage === 'function' ? buildOwnerMessage(row) : '';
    return `<a class="waBtn" target="_blank" data-owner-id="${row.id}" onclick="crmMarkOwnerContacted('${row.id}','WhatsApp')" href="https://wa.me/${formatted}?text=${encodeURIComponent(msg)}">WhatsApp</a>`;
  };

  window.callButton = function(row){
    const phone = typeof get === 'function' ? get(row,['phone1','phone2','phone','mobile','contact']) : (row.phone1 || row.phone2 || row.phone || '');
    const formatted = typeof formatPhone === 'function' ? formatPhone(phone) : esc(phone).replace(/\D/g,'');
    if(!formatted) return '';
    return `<a class="callBtn" data-owner-id="${row.id}" href="tel:+${formatted}" onclick="crmMarkOwnerContacted('${row.id}','Call')">Call</a>`;
  };

  // Any legacy WhatsApp handler still called by a detail view uses the same safe contact logic.
  window.u6LogOwnerWhatsApp = async function(ownerId){
    await markOwnerContacted(ownerId,'WhatsApp');
  };

  function numericUnitSort(rows, direction='asc'){
    const factor = direction === 'desc' ? -1 : 1;
    return [...(rows || [])].sort((a,b) => {
      const av = numberFromUnit(a.unit_sort ?? a.unit);
      const bv = numberFromUnit(b.unit_sort ?? b.unit);
      if(av !== bv) return (av - bv) * factor;
      return esc(a.unit_sort ?? a.unit).localeCompare(esc(b.unit_sort ?? b.unit),undefined,{numeric:true,sensitivity:'base'}) * factor;
    });
  }

  async function fetchAllFilteredOwners(){
    const all = [];
    const batch = 1000;
    let from = 0;
    while(true){
      let q = db.from(TABLE_NAME).select('*').range(from,from + batch - 1);
      if(typeof applyAccessFilter === 'function') q = applyAccessFilter(q);
      if(typeof applyFilters === 'function') q = applyFilters(q);
      const {data,error} = await q;
      if(error) throw error;
      all.push(...(data || []));
      if(!data || data.length < batch) break;
      from += batch;
    }
    return all;
  }

  function updateOwnerPager(count, from, to){
    const totalPages = Math.max(1,Math.ceil(count / PAGE_SIZE));
    const statusNode = document.getElementById('status');
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if(statusNode) statusNode.textContent = `Showing ${count ? from + 1 : 0}-${Math.min(to,count)} of ${count} records`;
    if(pageInfo) pageInfo.textContent = `${currentPage + 1} / ${totalPages}`;
    if(prevBtn) prevBtn.disabled = currentPage === 0;
    if(nextBtn) nextBtn.disabled = currentPage + 1 >= totalPages;
  }

  // Final loadData implementation: when a cluster is selected, always sort unit numbers numerically before pagination.
  if(typeof window.loadData === 'function'){
    const baseLoadData = window.loadData;
    window.loadData = async function(){
      const cluster = document.getElementById('clusterFilter')?.value || '';
      if(!cluster) return baseLoadData.apply(this,arguments);

      try{
        if(typeof showLoading === 'function') showLoading();
        const sortField = document.getElementById('ownerSortField');
        const sortDirection = document.getElementById('ownerSortDirection');
        if(sortField) sortField.value = 'unit';
        if(sortDirection) sortDirection.value = 'asc';

        const all = numericUnitSort(await fetchAllFilteredOwners(),'asc');
        totalCount = all.length;
        const from = currentPage * PAGE_SIZE;
        const to = from + PAGE_SIZE;
        const pageRows = all.slice(from,to);
        if(typeof hideLoading === 'function') hideLoading();
        renderData(pageRows);
        updateOwnerPager(totalCount,from,to);
        return;
      }catch(error){
        console.error('Cluster numeric sort failed:',error);
        if(typeof hideLoading === 'function') hideLoading();
        return baseLoadData.apply(this,arguments);
      }
    };
  }

  const clusterFilter = document.getElementById('clusterFilter');
  if(clusterFilter){
    clusterFilter.addEventListener('change',()=>{
      if(clusterFilter.value){
        if(typeof currentPage !== 'undefined') currentPage = 0;
        const field = document.getElementById('ownerSortField');
        const direction = document.getElementById('ownerSortDirection');
        if(field) field.value = 'unit';
        if(direction) direction.value = 'asc';
      }
    },true);
  }

  // ---- Transaction imports: append only. Never delete/replace an old note. ----
  const TRANSACTION_IMPORT_KEY = 'crm_transaction_append_20260914_v1';

  async function textLines(path){
    const response = await fetch(path,{cache:'no-store'});
    if(!response.ok) throw new Error(`Unable to load ${path}`);
    return (await response.text()).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  }

  function hasTransactionSignature(text, amount, date){
    const hay = normalizedForMatch(text);
    const a = normalizedForMatch(amount);
    const d = normalizedForMatch(date);
    return Boolean(a && d && hay.includes(a) && hay.includes(d));
  }

  async function existingForOwners(ids){
    const out = [];
    for(let i=0;i<ids.length;i+=50){
      const {data,error} = await db.from(ACTIVITY_TABLE)
        .select('owner_id,activity_type,details,created_at')
        .in('owner_id',ids.slice(i,i+50));
      if(error) throw error;
      out.push(...(data || []));
    }
    return out;
  }

  async function appendTransactions(config){
    const items = await config.load();
    let q = db.from(TABLE_NAME).select('id,unit,community,cluster,admin_remarks,agent_remarks');
    q = config.filter(q);
    const {data:rows,error} = await q;
    if(error) throw error;
    if(!rows?.length) return {name:config.name,added:0,matched:0};

    const ids = rows.map(r=>String(r.id));
    const existing = await existingForOwners(ids);
    const byOwner = {};
    existing.forEach(a => {
      const key = String(a.owner_id);
      if(!byOwner[key]) byOwner[key] = [];
      byOwner[key].push(a);
    });

    const additions = [];
    let matched = 0;
    for(const row of rows){
      const unit = normalizeUnit(row.unit);
      const rowItems = items.filter(item => item.unit === unit && (!config.rowMatch || config.rowMatch(row,item)));
      for(const item of rowItems){
        matched++;
        const existingText = [row.admin_remarks,row.agent_remarks,...(byOwner[String(row.id)]||[]).map(a=>a.details)].filter(Boolean).join('\n');
        if(hasTransactionSignature(existingText,item.amount,item.date)) continue;
        additions.push({
          owner_id:String(row.id),
          activity_type:'Property Transaction',
          details:config.note(item),
          created_by:typeof currentUserEmail !== 'undefined' ? (currentUserEmail || null) : null
        });
      }
    }

    for(let i=0;i<additions.length;i+=50){
      const {error:insertError} = await db.from(ACTIVITY_TABLE).insert(additions.slice(i,i+50));
      if(insertError) throw insertError;
    }
    return {name:config.name,added:additions.length,matched};
  }

  const transactionConfigs = [
    {
      name:'Palmiera',
      load:async()=> (await textLines('data/palmiera-sales-transactions.txt')).map(line=>{
        const [unit,category,type,amount,startDate,beds,size,transactionLabel,soldBy] = line.split('|');
        return {unit:normalizeUnit(unit),category,type,amount,date:startDate,beds,size,transactionLabel,soldBy};
      }),
      filter:q=>q.or('cluster.ilike.%Palmiera%,community.ilike.%Palmiera%'),
      note:i=>`${i.transactionLabel || i.type || i.category || 'Transaction'}: AED ${i.amount} - ${i.date}${i.beds?`\n${i.beds}`:''}${i.size?`\nSize: ${i.size}`:''}`
    },
    {
      name:'Caya',
      load:async()=> (await textLines('data/caya-latest-transactions.txt')).map(line=>{
        const [unit,category,type,amount,startDate,endDate] = line.split('|');
        return {unit:normalizeUnit(unit),category,type,amount,date:startDate,endDate};
      }),
      filter:q=>q.or('cluster.ilike.%Caya%,community.ilike.%Caya%'),
      note:i=>`${i.category || 'Transaction'}${i.type?` - ${i.type}`:''}: AED ${i.amount} - ${i.date}`
    },
    {
      name:'Elie Saab',
      load:async()=> (await textLines('data/elie-saab-latest-transactions.txt')).map(line=>{
        const [cluster,unit,type,amount,date] = line.split('|');
        return {cluster,unit:normalizeUnit(unit),type,amount,date};
      }),
      filter:q=>q.ilike('cluster','%Saab%'),
      rowMatch:(row,item)=>normalizedForMatch(row.cluster).includes(normalizedForMatch(item.cluster)),
      note:i=>`Last Transaction - ${i.type}: AED ${i.amount} - ${i.date}`
    },
    {
      name:'Farm Gardens 2',
      load:async()=>{
        const paths=['data/fg2-part-1.txt','data/fg2-part-2.txt','data/fg2-part-3.txt','data/fg2-part-4.txt'];
        const lines=(await Promise.all(paths.map(textLines))).flat();
        return lines.map(line=>{const [unit,beds,plot,amount,date]=line.split('|');return {unit:normalizeUnit(unit),beds,plot,amount,date};});
      },
      filter:q=>q.ilike('cluster','%Farm Gardens 2%'),
      note:i=>`Type: ${i.beds}BR\nPlot: ${i.plot} sqft\nLast Transaction: AED ${i.amount} - ${i.date}`
    },
    {
      name:'Rivana',
      load:async()=>{
        const paths=['data/rivana-part-1.txt','data/rivana-part-2.txt','data/rivana-part-3.txt'];
        const lines=(await Promise.all(paths.map(textLines))).flat();
        return lines.map(line=>{const [unit,beds,plot,amount,date]=line.split('|');return {unit:normalizeUnit(unit),beds,plot,amount,date};});
      },
      filter:q=>q.ilike('cluster','%Rivana%'),
      note:i=>`Type: ${i.beds}BR\nPlot: ${i.plot} sqft\nLast Transaction: AED ${i.amount} - ${i.date}`
    }
  ];

  async function runTransactionAppend(){
    if(typeof db === 'undefined' || typeof TABLE_NAME === 'undefined' || typeof currentUserEmail === 'undefined' || !currentUserEmail) return;
    if(typeof isAdmin !== 'undefined' && !isAdmin) return;
    try{
      const results = [];
      for(const config of transactionConfigs) results.push(await appendTransactions(config));
      localStorage.setItem(TRANSACTION_IMPORT_KEY,'done');
      console.info('Transaction append completed without deleting old notes:',results);
      if(typeof loadData === 'function') await loadData();
    }catch(error){
      console.error('Transaction append failed:',error);
    }
  }

  let attempts = 0;
  const readyTimer = setInterval(()=>{
    attempts++;
    if(typeof currentUserEmail !== 'undefined' && currentUserEmail && (typeof isAdmin === 'undefined' || isAdmin)){
      clearInterval(readyTimer);
      runTransactionAppend();
      try{ if(typeof refreshOwnerStatusUI === 'function') refreshOwnerStatusUI(); }catch(_){ }
      try{ if(typeof loadData === 'function') loadData(); }catch(_){ }
    }else if(attempts >= 120){
      clearInterval(readyTimer);
    }
  },500);

  console.info('CRM stability layer loaded: safe transaction append, owner contact status, numeric cluster sorting, latest note display.');
})();
