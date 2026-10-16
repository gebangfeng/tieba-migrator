const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {encrypt,decrypt,publicAccount,parseImport}=require('./accounts.cjs');
class Store {
  constructor(directory,safeStorage){this.directory=directory;this.safeStorage=safeStorage;this.accounts=[];this.address='http://127.0.0.1:54345';}
  init(){
    if(!this.safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，无法安全保存 CK');
    if(this.safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('系统密钥库不可用，请配置系统安全存储');
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    const keyFile=path.join(this.directory,'vault.key');
    const file=path.join(this.directory,'accounts.json');
    if(fs.existsSync(keyFile))this.key=Buffer.from(this.safeStorage.decryptString(fs.readFileSync(keyFile)),'base64');
    else {if(fs.existsSync(file))throw Error('加密密钥丢失，请恢复 vault.key，禁止覆盖现有账号库');this.key=crypto.randomBytes(32);fs.writeFileSync(keyFile,this.safeStorage.encryptString(this.key.toString('base64')),{mode:0o600,flag:'wx'});}
    if(this.key.length!==32)throw Error('加密密钥格式错误');
    if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.accounts))throw Error('账号库格式错误');this.accounts=data.accounts;this.address=data.address||this.address;for(const a of this.accounts)this.cookies(a);}
  }
  save(){const file=path.join(this.directory,'accounts.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,address:this.address,accounts:this.accounts},null,2),{mode:0o600});fs.renameSync(tmp,file);}
  transaction(fn){const snapshot=structuredClone(this.accounts),address=this.address;try{const result=fn();this.save();return result;}catch(e){this.accounts=snapshot;this.address=address;throw e;}}
  cookies(a){return decrypt(a.secret,this.key);}
  list(){return this.accounts.map(publicAccount);}
  get(id){const a=this.accounts.find(a=>a.id===id);if(!a)throw Error('账号不存在');return a;}
  nextNote(){const highest=this.accounts.reduce((max,a)=>{const match=/^贴吧账号(\d+)$/.exec(a.note);return match?Math.max(max,Number(match[1])):max;},0);return `贴吧账号${String(highest+1).padStart(3,'0')}`;}
  import(text){const rows=parseImport(text);return rows.map(r=>{if(r.error)return {line:r.line,status:'failed',message:r.error};if(this.accounts.some(a=>a.key===r.key||a.identities?.some(key=>r.identities.includes(key))))return {line:r.line,status:'duplicate',message:'账号已保存，已跳过'};try{this.transaction(()=>this.accounts.push({id:crypto.randomUUID(),key:r.key,identities:r.identities,cookieCount:r.cookies.length,note:r.autoNote?this.nextNote():r.note,secret:encrypt(r.cookies,this.key),ckStatus:'saved',loginStatus:'unknown',windowId:'',windowName:'',checkedAt:'',operation:'',error:'',createdAt:new Date().toISOString()}));return {line:r.line,status:'success',message:`已保存${r.cleaned?`，清理 ${r.cleaned} 个无效项`:''}`};}catch{ return {line:r.line,status:'failed',message:'本地加密保存失败'};}});}
  update(id,text){const rows=parseImport(text);if(rows.length!==1||rows[0].error)throw Error(rows[0]?.error||'更新 CK 时只能提交一个账号');const r=rows[0],a=this.get(id);if(this.accounts.some(other=>other.id!==id&&(other.key===r.key||other.identities?.some(key=>r.identities.includes(key)))))throw Error('此 CK 已保存在其他账号中');this.transaction(()=>{a.secret=encrypt(r.cookies,this.key);a.key=r.key;a.identities=r.identities;a.cookieCount=r.cookies.length;a.cookieUpdatedAt=new Date().toISOString();a.ckStatus='saved';a.ckAccountId='';a.ckMessage='';a.cookieCheckedAt='';a.loginStatus='unknown';a.nickname='';a.accountId='';a.checkedAt='';a.error='';});}
}
module.exports={Store};
