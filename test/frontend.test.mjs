import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

const html=fs.readFileSync(path.resolve(import.meta.dirname,"../index.html"),"utf8");
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)?.[1];

class Element {
  constructor(){ this.textContent=""; this.disabled=false; this.dataset={}; this.hidden=false; this.inert=false; this.children=[]; const set=new Set(["hidden"]); this.classList={add:x=>set.add(x),remove:x=>set.delete(x),contains:x=>set.has(x),toggle:(x,on)=>on?set.add(x):set.delete(x)}; }
  replaceChildren(){ this.children=[]; }
}
function vmFixture(fetch){
  const elements=new Map(["authGate","appShell","cloudErrorTitle","cloudErrorMessage","cloudErrorGate","cloudRetryBtn","conflictWrap","toasts","syncState","syncRetryBtn","syncConflictBtn","syncPlace","storagePlace","signOutBtn","syncLastSuccess"].map(id=>[id,new Element()]));
  const sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
  const context={document:{getElementById:id=>elements.get(id),addEventListener(){},title:"Wishlist",visibilityState:"visible"},window:{addEventListener(){}},sessionStorage,console:{warn(){},error(){}},fetch,AbortController,AbortSignal,Date,URL,Blob,crypto:{randomUUID:()=>"fixture-request-id"},setTimeout,clearTimeout,setInterval,clearInterval,location:{reload(){},assign(){}},Intl,JSON,Math,Number,String,Array,Object,Promise,RegExp,Set,Map};
  runInNewContext(script,context);
  return {context,elements};
}

test("single-file frontend JavaScript parses and does not persist private list data locally", () => {
  assert.ok(script); assert.doesNotThrow(()=>new Function(script));
  assert.doesNotMatch(script,/localStorage|SUPABASE_CONFIG|publishableKey|service_role/i);
  assert.match(script,/const CLOUD_ENABLED = true/);
});

test("database failure has a visible, password-free retry path", () => {
  assert.match(html,/id="cloudErrorGate"/);
  assert.match(html,/id="cloudErrorMessage"/);
  assert.match(html,/id="cloudRetryBtn"[^>]*>重试<\/button>/);
  assert.match(script,/云端数据库暂时无法连接/);
  assert.match(script,/async function retryCloudApp\(/);
  assert.match(script,/if \(response\.status === 401\)/);
});

test("read-only preview is shown and local edit/import/save paths are guarded", () => {
  assert.match(script,/privateReadOnly = session\.readOnly === true/);
  assert.match(script,/只读预览：不会保存修改/);
  assert.match(script,/if \(privateReadOnly\) return;\s*if \(CLOUD_ENABLED/);
  for (const name of ["mutate", "removeItem", "undoLastDelete", "openAdd", "openEdit", "saveModal", "setCoverValue", "doImportFile"])
    assert.match(script,new RegExp(`function ${name}\\([^)]*\\)\\s*\\{\\s*if \\(privateReadOnly\\)`));
});

test("simulated API outage renders the failure card and enables retry", async () => {
  let calls=0;
  const {context,elements}=vmFixture(async()=> ++calls===1 ? {ok:true,status:200,json:async()=>({expiresAt:Date.now()+60000})} : {ok:false,status:503});
  context.showCloudError("云端数据库暂时无法连接。");
  assert.equal(elements.get("cloudErrorGate").classList.contains("hidden"),false);
  assert.equal(elements.get("cloudErrorMessage").textContent,"云端数据库暂时无法连接。");
  await context.retryCloudApp();
  assert.equal(elements.get("cloudErrorGate").classList.contains("hidden"),false);
  assert.equal(elements.get("cloudRetryBtn").textContent,"重试");
  assert.equal(elements.get("cloudRetryBtn").disabled,false);
});

test("slow successful load stays in loading state and then opens the app", async () => {
  let resolveSession, resolveData;
  const {context,elements}=vmFixture(()=>new Promise(resolve=>{resolveSession=resolve;}));
  context.finishData=resolve=>{resolveData=resolve;};
  runInNewContext("init = () => {}; loadCloudData = () => new Promise(resolve => finishData(resolve));",context);
  const opening=context.enterCloudApp();
  assert.equal(elements.get("cloudErrorGate").classList.contains("hidden"),false);
  assert.equal(elements.get("cloudErrorTitle").textContent,"正在加载清单");
  assert.equal(elements.get("cloudRetryBtn").classList.contains("hidden"),true);
  resolveSession({ok:true,status:200,json:async()=>({expiresAt:Date.now()+60000,readOnly:true})});
  for(let i=0;i<5&&!resolveData;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get("cloudErrorTitle").textContent,"正在加载清单");
  resolveData(); await opening;
  assert.equal(elements.get("cloudErrorGate").classList.contains("hidden"),true);
  assert.equal(elements.get("appShell").classList.contains("hidden"),false);
  assert.match(elements.get("syncState").textContent,/只读预览/);
  context.suspendPrivateSession();
});

test("a real API failure changes loading into the retryable outage state", async () => {
  const {context,elements}=vmFixture(async()=>({ok:true,status:200,json:async()=>({expiresAt:Date.now()+60000})}));
  runInNewContext('loadCloudData = async () => { throw new Error("synthetic database unavailable"); };',context);
  const opening=context.enterCloudApp();
  assert.equal(elements.get("cloudErrorTitle").textContent,"正在加载清单");
  await opening;
  assert.equal(elements.get("cloudErrorGate").classList.contains("hidden"),false);
  assert.equal(elements.get("cloudErrorTitle").textContent,"私有数据库暂时不可用");
  assert.match(elements.get("cloudErrorMessage").textContent,/云端数据库暂时无法连接/);
  assert.equal(elements.get("cloudRetryBtn").classList.contains("hidden"),false);
  assert.equal(elements.get("cloudRetryBtn").textContent,"重试");
});

test("suspended delayed data response cannot repopulate private state", async () => {
  let resolveFetch;
  const {context}=vmFixture(()=>new Promise(resolve=>{resolveFetch=resolve;}));
  const pending=context.loadCloudData();
  runInNewContext("privateSessionActive=true",context);
  context.suspendPrivateSession();
  resolveFetch({ok:true,status:200,json:async()=>({revision:99,updatedAt:"fixture",items:[{id:"fixture",title:"synthetic",platforms:[]}],optout:[]})});
  await pending;
  assert.equal(runInNewContext("state.items.length",context),0);
  assert.equal(runInNewContext("cloudRevision",context),null);
  assert.equal(runInNewContext("privateSessionActive",context),false);
});

test("restored draft cannot be overwritten by a new edit and recovery controls escape inert app", () => {
  const {context,elements}=vmFixture(async()=>({ok:false,status:503}));
  runInNewContext('conflictSnapshot={data:{items:[{id:"original-draft"}]}}; privateSessionActive=true; scheduleRemoteSave([{id:"new-edit"}]);',context);
  assert.equal(runInNewContext("conflictSnapshot.data.items[0].id",context),"original-draft");
  assert.match(html,/<\/div>\s*<!-- Keep recovery actions outside the inert application while an unsynced draft is pending\. -->\s*<\/div>\s*<div class="mask2 hidden" id="conflictWrap"/);
  runInNewContext("showApp()",context);
  assert.equal(elements.get("appShell").inert,true);
  assert.equal(elements.get("conflictWrap").classList.contains("hidden"),true);
});

test("existing import, export, cover and conflict surfaces remain present", () => {
  assert.match(script,/function buildExport\(/);
  assert.match(script,/function doImportFile/);
  assert.match(script,/function migrateCoversToThumb/);
  assert.match(script,/function rememberConflict\(/);
  assert.match(script,/发现跨设备冲突/);
});


test("30-day Access expiry uses bounded timers and expires only at the real deadline", () => {
  const {context}=vmFixture(async()=>({ok:false,status:503}));
  let clock=Date.now(), expired=0;
  const timers=[];
  context.Date=class extends Date { static now(){ return clock; } };
  context.setTimeout=(callback,delay)=>{ timers.push({callback,delay}); return timers.length; };
  context.clearTimeout=()=>{};
  context.expirePrivateSession=()=>{ expired++; };
  const deadline=clock+30*24*60*60*1000;
  context.schedulePrivateSessionExpiry(deadline);
  assert.equal(expired,0);
  assert.equal(timers[0].delay,2147483647);
  clock+=timers[0].delay; timers[0].callback();
  assert.equal(expired,0);
  assert.equal(timers[1].delay,deadline-clock);
  clock=deadline; timers[1].callback();
  assert.equal(expired,1);
  assert.equal(timers.length,2);
});

test("invalid and elapsed Access deadlines expire without scheduling a timer", () => {
  const {context}=vmFixture(async()=>({ok:false,status:503}));
  let expired=0;
  context.expirePrivateSession=()=>{ expired++; };
  context.setTimeout=()=>{ throw new Error("Expired sessions must not be scheduled"); };
  context.clearTimeout=()=>{};
  context.schedulePrivateSessionExpiry(Date.now()-1000);
  context.schedulePrivateSessionExpiry("invalid");
  assert.equal(expired,2);
});
