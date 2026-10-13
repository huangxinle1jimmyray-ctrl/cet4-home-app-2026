const connection=$('connection-status'),storage=$('storage-status'),installButton=$('install-btn');
let installPrompt=null,dbPromise=null,shellReady=false;

function openLocalDb(){
  if(!('indexedDB'in window))return Promise.resolve(null);
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('cet4-home-local',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots')};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  }).catch(()=>null);
  return dbPromise;
}
window.persistBackup=async snapshot=>{
  try{
    const db=await openLocalDb();if(!db)return;
    const tx=db.transaction('snapshots','readwrite');
    tx.objectStore('snapshots').put(JSON.stringify(snapshot),'current');
    tx.onerror=()=>{storage.textContent='本机备份失败，请导出记录'};
  }catch{storage.textContent='本机备份失败，请导出记录'}
};
async function readBackup(){
  const db=await openLocalDb();if(!db)return null;
  return new Promise(resolve=>{
    const req=db.transaction('snapshots','readonly').objectStore('snapshots').get('current');
    req.onsuccess=()=>{try{resolve(req.result?JSON.parse(req.result):null)}catch{resolve(null)}};
    req.onerror=()=>resolve(null);
  });
}
function updateConnection(message){
  storage.textContent=window.cet4StorageError?'本机保存受限，请立即导出记录':'记录保存在这台设备';
  if(message){connection.textContent=message;return}
  connection.textContent=shellReady
    ?(navigator.onLine?'已可离线使用 · 学习记录只保存在本机':'当前离线 · 工作台可继续使用')
    :'正在准备离线页面…';
}
async function prepareOffline(){
  if(!('serviceWorker'in navigator)){updateConnection('此浏览器不支持离线安装；请用 iPhone Safari 打开');return}
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    await navigator.serviceWorker.ready;
    const cache=await caches.open('cet4-home-shell-v1');
    shellReady=!!(await cache.match(new URL('./index.html',registration.scope).href));
    updateConnection(shellReady?undefined:'页面缓存未完成，请联网刷新后再安装');
  }catch(error){updateConnection('离线准备失败：'+String(error.message||error)+'。请联网刷新后重试')}
}
window.addEventListener('online',()=>updateConnection());
window.addEventListener('offline',()=>updateConnection());
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installButton.hidden=false});
window.addEventListener('appinstalled',()=>{installPrompt=null;installButton.hidden=true;updateConnection('已添加到主屏幕 · 可离线打开')});
installButton.hidden=false;
installButton.addEventListener('click',async()=>{
  if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return}
  updateConnection('iPhone Safari：点分享按钮 → 添加到主屏幕 → 添加');
});

function fromScriptable(source){
  const old=source.state||source;
  if(!old||typeof old!=='object'||!old.days||!old.plans)throw Error('Scriptable 备份缺少 days 或 plans');
  const imported={days:old.days,taskPlans:{},planHistory:[],switchHistory:[],slotChecks:{}};
  for(const [day,list] of Object.entries(old.plans)){
    if(!/^2026-(10|11|12)-\d{2}$/.test(day)||!Array.isArray(list))continue;
    imported.taskPlans[day]=list.map(task=>({
      id:String(task.id||'custom-'+Math.random().toString(36).slice(2)),
      title:String(task.title||'未命名任务'),desc:String(task.desc||''),
      start:String(task.start||''),duration:30,
      priority:String(task.priority||'重要不紧急'),
      status:old.days[day]?.checks?.[task.id]?'已完成':'未开始'
    }));
  }
  if(Array.isArray(old.slots)&&old.slots.length===6){
    imported.schedule=SLOT_DEFAULTS.map((def,index)=>({
      ...def,start:old.slots[index]?.start||def.start,
      linked:Array.isArray(old.slots[index]?.ids)?old.slots[index].ids.filter(id=>TASK_NAMES[id]):def.linked
    }));
  }
  return imported;
}
function normaliseImport(source){
  if(!source||typeof source!=='object'||Array.isArray(source))throw Error('备份格式不正确');
  const data=source.state?.plans?fromScriptable(source):source;
  if(!data.days||typeof data.days!=='object'||Array.isArray(data.days))throw Error('备份缺少有效的每日记录');
  const clean={...data,days:data.days,taskPlans:data.taskPlans||{},planHistory:data.planHistory||[],switchHistory:data.switchHistory||[],slotChecks:data.slotChecks||{}};
  delete clean.app;delete clean.exportedAt;return clean;
}
$('import-btn').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>5*1024*1024)throw Error('备份超过 5 MB');
    const imported=normaliseImport(JSON.parse(await file.text()));
    if(!window.confirm('导入将覆盖这台设备现有的打卡、任务与设置。请先导出当前记录。确认导入吗？'))return;
    state=imported;save();renderSchedule();render();updateConnection('备份已导入，本机记录已更新');
  }catch(error){updateConnection('导入失败：'+String(error.message||error))}
  finally{event.target.value=''}
});
$('clear-local-btn').addEventListener('click',()=>{
  if(window.prompt('清空后无法在页面内撤销。请先导出备份，再输入「清空」确认：')!=='清空')return;
  state={days:{},taskPlans:{},planHistory:[],switchHistory:[],slotChecks:{}};
  save();renderSchedule();render();updateConnection('本机学习记录已清空');
});
window.addEventListener('storage',event=>{
  if(event.key!==KEY||!event.newValue)return;
  try{state=JSON.parse(event.newValue);state.days??={};state.taskPlans??={};state.planHistory??=[];renderSchedule();render()}
  catch{updateConnection('另一页面的记录无法读取，请刷新页面')}
});
(async()=>{
  if(!window.cet4HadLocalState){
    const backup=await readBackup();
    if(backup?.days){state=backup;state.taskPlans??={};state.planHistory??=[];save();renderSchedule();render();updateConnection('已从本机备份恢复记录')}
  }
  window.persistBackup(state);updateConnection();prepareOffline();
})();
