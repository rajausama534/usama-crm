/* One semantic status palette for lists, detail, pipeline, filters, dashboard and events. */
(()=>{
  'use strict';
  const palettes={
    blue:['#b5d0ff','#162a46','#36577d','#214d91','#eaf1fc','#bfd1ec'],
    lime:['#c4e9ac','#243724','#45643c','#365d25','#edf6e7','#c6dbb9'],
    green:['#9fdfbb','#15372b','#32644b','#1c6241','#e8f5ed','#b8dcc8'],
    indigo:['#c5c5ff','#292940','#555580','#46469b','#efeffb','#cfcfee'],
    gold:['#ecd48f','#39301b','#6d5b2f','#73550f','#faf3df','#e7d7a8'],
    purple:['#d8bdf5','#30223e','#64477c','#69418a','#f4edf9','#dbc9e9'],
    slate:['#c0cbd9','#252f3c','#4c5a6c','#445367','#edf1f5','#ccd5df'],
    red:['#f3b5bd','#3c242c','#79424d','#943845','#fbecef','#eac6cd'],
    grey:['#c6c9d0','#2e3037','#5b5e68','#50545e','#eff0f2','#d1d3d9'],
    orange:['#f0c19b','#392b20','#76583b','#874b1c','#fbf0e6','#e9ceb7'],
    teal:['#9cddd8','#153634','#346865','#1d6561','#e6f4f2','#b9dcd7'],
    emerald:['#94e4c5','#12382d','#2d7056','#0e6448','#e4f5ed','#addbc6'],
    cyan:['#a7dce9','#1b333c','#3b626f','#235e70','#e9f4f8','#c0dce5']
  };
  const mapping={'New':'blue','Contacted':'lime','For Sale':'green','For Rent':'indigo','Sold':'gold','Call Back':'purple','No Response':'slate','Not Interested':'red','Invalid Number':'grey','Agent':'orange','Rented':'teal','Interested':'green','Viewing Scheduled':'cyan','Visit Done':'teal','Negotiation':'orange','Won':'emerald','Lost':'red'};
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const lookup=Object.fromEntries(Object.entries(mapping).map(([k,v])=>[norm(k),v]));
  const known=new Set(Object.keys(mapping));
  const tone=status=>['','all','notset'].includes(norm(status))?'slate':lookup[norm(status)]||(norm(status)?['slate','indigo','teal','purple','blue','orange'][[...norm(status)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%6]:'slate');
  const style=document.createElement('style');
  style.textContent=Object.entries(palettes).map(([k,p])=>`[data-crm-tone="${k}"]{--status-fg:${p[0]};--status-bg:${p[1]};--status-border:${p[2]}}html[data-theme="light"] [data-crm-tone="${k}"]{--status-fg:${p[3]};--status-bg:${p[4]};--status-border:${p[5]}}`).join('\n')+`
    html body.crmPremium [data-crm-tone] :is(span,b,strong){color:inherit!important}
    html body.crmPremium [data-crm-tone] .crmBarFill{background:var(--status-fg)!important}
    html body.crmPremium [data-crm-tone].crmStage::before{background:var(--status-fg)!important}
    html body.crmPremium [data-crm-tone]:is(.active,[aria-current=page]){box-shadow:inset 0 0 0 1px var(--status-fg)!important}
    html body.crmPremium select[data-crm-tone] option{color:var(--c-text);background:var(--c-surface)}
  `;
  document.head.append(style);
  function apply(node,status){
    if(!status){delete node.dataset.crmTone;for(const key of ['background','color','border-color','--st'])node.style.removeProperty(key);return;}
    node.dataset.crmTone=tone(status);
    node.style.setProperty('background','var(--status-bg)','important');
    node.style.setProperty('color','var(--status-fg)','important');
    node.style.setProperty('border-color','var(--status-border)','important');
    node.style.setProperty('--st','var(--status-fg)');
  }
  const selectors='#statusFilter,#leadStatusFilter,.quickFilters button,.statusSelect,.leadCellSelect,.u6Stage,[data-status],[data-stage],[data-crm-status],[data-lead-stage],.crmBarLabel,.kpiLabel,.kanbanHead>span:first-child,.crmBadge,.statusChip';
  function decorate(root){
    const nodes=[...(root.matches?.(selectors)?[root]:[]),...root.querySelectorAll(selectors)];
    for(const node of nodes){
      let value=node.tagName==='SELECT'?node.value:node.hasAttribute('data-stage')?(node.dataset.stage||'All'):node.dataset.status||node.dataset.leadStage||node.dataset.crmStatus||node.textContent.trim();
      if(node.matches('.crmBarLabel,.kpiLabel')&&!known.has(value))continue;
      if(value){
        apply(node,value);
        // The label and track are siblings: share only the tone variables with the row.
        if(node.matches(".crmBarLabel"))node.closest(".crmBarRow")?.setAttribute("data-crm-tone",tone(value));
      }
    }
  }
  window.CRMStatus={mapping,tone,decorate};
  // Only inspect added subtrees, never rescan the whole document on each table mutation.
  const observer=new MutationObserver(changes=>{
    for(const change of changes)for(const n of change.addedNodes)if(n.nodeType===1)decorate(n);
  });
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('change',e=>{if(e.target.matches('.statusSelect,.leadCellSelect,#statusFilter,#leadStatusFilter'))apply(e.target,e.target.value);});
  for(const id of ['statusFilter','leadStatusFilter'])document.getElementById(id)?.setAttribute('data-status',document.getElementById(id).value);
  for(const [name,id] of [['renderData','appView'],['renderLeads','leadsView']]){
    const base=window[name];if(typeof base!=='function')continue;
    window[name]=function(){const result=base.apply(this,arguments);decorate(document.getElementById(id));return result;};
  }
  decorate(document);
  const theme=document.getElementById('crmThemeToggle');
  function themeLabel(){
    const light=document.documentElement.dataset.theme==='light';
    if(theme){theme.setAttribute('aria-label',light?'Switch to dark mode':'Switch to light mode');theme.title=theme.getAttribute('aria-label');theme.setAttribute('aria-pressed',String(light));}
  }
  const original=window.toggleV8Theme;window.toggleV8Theme=()=>{original();themeLabel();};themeLabel();
  addEventListener('storage',e=>{if(e.key==='crm_theme'){if(e.newValue==='light')document.documentElement.dataset.theme='light';else delete document.documentElement.dataset.theme;themeLabel();}});
})();
