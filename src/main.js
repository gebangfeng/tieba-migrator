import {createApp,ref,computed,onMounted,onBeforeUnmount,nextTick,h} from 'vue';
import './style.css';
const api=window.client;
const ckLabels={saved:'已保存 · 未检测',valid:'检测有效',invalid:'检测失效',verification:'需要验证',check_failed:'检测失败'};
const bulkLabels={prepare:'创建并导入 CK',create:'仅创建窗口',bind:'绑定已有窗口',write:'导入 / 重新导入 CK',checkCookie:'检测 CK',check:'检查窗口登录',open:'打开窗口',close:'关闭窗口',unbind:'解除绑定',remove:'移除本地记录'};
const loginLabels={unknown:'未检查',logged_in:'已登录',login_required:'未登录 / 已失效',verification:'需要人工验证',check_failed:'检查失败'};
const App={setup(){
 const state=ref({accounts:[],windows:[],groups:[],connected:false,connecting:false}),address=ref('http://127.0.0.1:54345'),token=ref(''),query=ref(''),filter=ref('all'),toast=ref(null),modal=ref(null),secret=ref(''),note=ref(''),destination=ref(''),group=ref(''),confirmed=ref(false),saving=ref(false),connecting=ref(false),report=ref(null),selected=ref(new Set()),batchType=ref('checkCookie'),batchIds=ref([]),bindingMap=ref({}),page=ref(1),pageSize=ref('50'),lastActions=ref({});
 const connectionExpanded=ref(true),taskExpanded=ref(false);
 const batchBusy=computed(()=>!!state.value.batch?.running),batchDone=computed(()=>state.value.batch?.done||0);
 let unsubscribe,toastTimer,trigger;
 const notify=(message,error=false)=>{toast.value={message,error};clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value=null,9000);};
 function acceptState(data){state.value=data;if(!data.batch?.running){const ids=new Set(data.accounts.map(a=>a.id));selected.value=new Set([...selected.value].filter(id=>ids.has(id)));}}
 async function refresh(){if(!api)return;const r=await api.state();if(r.ok)acceptState(r.data);}
 async function invoke(fn,message){try{if(!api)throw Error('请通过桌面客户端执行此操作');const r=await fn();if(!r.ok)throw Error(r.error);if(message)notify(message);return {data:r.data};}catch(e){notify(e.message,true);return null;}finally{await refresh();}}
 onMounted(async()=>{if(!api){notify('浏览器为界面预览，请使用 npm run desktop 启动桌面工具');return;}await refresh();address.value=state.value.address;unsubscribe=api.onState(acceptState);});
 onBeforeUnmount(()=>{unsubscribe?.();clearTimeout(toastTimer);});
 const filtered=computed(()=>state.value.accounts.filter(a=>(!query.value||[a.note,a.nickname,a.accountId,a.ckAccountId,a.windowName,a.windowId].join(' ').toLowerCase().includes(query.value.toLowerCase()))&&(filter.value==='all'||filter.value==='unbound'&&!a.windowId||filter.value==='valid'&&a.ckStatus==='valid'||filter.value==='logged_in'&&a.loginStatus==='logged_in'||filter.value==='attention'&&(a.error||a.ckStatus==='invalid'||a.loginStatus==='verification'))));
 const pageCount=computed(()=>Math.max(1,Math.ceil(filtered.value.length/Number(pageSize.value)))),currentPage=computed(()=>Math.min(page.value,pageCount.value)),paged=computed(()=>filtered.value.slice((currentPage.value-1)*Number(pageSize.value),currentPage.value*Number(pageSize.value)));
 const plannedAccounts=computed(()=>batchIds.value.map(id=>state.value.accounts.find(a=>a.id===id)).filter(Boolean));
 const account=computed(()=>state.value.accounts.find(a=>a.id===modal.value?.id));
 const counts=computed(()=>({valid:state.value.accounts.filter(a=>a.ckStatus==='valid').length,bound:state.value.accounts.filter(a=>a.windowId).length,loggedIn:state.value.accounts.filter(a=>a.loginStatus==='logged_in').length}));
 const button=(text,onClick,disabled=false,cls='')=>h('button',{type:'button',onClick,disabled,class:cls},text);
 const input=(model,props={})=>h('input',{...props,value:model.value,onInput:e=>model.value=e.target.value});
 const select=(model,options,props={})=>h('select',{...props,value:model.value,onChange:e=>model.value=e.target.value},options.map(([value,text,disabled])=>h('option',{value,disabled},text)));
 const label=(text,control)=>h('label',[h('span',text),control]);
 const badge=(text,status)=>h('span',{class:`status ${status}`},text);
 const checkTime=(label,value)=>h('small',{class:'check-time',title:value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未检查'},`${label}：${value?new Date(value).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'}):'未检查'}`);
 async function openModal(type,id=''){
  trigger=document.activeElement;secret.value='';note.value=state.value.accounts.find(a=>a.id===id)?.note||'';destination.value='';group.value='';confirmed.value=false;report.value=null;modal.value={type,id};
  await nextTick();document.querySelector('.dialog input, .dialog textarea, .dialog select, .dialog button')?.focus();
 }
 function closeModal(){if(saving.value)return;modal.value=null;secret.value='';note.value='';destination.value='';confirmed.value=false;nextTick(()=>trigger?.isConnected&&trigger.focus());}
 async function connectBrowser(){connecting.value=true;try{const result=await invoke(()=>api.connect({address:address.value,token:token.value}),'连接成功，窗口列表已刷新');if(result)connectionExpanded.value=false;}finally{connecting.value=false;}}
 async function copyWechat(){const result=await invoke(()=>api.copyWechat());if(result)notify('作者微信已复制：f2468558247');}
 async function action(a,type,options={}){lastActions.value={...lastActions.value,[a.id]:type};const result=await invoke(()=>api.action(a.id,type,options),type==='check'?'窗口登录检查已完成':null);if(result&&type==='checkCookie'){const updated=state.value.accounts.find(x=>x.id===a.id);notify(`${updated?.note||a.note}：${ckLabels[updated?.ckStatus]||'检测失败'}${updated?.ckAccountId?` · UID ${updated.ckAccountId}`:''}`,updated?.ckStatus!=='valid');}return result;}
 async function submit(){
  if(saving.value)return;saving.value=true;
  try{
   const m=modal.value,a=account.value;
   if(m.type==='bulk'){const result=await invoke(()=>api.startBatch({action:batchType.value,ids:[...batchIds.value],groupId:group.value,bindings:{...bindingMap.value},confirmReplace:confirmed.value,confirm:confirmed.value}));if(result){saving.value=false;closeModal();notify('批量任务已开始，可在任务面板查看逐条结果');await nextTick();document.querySelector('.batch-report')?.scrollIntoView({block:'start',behavior:'smooth'});}return;}
   if(['add','batch'].includes(m.type)){
    const raw=m.type==='add'?JSON.stringify([{note:note.value,cookie:secret.value}]):secret.value;
    const result=await invoke(()=>api.importText(raw));
    if(result){secret.value='';report.value=result.data;notify(`已保存 ${result.data.success} 个，重复 ${result.data.duplicate} 个，失败 ${result.data.failed} 个`);if(m.type==='add'&&result.data.success){saving.value=false;closeModal();}}
    return;
   }
   const payload={note:note.value,text:secret.value,windowId:destination.value,groupId:group.value,confirmReplace:confirmed.value,confirm:confirmed.value,confirmNoWindow:confirmed.value};
   const type={update:'update',note:'note',bind:destination.value==='new'?'create':'bind',write:'write',remove:'remove',unbind:'unbind'}[m.type];
   const result=await action(a,type,payload);
   if(result){secret.value='';notify({update:'CK 已加密保存，需点击导入到窗口后生效',note:'备注已更新',bind:destination.value==='new'?'窗口已创建并绑定，尚未写入 CK':'窗口已绑定，尚未写入 CK',write:'导入流程已完成，请查看窗口登录状态',remove:'本地记录已移除，比特窗口保留',unbind:'已解除绑定，比特窗口保留'}[m.type]);saving.value=false;closeModal();}
  }finally{saving.value=false;}
 }
 async function openBulk(type,ids=[...selected.value]){
  if(batchBusy.value)return;
  const valid=ids.filter(id=>state.value.accounts.some(a=>a.id===id));
  if(!valid.length||valid.length>500){notify('每批请选择 1 至 500 个账号',true);return;}
  if(!['checkCookie','unbind','remove'].includes(type)&&!state.value.connected){notify('请先在顶部连接比特浏览器',true);return;}
  await openModal('bulk');batchType.value=type;batchIds.value=valid;bindingMap.value={};
 }
 function assignWindows(){const used=new Set(state.value.accounts.map(a=>a.windowId).filter(Boolean)),available=state.value.windows.filter(w=>!used.has(w.id));const map={};plannedAccounts.value.forEach((a,i)=>{if(available[i])map[a.id]=available[i].id;});bindingMap.value=map;}
 async function retryBatch(ids){const job=state.value.batch;if(!job)return;const type=job.action,options=job.options;await openBulk(type,ids);group.value=options.groupId;bindingMap.value=Object.fromEntries(ids.map(id=>[id,options.bindings[id]||'']));}
 function batchReport(){const job=state.value.batch;if(!job)return null;return h('section',{class:'card batch-report'},[
  h('div',{class:'inline spread'},[h('div',[h('h2',`批量${bulkLabels[job.action]}`),h('small',job.running?job.stopping?'正在停止，等待当前项完成…':`正在处理：${job.current||'准备中'}`:'任务已结束')]),h('div',{class:'actions'},[button(taskExpanded.value?'收起明细':'展开明细',()=>taskExpanded.value=!taskExpanded.value),job.running?button(job.stopping?'正在停止…':'停止后续任务',()=>invoke(()=>api.stopBatch()),job.stopping):button('重试失败项',()=>retryBatch(job.results.filter(r=>r.status==='failed').map(r=>r.id)),!job.failed)])]),
  h('progress',{value:job.done,max:job.total,'aria-label':'批量任务进度'}),h('div',{class:'batch-summary'},`已处理 ${job.done} / ${job.total} · 成功 ${job.success} · 失败 ${job.failed} · 跳过 ${job.skipped} · 未执行 ${job.stopped}`),
  taskExpanded.value?h('div',{class:'batch-results'},job.results.map(row=>h('div',{class:'batch-result',key:row.id},[h('span',`${row.line}. ${row.note}`),badge({queued:'等待',running:'处理中',success:'成功',failed:'失败',skipped:'跳过',stopped:'未执行'}[row.status],row.status),h('span',[row.message,h('small',row.windowName||row.windowId||'未绑定窗口')]),row.status==='failed'?button('重试此项',()=>retryBatch([row.id]),job.running,'text-button'):null]))):null
 ]);}
 function keyboard(e){if(e.key==='Escape')closeModal();if(e.key==='Tab'){const nodes=[...e.currentTarget.querySelectorAll('button,input,select,textarea')].filter(el=>!el.disabled);if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
 function reportView(r){return h('div',{class:'report'},[h('div',{class:'report-summary'},`成功 ${r.success} · 重复 ${r.duplicate} · 失败 ${r.failed}`),h('div',{class:'report-list'},r.results.map(row=>h('div',{class:'report-row'},[h('span',`第 ${row.line} ${modal.value?.type==='batch'?'行 / 项':'项'}`),badge({success:'成功',duplicate:'重复',failed:'失败'}[row.status],row.status),h('span',row.message),row.status==='failed'?button('单条重试',()=>{if(row.id){const a=state.value.accounts.find(a=>a.id===row.id);if(a)void action(a,row.action);}else void openModal('add');},saving.value||batchBusy.value,'text-button'):null])))]);}
 function renderModal(){
  const m=modal.value;if(!m)return null;const a=account.value;
  const titles={bulk:`批量${bulkLabels[batchType.value]}`,add:'添加账号',batch:'批量导入账号',update:'更新账号 CK',note:'修改备注',bind:a?.windowId?'更换绑定窗口':'创建或绑定窗口',write:a?.importedAt?'重新导入 CK 到窗口':'导入 CK 到窗口',remove:'移除本地账号',unbind:'解除窗口绑定'};
  let body=[];
  if(['add','batch','update'].includes(m.type))body=[m.type!=='batch'?label('账号备注',input(note,{maxlength:100,placeholder:'用于识别账号'})):null,h('p',{class:'muted'},m.type==='update'?'只更新本地账号库，不会自动替换窗口中的登录状态。':'支持 Cookie 字符串、JSON 数组或包含 cookies 的对象；保存不会创建或修改窗口。'),label(m.type==='batch'?'批量内容（TXT 每行一个账号，或 JSON accounts 数组）':'账号 CK',h('textarea',{value:secret.value,onInput:e=>secret.value=e.target.value,spellcheck:false,autocomplete:'off',placeholder:m.type==='batch'?'账号名----其他字段----BDUSS=xxx; STOKEN=xxx;\n或 [{"note":"备注","cookie":"BDUSS=xxx;"}]':'BDUSS=xxx; STOKEN=xxx; 或 Cookie JSON'})),h('div',{class:'inline spread'},[h('small','每次最多 500 个账号，1MB；关闭弹窗会清空未保存 CK。'),button('选择 TXT / JSON',async()=>{const r=await invoke(()=>api.readImportFile());if(r?.data!=null)secret.value=r.data;},saving.value)]),report.value?reportView(report.value):null];
  if(m.type==='note')body=[label('账号备注',input(note,{maxlength:100}))];
  if(m.type==='bind'){
   const bound=new Set(state.value.accounts.filter(x=>x.id!==a.id).map(x=>x.windowId));
   body=[h('p',{class:'muted'},'一个窗口只绑定一个账号。绑定与写入 CK 是独立操作，绑定后请点击“导入到窗口”。'),label('目标窗口',select(destination,[['','请选择窗口'],...(!a.windowId?[['new','新建独立窗口']]:[]),...state.value.windows.map(w=>[w.id,`${w.name}${bound.has(w.id)?'（已绑定）':''}`,bound.has(w.id)||w.id===a.windowId])])),destination.value==='new'?label('目标分组 ID（子账号必填）',input(group,{list:'group-options',placeholder:'主账号可留空'})):null,h('datalist',{id:'group-options'},state.value.groups.map(g=>h('option',{value:g.id},g.name))),a.createUncertain?h('div',{class:'warning'},[h('p','上次创建结果不确定，请先在比特浏览器核对，并刷新窗口列表。已创建的窗口请直接选择绑定。'),destination.value==='new'?label('',h('span',{class:'checkbox-label'},[h('input',{type:'checkbox',checked:confirmed.value,onChange:e=>confirmed.value=e.target.checked}),'我已核对，确认上次没有创建窗口，允许重新新建'])):null]):null];
  }
  if(m.type==='write')body=[h('div',{class:'warning'},`将关闭“${a.windowName||a.windowId}”，替换其中的百度登录状态，再打开贴吧检查登录。其他网站 Cookie 会保留。`),h('ol',{class:'steps'},[h('li','关闭并确认窗口已停止'),h('li','替换百度 Cookie，防止旧页面覆盖'),h('li','重新打开并读取实际登录状态')]),label('',h('span',{class:'checkbox-label'},[h('input',{type:'checkbox',checked:confirmed.value,onChange:e=>confirmed.value=e.target.checked}),'我确认替换该窗口的百度登录状态']))];
  if(m.type==='remove')body=[h('p','仅删除本地账号记录及保存的 CK，不会删除或关闭比特浏览器窗口。'),label('',h('span',{class:'checkbox-label'},[h('input',{type:'checkbox',checked:confirmed.value,onChange:e=>confirmed.value=e.target.checked}),'确认移除本地记录']))];
  if(m.type==='unbind')body=[h('p','解除绑定后，窗口和其中的登录状态仍保留。此账号可以重新绑定其他窗口。')];
  if(m.type==='bulk'){
   const type=batchType.value,targets=plannedAccounts.value,used=new Set(state.value.accounts.map(a=>a.windowId).filter(Boolean));
   body=[h('p',{class:'muted'},`本次共 ${targets.length} 个账号，逐条执行。单条失败不影响其他账号，停止只取消后续项目。`),
    ['prepare','create'].includes(type)?label('新建窗口所属分组 ID（子账号必填）',input(group,{placeholder:'主账号可留空'})):null,
    type==='bind'?h('div',[h('p','为每个账号明确选择不同窗口；不会写入 CK。'),button('按空闲窗口顺序分配（需核对）',assignWindows,saving.value),h('small','已被任何账号绑定的窗口不会参与自动分配。')]):null,
    ['write','prepare'].includes(type)?h('div',{class:'warning'},'将关闭目标窗口、替换百度登录状态，再打开检查。其他网站 Cookie 保留。创建并导入会复用已绑定窗口，仅为未绑定账号新建窗口。'):null,
    type==='remove'?h('div',{class:'warning'},'将删除以下账号的本地记录和保存的 CK。不会删除或关闭比特窗口。'):null,
    type==='unbind'?h('div',{class:'warning'},'将解除以下账号的窗口绑定，窗口及其中的登录状态保留。'):null,
    h('div',{class:'batch-plan'},targets.map(a=>h('div',{class:'plan-row',key:a.id},[h('div',[h('strong',a.nickname||a.note),h('small',a.note)]),type==='bind'?h('select',{'aria-label':`${a.note} 目标窗口`,value:bindingMap.value[a.id]||'',onChange:e=>bindingMap.value={...bindingMap.value,[a.id]:e.target.value}},[h('option',{value:''},'选择目标窗口'),...state.value.windows.filter(w=>!used.has(w.id)).map(w=>h('option',{value:w.id,disabled:Object.entries(bindingMap.value).some(([id,value])=>id!==a.id&&value===w.id)},w.name))]):h('div',[h('span',a.windowName||a.windowId||(['prepare','create'].includes(type)?'将新建独立窗口':'未绑定窗口')),h('small',type==='create'&&a.windowId?'已绑定，跳过创建':['write','check','open','close','unbind'].includes(type)&&!a.windowId?'未绑定，将跳过':type==='prepare'&&a.createUncertain&&!a.windowId?'上次创建待核对，需先单独处理':'')])]))),
    ['write','prepare','remove','unbind','bind'].includes(type)?label('',h('span',{class:'checkbox-label'},[h('input',{type:'checkbox',checked:confirmed.value,onChange:e=>confirmed.value=e.target.checked}),['write','prepare'].includes(type)?'我已核对以上账号及窗口，确认替换百度登录状态':'我已核对以上列表，确认执行'])):null];
  }
  const disabled=saving.value||(m.type==='bulk'&&(!batchIds.value.length||['write','prepare','remove','unbind','bind'].includes(batchType.value)&&!confirmed.value||batchType.value==='bind'&&plannedAccounts.value.some(a=>!bindingMap.value[a.id])))||(['add','batch','update'].includes(m.type)&&!secret.value.trim())||(m.type==='bind'&&(!destination.value||destination.value==='new'&&a.createUncertain&&!confirmed.value))||(['write','remove'].includes(m.type)&&!confirmed.value);
  return h('div',{class:'overlay',onClick:e=>{if(e.target===e.currentTarget)closeModal();}},[h('section',{class:'dialog',role:'dialog','aria-modal':'true','aria-labelledby':'dialog-title',onKeydown:keyboard},[h('div',{class:'dialog-header'},[h('div',[h('small','账号管理'),h('h2',{id:'dialog-title'},titles[m.type])]),button('×',closeModal,saving.value,'close-button')]),h('form',{onSubmit:e=>{e.preventDefault();void submit();}},[h('fieldset',{class:'dialog-body',disabled:saving.value},body),h('div',{class:'dialog-footer'},[button('取消',closeModal,saving.value),h('button',{type:'submit',class:m.type==='remove'?'danger':'primary',disabled},saving.value?'处理中…':({bulk:'开始批量执行',add:'加密保存',batch:'开始逐条导入',update:'保存 CK',note:'保存备注',bind:'确认绑定',write:'确认替换并导入',remove:'移除记录',unbind:'解除绑定'}[m.type]))])])])]);
 }
 return ()=>h('div',{class:'shell'},[
  toast.value?h('div',{class:`toast ${toast.value.error?'error':''}`,role:'status'},[h('span',toast.value.message),button('×',()=>toast.value=null,false,'toast-close')]):null,
  h('aside',[h('div',{class:'brand'},[h('b',{class:'logo'},'贴'),h('div',[h('strong','贴吧 CK 管理'),h('small','BITBROWSER · LOCAL')])]),h('div',{class:'nav active'},'▤  账号与浏览器'),button('使用说明 ↗',()=>invoke(()=>api.openGuide()),false,'guide-link'),h('div',{class:'aside-bottom'},[h('div',{class:'author-card'},[h('b',{class:'customization-title'},'支持软件定制'),h('p',{class:'customization-copy'},'有新的功能需求？欢迎联系作者，沟通软件定制。'),h('small','作者微信'),h('strong','f2468558247'),button('复制微信 · 沟通定制',copyWechat,false,'author-copy')]),h('small','本机加密存储 · v0.3.0')])]),
  h('main',[
   h('header',[h('div',[h('div',{class:'eyebrow'},'工作台 / 账号管理'),h('h1','账号管理'),h('p','集中管理 CK、窗口绑定与登录状态')]),h('div',{class:'actions'},[button('批量导入',()=>openModal('batch'),!!state.value.startupError||batchBusy.value),button('＋ 添加账号',()=>openModal('add'),!!state.value.startupError||batchBusy.value,'primary')])]),
   state.value.startupError?h('div',{class:'warning'},state.value.startupError):null,
   h('section',{class:'card connection'},[
    h('div',{class:'connection-head'},[h('div',{class:'connection-title'},[h('strong','比特浏览器'),badge(connecting.value||state.value.connecting?'连接中…':state.value.connected?'已连接':'未连接',state.value.connected?'valid':'unknown'),h('span',{class:'connection-address',title:state.value.address},state.value.connected?state.value.address:'连接后可创建、绑定及导入窗口')]),h('div',{class:'actions'},[button(connectionExpanded.value?'收起设置':'连接设置',()=>connectionExpanded.value=!connectionExpanded.value,connecting.value,'text-button'),button(connecting.value?'连接中…':state.value.connected?'刷新连接与窗口':'连接比特浏览器',connectBrowser,connecting.value||batchBusy.value||state.value.accounts.some(a=>a.busy),state.value.connected?'':'primary')])]),
    h('div',{class:'inline connection-fields',hidden:!connectionExpanded.value},[label('本地 API 地址',input(address,{disabled:connecting.value,placeholder:'http://127.0.0.1:54345'})),label('Local API Token（可选）',input(token,{type:'password',autocomplete:'off',disabled:connecting.value,placeholder:'开启鉴权时填写'}))])]),
   h('div',{class:'stats'},[['本机已保存',state.value.accounts.length,'CK 已加密保存'],['CK 检测有效',counts.value.valid,'独立于窗口登录状态'],['已绑定窗口',counts.value.bound,'一个窗口一个账号'],['窗口已登录',counts.value.loggedIn,'以实际页面检查为准']].map(([name,count,hint])=>h('div',{title:hint},[h('span',name),h('b',count),h('small',hint)]))),
   batchReport(),
   h('section',{class:'card account-card'},[
    h('div',{class:'inline spread toolbar'},[h('div',[h('h2','账号列表'),h('small',`共 ${state.value.accounts.length} 个账号 · 当前显示 ${filtered.value.length} 个`)]),h('div',{class:'actions'},[input(query,{type:'search',placeholder:'搜索备注、昵称、UID 或窗口','aria-label':'搜索账号'}),select(filter,[['all','全部状态'],['unbound','尚未绑定'],['valid','CK 检测有效'],['logged_in','窗口已登录'],['attention','需要处理']],{'aria-label':'筛选状态'})])]),
    h('div',{class:['selection-bar',!selected.value.size&&!batchBusy.value?'selection-idle':'']},[h('span',selected.value.size?`已选择 ${selected.value.size} 个账号${batchBusy.value?` · 已处理 ${batchDone.value}`:''}`:'勾选账号后可批量操作'),
     button('全选筛选结果',()=>{if(filtered.value.length>500){notify('筛选结果超过 500 个，请缩小筛选范围分批操作',true);return;}selected.value=new Set(filtered.value.map(a=>a.id));},batchBusy.value),
     button('选择未绑定',()=>selected.value=new Set(filtered.value.filter(a=>!a.windowId).slice(0,500).map(a=>a.id)),batchBusy.value),
     selected.value.size||batchBusy.value?h('select',{'aria-label':'选择批量操作',value:'',disabled:batchBusy.value||!selected.value.size,onChange:e=>{const type=e.target.value;e.target.value='';if(type)void openBulk(type);}},[h('option',{value:''},'选择批量操作…'),...Object.entries(bulkLabels).map(([type,title])=>h('option',{value:type,disabled:!['checkCookie','unbind','remove'].includes(type)&&!state.value.connected},title))]):null,
     selected.value.size?button('取消选择',()=>selected.value=new Set(),batchBusy.value||!selected.value.size):null]),
    !state.value.connected?h('div',{class:'list-connection-note'},'未连接比特浏览器：连接后可导入 CK、打开窗口；检测 CK 和本地管理仍可使用。'):null,h('div',{class:'table-wrap'},[h('table',[h('colgroup',[h('col',{class:'col-select'}),h('col',{class:'col-account'}),h('col',{class:'col-ck'}),h('col',{class:'col-window'}),h('col',{class:'col-login'}),h('col',{class:'col-actions'})]),h('thead',[h('tr',[h('th',[h('input',{type:'checkbox','aria-label':'选择当前页',checked:paged.value.length>0&&paged.value.every(a=>selected.value.has(a.id)),disabled:batchBusy.value,onChange:e=>{const next=new Set(selected.value);for(const a of paged.value)e.target.checked?next.add(a.id):next.delete(a.id);selected.value=next;}})]),...['账号昵称 / 备注','CK 状态','比特窗口','窗口登录状态','操作'].map(title=>h('th',title))])]),h('tbody',paged.value.map(a=>h('tr',{key:a.id},[
     h('td',[h('input',{type:'checkbox','aria-label':`选择 ${a.note}`,checked:selected.value.has(a.id),disabled:batchBusy.value,onChange:e=>{const next=new Set(selected.value);e.target.checked?next.add(a.id):next.delete(a.id);selected.value=next;}})]),
     h('td',[h('div',{class:'person'},[h('span',{class:'avatar'},(a.nickname||a.note||'贴')[0]),h('div',[h('strong',a.nickname||a.note),a.nickname&&a.nickname!==a.note?h('small',a.note):null,h('small',(a.accountId||a.ckAccountId)?`UID ${a.accountId||a.ckAccountId}`:'身份待检查')])])]),
     h('td',[badge(ckLabels[a.ckStatus]||'已保存',a.ckStatus),checkTime('CK 检查',a.cookieCheckedAt),a.ckStatus!=='valid'&&a.ckMessage?h('small',a.ckMessage):null,a.windowId&&(!a.importedAt||a.cookieUpdatedAt&&a.cookieUpdatedAt>a.importedAt)?h('small',{class:'pending-note'},'新 CK 待导入'):null]),
     h('td',[h('span',a.windowName||'未绑定窗口'),a.windowId?h('small',{class:'window-id',title:a.windowId},a.windowId):h('small','按需创建或绑定')]),
     h('td',[badge(a.windowId?loginLabels[a.loginStatus]||'未检查':'未绑定',a.loginStatus),checkTime('登录检查',a.checkedAt)]),
     h('td',[h('div',{class:'row-actions'},[button('检测 CK',()=>action(a,'checkCookie'),a.busy||batchBusy.value,'text-button'),button(a.windowId?'导入到窗口':'创建 / 绑定',()=>openModal(a.windowId?'write':'bind',a.id),a.busy||batchBusy.value||!state.value.connected||connecting.value,'text-button'),a.windowId?button('打开',()=>action(a,'open'),a.busy||batchBusy.value||!state.value.connected,'text-button'):null,h('select',{'aria-label':`${a.note} 更多操作`,value:'',disabled:a.busy||batchBusy.value,onChange:e=>{const type=e.target.value;e.target.value='';if(['check','close'].includes(type)){void action(a,type);}else if(type)void openModal(type,a.id);}},[h('option',{value:''},'更多'),...['note','update',...(a.windowId?['check','bind','unbind','close']:[]),'remove'].map(type=>h('option',{value:type,disabled:['check','bind','close'].includes(type)&&!state.value.connected},{note:'修改备注',update:'更新 CK',check:'检查窗口登录',bind:'更换绑定',unbind:'解除绑定',close:'关闭窗口',remove:'移除本地记录'}[type]))])]),a.operation?h('small',{class:'operation',role:'status'},`${a.operation}中…`):null,a.error?h('div',{class:'row-error'},[h('span',a.error),lastActions.value[a.id]?button('重试',()=>{const type=lastActions.value[a.id];if(['write','bind','create','update','note','remove','unbind'].includes(type))void openModal(type==='create'?'bind':type,a.id);else void action(a,type);},a.busy||batchBusy.value,'text-button'):null]):null])
    ])))])]),
    filtered.value.length?h('div',{class:'pagination'},[h('small',`第 ${currentPage.value} / ${pageCount.value} 页 · ${filtered.value.length} 个结果`),select(pageSize,[['25','25 条 / 页'],['50','50 条 / 页'],['100','100 条 / 页']],{'aria-label':'每页条数'}),button('上一页',()=>page.value=currentPage.value-1,currentPage.value<=1),button('下一页',()=>page.value=currentPage.value+1,currentPage.value>=pageCount.value)]):null,
    !filtered.value.length?h('div',{class:'empty'},[h('div',{class:'empty-icon'},'▤'),h('h3',state.value.accounts.length?'没有匹配的账号':'添加你的第一个贴吧账号'),state.value.accounts.length?h('p','调整搜索关键词或状态筛选，查看其他账号。'):h('ol',{class:'empty-steps'},['保存账号 CK','创建或绑定独立窗口','导入 CK 并检查登录'].map((step,i)=>h('li',[h('span',String(i+1).padStart(2,'0')),step]))),state.value.accounts.length?null:button('添加账号',()=>openModal('add'),!!state.value.startupError||batchBusy.value,'primary')]):null,
    h('div',{class:'table-note'},'CK 已保存 ≠ CK 检测有效 ≠ 窗口已登录。窗口登录成功也不代表具有发帖权限。')
   ]),
   !modal.value&&report.value?h('section',{class:'card'},[h('div',{class:'inline spread'},[h('h2','逐条处理结果'),button('收起',()=>report.value=null,batchBusy.value)]),reportView(report.value)]):null,
   h('footer','凭据仅用于你选择的本机窗口。移除本地记录不会删除比特浏览器窗口。')
  ]),renderModal()
 ]);
}};
createApp(App).mount('#app');
