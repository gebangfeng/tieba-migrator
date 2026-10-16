const {app,BrowserWindow,ipcMain,dialog,safeStorage,clipboard,shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const {Store}=require('./store.cjs');const {AccountService}=require('./service.cjs');const {MAX_BYTES}=require('./accounts.cjs');
if(process.env.TIEBA_DATA_DIR)app.setPath('userData',path.resolve(process.env.TIEBA_DATA_DIR));
const iconPath=app.isPackaged?path.join(process.resourcesPath,'icon.png'):path.join(__dirname,'../build/icon.png');
let win,service,startupError='';
const send=state=>{if(win&&!win.isDestroyed())win.webContents.send('state',state);};
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{
  if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)return {ok:false,error:'非法调用'};
  try{if(startupError&&!['state','openGuide','copyWechat'].includes(name))throw Error(startupError);return {ok:true,data:await fn(...args)};}catch(e){return {ok:false,error:service?service.cleanError(e):startupError||'操作失败'};}
});}
app.whenReady().then(()=>{
  if(process.platform==='darwin')app.dock.setIcon(iconPath);
  try{const store=new Store(path.join(app.getPath('userData'),'account-vault'),safeStorage);store.init();service=new AccountService(store,{onState:send});}catch{startupError='无法打开本地加密账号库，请检查系统密钥库及账号文件。现有数据不会被覆盖。';}
  handle('openGuide',async()=>{await shell.openExternal('https://my.feishu.cn/wiki/XVfOwZT5hiPiFNkjUuScamLvnfg?from=from_copylink');return true;});
  handle('copyWechat',()=>{clipboard.writeText('f2468558247');return true;});
  handle('state',()=>service?service.state():{accounts:[],windows:[],groups:[],address:'http://127.0.0.1:54345',startupError});
  handle('connect',input=>service.connect(input));
  handle('import',text=>service.import(text));
  handle('startBatch',input=>service.startBatch(input));
  handle('stopBatch',()=>service.stopBatch());
  handle('action',(id,action,input)=>service.action(id,action,input));
  handle('readImportFile',async()=>{const result=await dialog.showOpenDialog(win,{filters:[{name:'账号 TXT / JSON',extensions:['txt','json']}],properties:['openFile']});if(result.canceled)return null;const file=result.filePaths[0];if(fs.statSync(file).size>MAX_BYTES)throw Error('导入文件最大 1MB');const text=fs.readFileSync(file,'utf8');if(Buffer.byteLength(text)>MAX_BYTES)throw Error('导入文件最大 1MB');return text;});
  function create(){
    win=new BrowserWindow({icon:iconPath,width:1380,height:900,minWidth:1000,minHeight:700,backgroundColor:'#f5f7fb',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.setMenuBarVisibility(false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('close',event=>{if(service?.batch?.running||service?.operations.size||service?.connecting){event.preventDefault();void dialog.showMessageBox(win,{type:'info',message:'账号操作仍在进行，请等待完成后关闭。'});}});
    void win.loadFile(path.join(__dirname,'../dist/index.html'));
  }
  create();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)create();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
