/* Run: NODE_PATH=<directory containing playwright> node tests/mobile-workspace.cjs
   Real browser + real Supabase browser client, with every external request intercepted.
   Fixtures only: no production request, login or data mutation can leave this harness. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const SDK=process.env.CRM_TEST_SUPABASE_SDK;assert.ok(SDK,'Set CRM_TEST_SUPABASE_SDK to a local Supabase UMD bundle; see tests/README.md');
const BIN=process.env.CRM_TEST_CHROMIUM;
const measurements=[];
const out=process.env.CRM_TEST_OUTPUT||'/tmp/crm-test-results';fs.mkdirSync(out,{recursive:true});
const stages=['New','No Response','Interested','Viewing Scheduled','Visit Done','Negotiation','Won','Lost'];
const admin='thechussar@gmail.com',uid='11111111-1111-4111-8111-111111111111',lid='22222222-2222-4222-8222-222222222222',eid='33333333-3333-4333-8333-333333333333';
const session={access_token:[{alg:'HS256',typ:'JWT'},{sub:uid,email:admin,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400},'fixture'].map(v=>typeof v==='string'?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.'),refresh_token:'fixture',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user:{id:uid,email:admin,app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated',created_at:new Date().toISOString()}};
function fixture(){
 const owners=Array.from({length:33000},(_,i)=>({id:i+1,community:i<300?'The Valley':'Other community',cluster:i<150?'Alana':i<300?'Farm Gardens 2':'Other cluster',unit:String(i%150+1),unit_natural:String(i%150+1).padStart(12,'0'),owner:`OWNER ${i+1}`,phone1:`971501${String(i+1).padStart(6,'0')}`,phone2:null,status:i%4===0?'For Sale':'New',data_source:'Master',admin_remarks:`Owner note ${i+1}`,agent_remarks:null,remarks:null,last_contacted:null,assigned_to:admin}));
 const leads=stages.map((status,i)=>({id:i===0?lid:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,name:`Lead ${i+1}`,phone:'971501234567',project_inquired:'Alana',status,budget:'3M',bedroom:'4BR',property_type:'Villa',assigned_to:admin,notes:'Looking for a corner villa. Call after 6 pm.',source:'Referral',created_at:new Date().toISOString(),lead_receive_date:'2026-10-20',follow_up_date:'2026-10-21',follow_up_time:'18:00',last_contacted:'2026-10-19'}));
 for(const i of [103,104,105,106,107]){owners[i].phone1=owners[3].phone1;owners[i].owner=owners[3].owner;}
 owners[1].phone1='-';owners[1].status='Not Interested';owners[2].status='Invalid Number';
 leads[0].notes='A long note with sensible wrapping. '+('Please discuss the corner villa and arrange a viewing after 6 pm. '.repeat(8));
 return {owners,owners_list:owners,leads,user_access:[{id:1,email:admin,name:'Usama',role:'admin',active:true,can_export:true,assigned_communities:[],assigned_clusters:[]}],community_cluster_catalog:[{community:'The Valley',cluster:'Alana'},{community:'The Valley',cluster:'Farm Gardens 2'}],crm_projects:[{id:1,name:'Alana'}],owner_activities:owners.slice(0,150).map((o,i)=>({id:i+1,owner_id:String(o.id),activity_type:'Note',details:`Discussion for villa ${o.unit}`,created_at:new Date().toISOString(),created_by:admin})),lead_activities:[],crm_events:[{id:eid,lead_id:lid,title:'Villa viewing',event_type:'Property Viewing',starts_at:new Date(Date.now()+3600000).toISOString(),status:'Scheduled',remind_minutes:60,assigned_to:admin,created_by:admin,leads:{name:'Lead 1',phone:'971501234567',status:'New'}}],crm_notification_reads:[],unit_details:[],property_transactions:[],dld_transactions:[],crm_change_log:[],whatsapp_broadcast_log:[]};
}
function matches(row,key,value){
 const pos=value.indexOf('.'),op=value.slice(0,pos),v=value.slice(pos+1),r=String(row[key]??'');
 if(op==='eq')return r===v;if(op==='neq')return r!==v;
 if(op==='in')return v.slice(1,-1).split(',').map(x=>x.replace(/^"|"$/g,'')).includes(r);
 if(op==='ilike'||op==='like')return r.toLowerCase().includes(v.replaceAll('%','').toLowerCase());
 if(op==='is')return v==='null'?row[key]==null:r===v;
 if(op==='gte')return r>=v;if(op==='lte')return r<=v;if(op==='gt')return r>v;if(op==='lt')return r<v;
 if(op==='not')return v==='is.null'?row[key]!=null:true;return true;
}
async function setup(browser,width){
 const data=fixture(),requests=[],errors=[];
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width<801,hasTouch:width<801,deviceScaleFactor:1,timezoneId:'Asia/Dubai'});
 await context.addInitScript(({session})=>{
  localStorage.setItem('sb-vnydxkmhrcesdffpfjpc-auth-token',JSON.stringify(session));
  for(const key of ['fg2_notes_20260807_v2','rivana_notes_20260818_v1','elie_saab_transaction_activities_20260906_v2','owner_data_update_20260914_v1','rivana_sales_transaction_activities_20261005_v1','crm_transaction_append_20260914_v1'])localStorage.setItem(key,'done');
 },{session});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='crm.test'){
   const p=path.join(root,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname));
   if(!p.startsWith(root)||!fs.existsSync(p))return route.fulfill({status:404,body:'Not found'});
   return route.fulfill({path:p,contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'text/plain'});
  }
  if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:process.env.CRM_TEST_FONT_DIR?[400,500,600].map(w=>`@font-face{font-family:Poppins;font-weight:${w};src:url(https://fonts.gstatic.com/fixture-${w}.ttf)}`).join(''):''});
  if(url.hostname==='fonts.gstatic.com'&&process.env.CRM_TEST_FONT_DIR)return route.fulfill({path:path.join(process.env.CRM_TEST_FONT_DIR,`poppins-${url.pathname.match(/(400|500|600)/)[0]}.ttf`),contentType:'font/ttf'});
  if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({path:SDK,contentType:'application/javascript'});
  if(url.hostname==='wa.me'||url.hostname==='web.whatsapp.com')return route.fulfill({contentType:'text/html',body:'<title>WhatsApp fixture</title><h1>External app</h1>'});
  if(url.hostname.endsWith('supabase.co')){
   requests.push({url:req.url(),method:req.method(),body:req.postData()});
   const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'content-range','content-type':'application/json'};
   if(req.method()==='OPTIONS')return route.fulfill({status:200,headers});
   const send=(body,count,status=200)=>route.fulfill({status,headers:{...headers,...(count!=null?{'content-range':`0-${Math.max(0,count-1)}/${count}`}:{})},body:JSON.stringify(body)});
   if(url.pathname.includes('/functions/v1/cluster-guide-api'))return send({clusters:[]});
   if(url.pathname.includes('/functions/v1/admin-users'))return send({users:data.user_access});
   if(url.pathname.startsWith('/auth/'))return send(url.pathname.includes('user')?session.user:session);
   const table=url.pathname.split('/').pop(),params=url.searchParams;
   if(table==='owners_list'&&params.get('or')?.includes('Slow'))await new Promise(r=>setTimeout(r,700));
   if(url.pathname.includes('/rpc/')){
    if(table==='crm_filter_options')return send([{community:'The Valley',cluster:'Alana',data_source:'Master'},{community:'The Valley',cluster:'Farm Gardens 2',data_source:'Master'}]);
    if(table==='crm_dashboard_stats')return send({owners:{records:33000,communities:2,clusters:3,units:33000},owner_status:{New:23930,'For Sale':9000,Contacted:0,'No Response':30,'Not Interested':34,'Invalid Number':6},owners_by_community:{'The Valley':300},leads:{total:8,new_7d:8},lead_status:Object.fromEntries(stages.map(s=>[s,1])),lead_source:{Referral:8},leads_by_week:[]});
    if(table==='crm_my_notifications')return send([{event_id:eid,kind:'due_soon',event_type:'Property Viewing',title:'Villa viewing',starts_at:data.crm_events[0].starts_at,lead_id:lid,lead_name:'Lead 1',is_read:data.crm_notification_reads.length>0}]);
    if(table==='crm_related_rows')return send(data.owners.filter(r=>[4,104,105,106,107,108].includes(r.id)));
    return send([]);
   }
   let rows=[...(data[table]||[])];
   for(const [k,v] of params){
    if(['select','order','limit','offset','on_conflict'].includes(k))continue;
    if(k==='or'){const parts=v.slice(1,-1).split(',');rows=rows.filter(r=>parts.some(p=>{const [f,...rest]=p.split('.');return matches(r,f,rest.join('.'));}));}
    else rows=rows.filter(r=>matches(r,k,v));
   }
   if(req.method()==='PATCH'){
    const payload=JSON.parse(req.postData()||'{}');rows.forEach(r=>Object.assign(r,payload));
    return send(req.headers().prefer?.includes('return=representation')?rows:[]);
   }
   if(req.method()==='POST'){
    let body=JSON.parse(req.postData()||'{}');const additions=Array.isArray(body)?body:[body];
    data[table]||=[];data[table].push(...additions.map(r=>({id:r.id||String(Date.now()),...(table==='crm_events'?{status:'Scheduled',created_by:admin}:{}),...r})));return send(additions,additions.length,201);
   }
   const count=rows.length;
   const orders=(params.get('order')||'').split(',').map(s=>s.split('.'));
   rows.sort((a,b)=>{for(const [k,dir] of orders){const n=String(a[k]??'').localeCompare(String(b[k]??''),undefined,{numeric:true});if(n)return dir==='desc'?-n:n;}return 0;});
   const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||1000);rows=rows.slice(offset,offset+limit);
   if(req.method()==='HEAD')return send(null,count);
   const single=req.headers().accept?.includes('application/vnd.pgrst.object+json');
   return send(single?(rows[0]||null):rows,count);
  }
  // Fonts and unrelated external assets are blocked. All CRM data calls must be fixture-only.
  return route.abort();
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.stack)});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text().slice(0,200))});page.on('dialog',d=>d.dismiss());
 await page.goto('http://crm.test/');
 await page.waitForFunction(()=>window.CRMStatus&&document.body.classList.contains('crmPremium')&&!document.getElementById('dashboardView').classList.contains('hidden'));
 await page.waitForTimeout(600);await page.evaluate(()=>document.fonts.ready);
 return {page,context,data,requests,errors};
}
async function nav(page,id){
 if(await page.locator('.crmMenuToggle').isVisible()){await page.locator('.crmMenuToggle').tap();await page.locator(id).tap();}else await page.locator(id).click();
}
async function owners(page){await nav(page,'#v7NavOwners');await page.waitForSelector('#mobileCards [data-record-id], #tableBody [data-record-id]',{state:'attached'});await page.waitForTimeout(200);}
async function filter(page){
 await page.selectOption('#communityFilter','The Valley');await page.selectOption('#clusterFilter','Alana');
 await page.waitForFunction(()=>document.querySelector('#mobileCards [data-record-id="30"]'));
 await page.waitForTimeout(400);
}
async function whatsapp(page,context,id){
 const a=page.locator(`#mobileCards [data-record-id="${id}"] .waBtn`);
 await a.scrollIntoViewIfNeeded();await page.evaluate(()=>scrollBy(0,-150));
 const before=await page.evaluate(()=>({y:scrollY,community:document.getElementById('communityFilter').value,cluster:document.getElementById('clusterFilter').value,search:document.getElementById('searchInput').value,page:currentPage}));
 const handle=await page.locator(`#mobileCards [data-record-id="${id}"]`).elementHandle();
 const popupPromise=context.waitForEvent('page');await a.tap();const popup=await popupPromise;await popup.waitForLoadState();await popup.bringToFront();await page.waitForTimeout(200);await page.bringToFront();await popup.close();await page.waitForTimeout(350);
 const after=await page.evaluate(()=>({y:scrollY,community:document.getElementById('communityFilter').value,cluster:document.getElementById('clusterFilter').value,search:document.getElementById('searchInput').value,page:currentPage}));
 assert.ok(Math.abs(before.y-after.y)<=3,`scroll moved: ${JSON.stringify({before,after})}`);assert.deepEqual({...before,y:0},{...after,y:0});assert.ok(await handle.evaluate(n=>n.isConnected),'contact action replaced the original card DOM');
 return {villa:id,scrollBefore:before.y,scrollAfter:after.y};
}

function contrast(fg,bg){
 const lum=rgb=>{const c=rgb.match(/[\d.]+/g).slice(0,3).map(v=>{v=Number(v)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
async function checkReadableFields(page,selector,width){
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);
  const fields=await page.locator(`${selector} :is(input:not([type=hidden]):not([type=checkbox]),select,textarea)`).evaluateAll(ns=>ns.filter(n=>n.getBoundingClientRect().width).map(n=>{const c=getComputedStyle(n);return {name:n.id||n.name,fg:c.color,bg:c.backgroundColor,placeholder:n.placeholder?getComputedStyle(n,"::placeholder").color:null};}));
  for(const f of fields){assert.ok(contrast(f.fg,f.bg)>=4.5,`Unreadable ${JSON.stringify(f)}`);if(f.placeholder)assert.ok(contrast(f.placeholder,f.bg)>=4.5,`Placeholder unreadable ${JSON.stringify(f)}`);if(theme==='light')assert.notEqual(f.bg,'rgb(6, 11, 18)',`${selector} ${f.name} forced dark`);}
  measurements.push({kind:'profileFields',width,selector,theme,fields});
 }
}
async function checkOwners(page,width){
 const report=await page.evaluate(()=>{
  const parent=innerWidth<801?'#mobileCards':'#tableBody';
  const selects=[...document.querySelectorAll(`${parent} select.statusSelect`)].filter(n=>['Not Interested','Invalid Number'].includes(n.value)).map(n=>{const c=getComputedStyle(n),ctx=document.createElement('canvas').getContext('2d');ctx.font=c.font;return {value:n.value,width:n.clientWidth,needed:ctx.measureText(n.value).width+parseFloat(c.paddingLeft)+parseFloat(c.paddingRight)+18};});
  return {width:innerWidth,page:document.documentElement.scrollWidth,selects};
 });
 if(width>=801){const actions=await page.locator('#tableBody [data-record-id="4"] .crmOwnerActions').evaluate(n=>{const cell=n.closest('td').getBoundingClientRect();return {left:cell.left,right:cell.right,buttons:[...n.querySelectorAll('button,a')].map(b=>({text:b.textContent,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))};});for(const b of actions.buttons)assert.ok(b.left>=actions.left&&b.right<=actions.right,`Actions clipped ${JSON.stringify(actions)}`);measurements.push({kind:'ownerActions',width,...actions});}
 assert.ok(report.page<=width);for(const s of report.selects)assert.ok(s.width>=s.needed,`Owner clipped ${JSON.stringify(s)}`);measurements.push({kind:'owners',...report});
 for(const selector of ['[data-unit-finder-entry="nav"]','[data-owner-finder-entry="nav"]','[data-cluster-guide-entry="nav"]','.crmMobileLogout','#v7NavBroadcast'])assert.equal(await page.locator(`${selector} svg`).count(),1,`Missing nav icon ${selector}`);
}
async function checkModal(page,width){
 for(const theme of ['light','dark']){
  await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.waitForTimeout(250);
  const fields=await page.locator('.crmEventModal :is(input:not([type=hidden]),select,textarea)').evaluateAll(nodes=>nodes.map(n=>{const c=getComputedStyle(n),r=n.getBoundingClientRect(),p=n.closest('.crmModalBody').getBoundingClientRect();return {name:n.name,fg:c.color,bg:c.backgroundColor,placeholder:n.placeholder?getComputedStyle(n,"::placeholder").color:null,left:r.left,right:r.right,min:p.left,max:p.right};}));
  measurements.push({kind:'eventForm',width,theme,fields});
  for(const f of fields){assert.ok(f.left>=f.min&&f.right<=f.max+1,`Field overflow ${width} ${JSON.stringify(f)}`);assert.ok(contrast(f.fg,f.bg)>=4.5,`Unreadable ${JSON.stringify(f)}`);if(f.placeholder)assert.ok(contrast(f.placeholder,f.bg)>=4.5,`Placeholder unreadable ${JSON.stringify(f)}`);if(theme==='light')assert.notEqual(f.bg,'rgb(6, 11, 18)');}
  const buttons=await page.locator('.crmEventModal>footer button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();const c=getComputedStyle(n);return {text:n.textContent,left:r.left,right:r.right,fg:c.color,bg:c.backgroundColor};}));for(const b of buttons){assert.ok(b.left>=0&&b.right<=width,`Footer clipping ${JSON.stringify(b)}`);assert.ok(contrast(b.fg,b.bg)>=4.5,`Footer unreadable ${JSON.stringify(b)}`);}
  await page.screenshot({path:path.join(out,`follow-up-${width}-${theme}.png`)});
 }
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
}
async function checkLeads(page,width){
 await page.waitForTimeout(250);
 const report=await page.evaluate(()=>{
  const bar=document.querySelector('.crmStageBar'),b=bar.getBoundingClientRect();
  const selects=[...document.querySelectorAll('#leadsView select.statusSelect')].filter(n=>n.getBoundingClientRect().width).map(n=>{const c=getComputedStyle(n),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=c.font;return {value:n.value,font:c.font,padding:c.padding,width:n.clientWidth,needed:ctx.measureText(n.value).width+parseFloat(c.paddingLeft)+parseFloat(c.paddingRight)+22};});
  return {width:innerWidth,page:document.documentElement.scrollWidth,stageClient:bar.clientWidth,stageScroll:bar.scrollWidth,selects,font:getComputedStyle(document.body).fontFamily};
 });
 assert.ok(report.page<=width,`Page overflow ${JSON.stringify(report)}`);assert.ok(report.stageScroll<=report.stageClient+1,`Stages overflow ${JSON.stringify(report)}`);assert.ok(report.font.includes('Poppins'));for(const s of report.selects)assert.ok(s.width>=s.needed,`Status clipped ${width}: ${JSON.stringify(s)}`);
 measurements.push({kind:'leads',...report});console.log('Layout measurements',JSON.stringify(report));
 if(width<801){const note=await page.evaluate(()=>{const n=document.querySelector('#leadMobileCards .crmNoteButton'),c=getComputedStyle(n);return {align:c.textAlign,whiteSpace:c.whiteSpace,height:n.getBoundingClientRect().height,card:n.closest('article').getBoundingClientRect().height,text:n.textContent};});assert.equal(note.align,'left');assert.equal(note.whiteSpace,'normal');assert.ok(note.card<450,JSON.stringify(note));assert.ok(note.text.length>400);measurements.push({kind:'mobileLeadNote',width,...note});}
}

(async()=>{
 const browser=await chromium.launch({...(BIN?{executablePath:BIN}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const results=[];
 try{
 for(const width of (process.env.CRM_TEST_WIDTHS||'320,375,390,430,1280,1440').split(',').map(Number)){
  const t=await setup(browser,width),{page,context,requests,errors}=t;
  console.log('Testing width',width);
  console.log('Owners open');await owners(page);console.log('Filter');await filter(page);console.log('Filtered');await checkOwners(page,width);
  if(width<801){const noPhone=page.locator('#mobileCards [data-record-id="2"]');assert.equal(await noPhone.locator('.crmNoPhone').textContent(),'No phone number');assert.equal(await noPhone.locator('.crmWaIcon').isDisabled(),true);assert.equal(await noPhone.locator('.crmCardMore').isVisible(),false);await noPhone.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`missing-phone-${width}.png`)});}

  assert.equal(await page.locator('#mobileCards [data-record-id]').count(),50);
  const units=await page.locator('#mobileCards .crmUnit').allTextContents();assert.deepEqual(units.slice(0,12),Array.from({length:12},(_,i)=>`Unit ${i+1}`));
  assert.equal(await page.locator('#crmThemeToggle').isVisible(),true);assert.equal(await page.locator('.v7Bell').isVisible(),true);
  console.log('Theme');await page.locator('#crmThemeToggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  console.log('Notifications');await page.evaluate(()=>u10RefreshNotifications());assert.equal(await page.locator('#v7NotificationBadge').textContent(),'1');await page.locator('.v7Bell').click();await page.waitForSelector('.crmNotePanel');
  await page.locator('[data-note]').first().click();await page.waitForSelector('.crmEventModal');
  await checkModal(page,width);
  await page.locator('.crmEventModal [data-close]').first().click();
  if(width<801){
   const target=page.locator('#mobileCards [data-record-id="30"]');await target.evaluate(n=>scrollTo(0,n.getBoundingClientRect().top+scrollY-70));await page.waitForTimeout(350);const before30=await target.evaluate(n=>n.getBoundingClientRect().top);await page.reload();await page.waitForSelector('#mobileCards [data-record-id="30"]');await page.waitForTimeout(700);const after30=await page.locator('#mobileCards [data-record-id="30"]').evaluate(n=>n.getBoundingClientRect().top);assert.ok(Math.abs(before30-after30)<8,`Unit 30 reload ${before30} -> ${after30}`);measurements.push({kind:'unit30Reload',width,before30,after30});
   const flows=[];for(const id of [5,20,30,40])flows.push(await whatsapp(page,context,id));
   if(width===390){
    await page.locator('#nextBtn').click();await page.waitForFunction(()=>currentPage===1&&document.querySelector('#mobileCards [data-record-id="51"]'));
    await whatsapp(page,context,80);await page.reload();await page.waitForSelector('#mobileCards [data-record-id="80"]');assert.equal(await page.evaluate(()=>currentPage),1);
    await page.locator('#prevBtn').click();await page.waitForSelector('#mobileCards [data-record-id="30"]');
   }
   // Combined active search, source and status filters.
   await page.locator('#searchInput').fill('OWNER');await page.waitForTimeout(500);
   await page.locator('#appView .crmFilterToggle').click();await page.selectOption('#sourceFilter','Master');await page.selectOption('#statusFilter','For Sale');await page.waitForTimeout(500);
   flows.push(await whatsapp(page,context,33));
   await page.screenshot({path:path.join(out,`owners-${width}-light.png`)});
   // OS tab eviction/reload: no cached records, fresh bounded request, restore filter + row anchor.
   const prior=await page.evaluate(()=>({y:scrollY,page:currentPage}));
   await page.reload();await page.waitForSelector('#mobileCards [data-record-id="33"]');await page.waitForTimeout(700);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   assert.equal(await page.locator('#clusterFilter').inputValue(),'Alana');assert.equal(await page.locator('#communityFilter').inputValue(),'The Valley');assert.equal(await page.locator('#searchInput').inputValue(),'OWNER');assert.equal(await page.locator('#sourceFilter').inputValue(),'Master');assert.equal(await page.locator('#statusFilter').inputValue(),'For Sale');
   const restoredY=await page.evaluate(()=>scrollY);assert.ok(Math.abs(restoredY-prior.y)<8,`reload position failed: ${prior.y} -> ${restoredY}`);
   await page.evaluate(()=>scrollTo(0,0));await page.locator('#appView [data-to="leads"]').tap();await page.waitForSelector('#leadMobileCards [data-record-id]');
   assert.ok(await page.locator('#leadsView').isVisible());
   await page.locator('#leadsView [data-to="owners"]').tap();assert.ok(await page.locator('#appView').isVisible());
   await nav(page,'#v7NavLeads');assert.ok(await page.locator('#leadsView').isVisible());
   await checkLeads(page,width);
   const expected=await page.evaluate(()=>getPipelineStages());assert.deepEqual(expected,stages);
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,`leads-${width}-light.png`)});
   await page.locator('#crmThemeToggle').click();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`leads-${width}-dark.png`)});
   await page.locator('#leadMobileCards .crmRecordCard').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`lead-records-${width}-dark.png`)});
   assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width,'horizontal mobile overflow');
   results.push({width,flows});
  }else{
   const dims=await page.evaluate(()=>{const table=document.querySelector('#leadsView .leadsTable');return {}});
   await nav(page,'#v7NavLeads');await page.waitForSelector('#leadsTableBody [data-record-id]');
   await checkLeads(page,width);
   const fit=await page.evaluate(()=>{const box=document.querySelector('#leadsView .tablebox');return {client:box.clientWidth,scroll:box.scrollWidth};});assert.ok(fit.scroll<=fit.client+1,`Leads no longer fit: ${JSON.stringify(fit)}`);
   await page.screenshot({path:path.join(out,'desktop-leads-light.png')});
   results.push({width,leadsFit:fit});
  }
  // Profile/settings open on an actual visible control.
  await page.locator('.v7Profile').click();await page.waitForSelector('#v7ProfileModal.show');await page.locator('#v7ProfileModal .u6CloseButton').click();
  await nav(page,'#v7NavOwners');await page.waitForTimeout(200);
  const openOwner=width<801?page.locator('#mobileCards [data-open-owner]').first():page.locator('#tableBody .profileBtn').first();
  await openOwner.click();await page.waitForSelector('#profileModal.show');
  if(width>=801){const size=await page.locator('#appView .tablebox').evaluate(b=>({client:b.clientWidth,scroll:b.scrollWidth}));console.log('Owners dimensions',width,size);assert.ok(size.scroll<=size.client+1,JSON.stringify(size));}
  const profileFit=await page.evaluate(()=>{const n=document.querySelector('#profileModal .modal');return {height:n.getBoundingClientRect().height,screen:innerHeight,overflow:getComputedStyle(n).overflowY};});
  assert.ok(profileFit.height<=profileFit.screen,'owner profile exceeds viewport');const innerScroll=await page.evaluate(()=>[...document.querySelectorAll('#profileContent .u6DetailLeft,#profileContent .u6DetailRight')].some(n=>getComputedStyle(n).overflowY==='auto'));assert.ok(profileFit.overflow==='auto'||innerScroll,'profile has no scrollable container');
  assert.equal(await page.locator('#profileContent').getByText('Occupancy log',{exact:true}).count(),0);
  await checkReadableFields(page,'#profileModal',width);await page.locator('#profileModal .u6CloseButton').click();
  await nav(page,'#v7NavLeads');await page.waitForTimeout(200);
  const openLead=width<801?page.locator('#leadMobileCards [data-open-lead]').first():page.locator('#leadsTableBody [title="Open full lead"]').first();
  await openLead.click();await page.waitForSelector('#leadDetailModal.show');
  assert.equal(await page.locator('#leadDetailContent .u6Stage').count(),8);await checkReadableFields(page,'#leadDetailModal',width);await page.locator('#leadDetailContent').getByRole('button',{name:'Edit Lead',exact:true}).click();await page.waitForSelector('#leadModal.show');await checkReadableFields(page,'#leadModal',width);await page.locator('#leadModal').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('#leadDetailModal .u6CloseButton').click();
  if(width<801){await page.setViewportSize({width:844,height:width});await page.waitForTimeout(150);await page.setViewportSize({width,height:844});assert.ok(await page.locator('.v7Bell').isVisible());}
  await nav(page,'#v7NavCalendar');await page.waitForSelector('#crmCalendarView:not(.hidden)');
  await page.locator('[data-new]').click();await page.waitForSelector('.crmEventModal');
  await page.locator('.crmEventModal [name="title"]').fill('Regression test reminder');
  await page.locator('.crmEventModal [type="submit"]').click();await page.waitForSelector('.crmEventModal',{state:'detached'});
  assert.ok(t.data.crm_events.some(e=>e.title==='Regression test reminder'),'Calendar save did not reach the API');
  await nav(page,'#v7NavDashboard');await page.waitForSelector('#dashboardView:not(.hidden)');await page.waitForSelector('.crmBarRow .crmBarLabel[data-crm-tone]',{state:'attached'});
  const bars=await page.locator('.crmBarRow:has(.crmBarLabel[data-crm-tone])').evaluateAll(rows=>rows.map(r=>({label:r.querySelector('.crmBarLabel').textContent,fill:getComputedStyle(r.querySelector('.crmBarFill')).backgroundColor,fg:getComputedStyle(r.querySelector('.crmBarLabel')).color})));assert.ok(bars.length);for(const b of bars)assert.equal(b.fill,b.fg,`Dashboard ${b.label} bar differs`);for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);await page.locator('.crmCard:has(.crmBarLabel)').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`dashboard-${width}-${theme}.png`)});const clipping=await page.locator('.crmBarLabel').evaluateAll(ns=>ns.filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent));assert.deepEqual(clipping,[]);}
  await nav(page,'#v7NavUsers');await page.waitForSelector('#usersView:not(.hidden)');
  if(width===390){
   if(await page.locator('.crmMenuToggle').isVisible())await page.locator('.crmMenuToggle').click();
   await Promise.all([page.waitForURL('**/cluster-guide.html'),page.locator('[data-cluster-guide-entry="nav"]').click()]);
   await page.waitForSelector('#theme');await page.locator('#theme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   await page.goBack();await page.waitForFunction(()=>window.CRMStatus);
  }
  for(const light of [true,false]){
   await page.evaluate(light=>{if(light)document.documentElement.dataset.theme='light';else delete document.documentElement.dataset.theme;},light);
   const palette=await page.evaluate(()=>Object.keys(CRMStatus.mapping).map(status=>{const b=document.createElement('span');b.dataset.status=status;document.body.append(b);CRMStatus.decorate(b);const c=getComputedStyle(b),r={status,fg:c.color,bg:c.backgroundColor};b.remove();return r;}));
   function luminance(rgb){const c=rgb.match(/[\d.]+/g).slice(0,3).map(v=>{v=Number(v)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
   for(const p of palette){const a=luminance(p.fg),b=luminance(p.bg),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(contrast>=4.5,`${p.status} ${light?'light':'dark'} contrast ${contrast}`);}
  }
  if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
  if(width===1440){
   await nav(page,'#v7NavOwners');await page.waitForSelector('#tableBody [data-record-id]');
   const slow=page.waitForRequest(r=>r.url().includes('owners_list')&&r.url().includes('Slow'));
   await page.locator('#searchInput').fill('Slow');await slow;await page.locator('#searchInput').fill('OWNER');
   await page.waitForTimeout(1100);assert.equal(await page.locator('#tableBody [data-record-id]').count(),50,'stale search response overwrote newer results');
   await page.evaluate(()=>document.querySelector('#appView .tablebox').scrollLeft=0);await page.screenshot({path:path.join(out,'desktop-owners-dark.png')});
  }
  const paging=requests.filter(r=>r.url.includes('/owners_list?'));assert.ok(paging.length);assert.ok(paging.every(r=>Number(new URL(r.url).searchParams.get('limit'))===50),'owner list query is not paginated');
  assert.ok(paging.some(r=>new URL(r.url).searchParams.get('order')?.includes('unit_natural')),'missing server natural order');
  await context.close();
 }
 console.log(JSON.stringify({passed:true,results,measurements},null,2));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,results,measurements},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
