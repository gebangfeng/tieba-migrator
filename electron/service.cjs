const {Locks}=require('./accounts.cjs');
const {BitBrowser}=require('./bitbrowser.cjs');
const {endpoint}=require('./core.cjs');
const {inspectCookie}=require('./login.cjs');
class AccountService {
  constructor(store,{bitFactory=config=>new BitBrowser(config),cookieCheck=inspectCookie,onState=()=>{}}={}){
    this.store=store;this.bitFactory=bitFactory;this.cookieCheck=cookieCheck;this.onState=onState;this.config={address:store.address,token:''};this.connected=false;this.connecting=false;this.windows=[];this.groups=[];this.locks=new Locks();this.operations=new Map();this.batch=null;this.batchOwner=Symbol();
  }
  state(){return {batch:this.batch?structuredClone(this.batch):null,address:this.config.address,connected:this.connected,connecting:this.connecting,windows:this.windows,groups:this.groups,accounts:this.store.list().map(a=>({...a,operation:this.operations.get(a.id)||'',busy:this.operations.has(a.id)}))};}
  emit(){this.onState(this.state());}
  cleanError(error){
    let text=String(error?.message||'操作失败');
    // Unexpected automation errors are deliberately generic; they can contain page data.
    if(/playwright|browserContext\.|page\.|locator\.|Protocol error|Target closed|Timeout.*exceeded/i.test(text))return '窗口操作失败，请检查比特浏览器和网络后重试';
    const secrets=[this.config.token];for(const a of this.store.accounts){try{for(const c of this.store.cookies(a))secrets.push(c.value);}catch{}}
    for(const value of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))text=text.split(value).join('[已隐藏]');
    return text.replace(/(BDUSS(?:_BFESS)?|STOKEN|PTOKEN|cookie|token|x-api-key)\s*[:=]\s*[^\s；，]+/gi,'$1=[已隐藏]').slice(0,300);
  }
  bit(){if(!this.connected||this.connecting)throw Error('请先在顶部连接比特浏览器');return this.bitFactory({...this.config});}
  async connect(input){
    if(this.batch?.running||this.connecting||this.operations.size)throw Error('正在操作，请等待完成后再修改连接');
    const address=endpoint(String(input?.address||'')),token=String(input?.token||'').trim();
    this.config={address,token};this.connected=false;this.connecting=true;this.windows=[];this.groups=[];this.emit();
    try{const bit=this.bitFactory(this.config);this.windows=(await bit.list()).map(w=>({id:String(w.id),name:String(w.name||w.remark||w.id),opened:Number(w.status)===1}));this.connected=true;this.store.transaction(()=>{this.store.address=address;});try{this.groups=(await bit.list('/group/list')).map(g=>({id:String(g.id),name:String(g.groupName||g.name||g.id)}));}catch{}return this.state();}
    catch(e){this.connected=false;throw Error(this.cleanError(e));}finally{this.connecting=false;this.emit();}
  }
  async run(id,label,extra,fn){
    const account=this.store.get(id);const keys=[`account:${id}`,...new Set([account.windowId,...extra].filter(Boolean).map(w=>`window:${w}`))];
    return this.locks.run(keys,async()=>{
      this.operations.set(id,label);this.emit();
      try{return await fn(account);}
      catch(e){const message=this.cleanError(e);try{this.store.transaction(()=>{this.store.get(id).error=message;});}catch{}throw Error(message);}
      finally{this.operations.delete(id);this.emit();}
    });
  }
  import(text){if(this.batch?.running)throw Error('请等待批量任务完成后再导入账号');if(this.connecting)throw Error('请等待连接完成');const results=this.store.import(text);this.emit();return {results,success:results.filter(r=>r.status==='success').length,duplicate:results.filter(r=>r.status==='duplicate').length,failed:results.filter(r=>r.status==='failed').length};}
  async action(id,action,input={},owner){
    if(this.batch?.running&&owner!==this.batchOwner)throw Error('批量任务执行中，请先停止并等待当前项完成');
    if(!input||typeof input!=='object')throw Error('操作参数无效');
    const labels={note:'修改备注',update:'更新 CK',checkCookie:'检查 CK',bind:'绑定窗口',create:'创建窗口',unbind:'解除绑定',remove:'移除记录',write:'导入 CK',check:'检查窗口登录',open:'打开窗口',close:'关闭窗口'};
    if(!labels[action])throw Error('不支持的操作');
    return this.run(id,labels[action],[input.windowId],async a=>{
      if(action==='note'){this.store.transaction(()=>{a.note=String(input.note||'').trim().slice(0,100);});return;}
      if(action==='update'){this.store.update(id,input.text);if(typeof input.note==='string')this.store.transaction(()=>{this.store.get(id).note=input.note.trim().slice(0,100);});return;}
      if(action==='remove'){if(input.confirm!==true)throw Error('请确认仅移除本地记录');this.store.transaction(()=>{this.store.accounts=this.store.accounts.filter(x=>x.id!==id);});return;}
      if(action==='unbind'){this.store.transaction(()=>{a.windowId='';a.windowName='';a.loginStatus='unknown';a.checkedAt='';a.importedAt='';a.error='';});return;}
      if(action==='checkCookie'){
        let identity={};const status=await this.cookieCheck(this.store.cookies(a),undefined,result=>{identity=result;});
        this.store.transaction(()=>{a.ckStatus=status;a.ckMessage=({valid:'已确认 CK 登录身份',invalid:'CK 未登录或已失效，请更新 CK',verification:'需要人工验证，请在窗口处理后重新检查',check_failed:'未能确认 CK 状态，请检查网络后重试'})[status]||'未能确认 CK 状态';a.cookieCheckedAt=new Date().toISOString();a.ckAccountId=identity.userId||'';a.error=status==='check_failed'?'CK 检测失败，请检查网络后重试':status==='verification'?'CK 检测遇到验证，请检查窗口登录':'';});return;
      }
      const bit=this.bit();
      if(action==='create'){
        if(a.windowId)throw Error('账号已绑定窗口，请使用导入或重新导入');
        if(a.createUncertain&&input.confirmNoWindow!==true)throw Error('上次创建结果待核对，请绑定已有窗口；确认没有创建后才可再次新建');
        this.store.transaction(()=>{a.createUncertain=true;a.error='窗口创建结果待核对';});
        let created;
        try{created=await bit.create(a.note,String(input.groupId||''));if(!created?.id)throw Error('创建未返回窗口 ID，请核对比特窗口列表后手动绑定');}
        catch(e){if(e.definite)this.store.transaction(()=>{a.createUncertain=false;});throw e;}
        a.windowId=String(created.id);a.windowName=a.note;a.createUncertain=false;a.error='';a.loginStatus='unknown';
        // Commit binding before any cookie write. Retrying never creates a second window.
        this.store.save();this.windows.push({id:a.windowId,name:a.note,opened:false});return;
      }
      if(action==='bind'){
        const destination=String(input.windowId||'');if(!/^[\w-]+$/.test(destination))throw Error('请选择有效窗口');
        if(this.store.accounts.some(other=>other.id!==id&&other.windowId===destination))throw Error('该窗口已绑定其他账号');
        const detail=await bit.call('/browser/detail',{id:destination});if(detail?.id!==destination)throw Error('无法读取目标窗口');
        this.store.transaction(()=>{a.windowId=destination;a.windowName=String(detail.name||destination);a.loginStatus='unknown';a.checkedAt='';a.importedAt='';a.createUncertain=false;a.error='';});return;
      }
      if(!a.windowId)throw Error('请先创建或绑定窗口');
      if(action==='open'){await bit.open(a.windowId);return;}
      if(action==='close'){const detail=await bit.call('/browser/detail',{id:a.windowId});if(Number(detail?.status)!==0)await bit.close(a.windowId);this.store.transaction(()=>{a.loginStatus='unknown';});return;}
      if(action==='write'){
        if(input.confirmReplace!==true)throw Error('请确认替换目标窗口的百度登录状态');
        this.store.transaction(()=>{a.loginStatus='unknown';a.checkedAt='';a.error='';});
        const result=await bit.write(a.windowId,this.store.cookies(a));
        this.applyLogin(a,result);return;
      }
      if(action==='check'){
        try{this.applyLogin(a,await bit.check(a.windowId));}catch(e){this.store.transaction(()=>{a.loginStatus='check_failed';a.checkedAt=new Date().toISOString();});throw e;}
      }
    });
  }
  startBatch(input={}){
    if(this.batch?.running||this.operations.size||this.connecting)throw Error('有任务正在执行，请等待完成');
    const allowed=['checkCookie','create','prepare','bind','write','check','open','close','unbind','remove'];
    if(!allowed.includes(input.action))throw Error('不支持的批量操作');
    if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>500||new Set(input.ids).size!==input.ids.length)throw Error('每批请选择 1 至 500 个不同账号');
    if(!['checkCookie','unbind','remove'].includes(input.action))this.bit();
    if(['write','prepare'].includes(input.action)&&input.confirmReplace!==true)throw Error('请确认替换所选窗口的百度登录状态');
    if(['unbind','remove','bind'].includes(input.action)&&input.confirm!==true)throw Error('请确认本次批量操作');
    const accounts=input.ids.map(id=>this.store.get(id));
    const bindings={};
    if(input.action==='bind'){
      const destinations=new Set();
      for(const a of accounts){
        const windowId=String(input.bindings?.[a.id]||'');
        if(!/^[\w-]+$/.test(windowId)||!this.windows.some(w=>w.id===windowId))throw Error('请为每个账号选择有效的目标窗口');
        if(destinations.has(windowId)||this.store.accounts.some(other=>other.id!==a.id&&other.windowId===windowId))throw Error('目标窗口重复或已绑定其他账号，请检查映射');
        destinations.add(windowId);bindings[a.id]=windowId;
      }
    }
    const options={groupId:String(input.groupId||''),confirmReplace:input.confirmReplace===true,confirm:input.confirm===true,bindings};
    this.batch={action:input.action,running:true,stopping:false,total:accounts.length,done:0,success:0,failed:0,skipped:0,stopped:0,current:'',options,results:accounts.map((a,i)=>({line:i+1,id:a.id,note:a.note,windowId:bindings[a.id]||a.windowId,windowName:this.windows.find(w=>w.id===(bindings[a.id]||a.windowId))?.name||a.windowName||'',status:'queued',message:'等待执行'}))};
    this.emit();void this.executeBatch(this.batch);return this.state();
  }
  stopBatch(){if(this.batch?.running){this.batch.stopping=true;this.emit();}return this.state();}
  async executeBatch(job){
    try{
      for(const row of job.results){
        if(job.stopping){row.status='stopped';row.message='已停止，未执行';job.stopped++;job.done++;continue;}
        row.status='running';row.message='正在执行';job.current=row.note;this.emit();
        try{
          const a=this.store.get(row.id),type=job.action;
          if(type==='create'&&a.windowId||['write','check','open','close','unbind'].includes(type)&&!a.windowId){row.status='skipped';row.message=type==='create'?'已绑定窗口，跳过创建':'未绑定窗口，已跳过';job.skipped++;}
          else{
            const options={...job.options,windowId:job.options.bindings[row.id]};
            if(type==='prepare'){
              if(!a.windowId)await this.action(row.id,'create',options,this.batchOwner);
              if(job.stopping){row.status='stopped';row.message='窗口已创建并保留绑定，尚未写入 CK';job.stopped++;}
              else await this.action(row.id,'write',options,this.batchOwner);
            }else await this.action(row.id,type,options,this.batchOwner);
            if(row.status!=='stopped'){
              const updated=type==='remove'?null:this.store.get(row.id);
              row.windowId=updated?.windowId||row.windowId;row.windowName=updated?.windowName||row.windowName;
              const ckLabels={valid:'CK 检测有效',invalid:'CK 已失效',verification:'CK 需要验证',check_failed:'CK 检测失败'};
              const loginLabels={logged_in:'窗口已登录',login_required:'窗口未登录或已失效',verification:'窗口需要人工验证',check_failed:'窗口登录检查失败'};
              const resultFailed=type==='checkCookie'?updated.ckStatus!=='valid':['check','write','prepare'].includes(type)?updated.loginStatus!=='logged_in':false;
              row.status=resultFailed?'failed':'success';
              row.message=type==='checkCookie'?ckLabels[updated.ckStatus]||'CK 状态未知':['check','write','prepare'].includes(type)?`${type==='check'?'':'CK 已写入；'}${loginLabels[updated.loginStatus]||'窗口状态未知'}${updated.error?'；'+updated.error:''}`:({create:'窗口已创建并绑定，尚未写入 CK',bind:'已绑定，尚未写入 CK',open:'已打开窗口',close:'已关闭窗口',unbind:'已解除绑定，窗口保留',remove:'已移除本地记录，窗口保留'})[type];
              job[resultFailed?'failed':'success']++;
            }
          }
        }catch(error){row.status='failed';row.message=this.cleanError(error);const saved=this.store.accounts.find(a=>a.id===row.id);if(saved){row.windowId=saved.windowId;row.windowName=saved.windowName;}job.failed++;}
        job.done++;this.emit();
        // Yield between items so stop requests can be processed even for local operations.
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }finally{job.running=false;job.current='';this.emit();}
  }
  applyLogin(a,result){
    const mismatch=a.ckAccountId&&result.accountId&&a.ckAccountId!==result.accountId;
    this.store.transaction(()=>{a.loginStatus=mismatch?'check_failed':result.status;a.nickname=result.nickname||'';a.accountId=result.accountId||'';a.checkedAt=new Date().toISOString();if(result.imported)a.importedAt=a.checkedAt;a.error=mismatch?'窗口实际账号与 CK 检测身份不一致，请重新导入并核对':result.status==='check_failed'||result.status==='verification'?result.message:'';});
  }
}
module.exports={AccountService};
