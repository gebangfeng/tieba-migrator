const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('client',{
 startBatch:input=>ipcRenderer.invoke('startBatch',input),
 stopBatch:()=>ipcRenderer.invoke('stopBatch'),
 openGuide:()=>ipcRenderer.invoke('openGuide'),
 copyWechat:()=>ipcRenderer.invoke('copyWechat'),
 state:()=>ipcRenderer.invoke('state'),
 connect:input=>ipcRenderer.invoke('connect',input),
 importText:text=>ipcRenderer.invoke('import',text),
 action:(id,action,input)=>ipcRenderer.invoke('action',id,action,input),
 readImportFile:()=>ipcRenderer.invoke('readImportFile'),
 onState:fn=>{const listener=(_,state)=>fn(state);ipcRenderer.on('state',listener);return ()=>ipcRenderer.removeListener('state',listener);}
});
