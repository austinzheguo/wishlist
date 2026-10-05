import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { createApp } from "../server.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key", use: "sig", alg: "RS256" };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function token() {
  const head = b64({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
  const body = b64({ iss: "https://fixture.cloudflareaccess.com", aud: ["fixture-audience"], sub: "fixture-user", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 });
  const content = `${head}.${body}`;
  return `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
}
function item(title = "Synthetic fixture") {
  const t = Date.now();
  return { id:"fixture-item-1", type:"书", title, status:"want", priority:2, rating:0, note:"", cover:"", author:"", lang:"", platforms:[], created:t, updated:t };
}
async function fixture(t, readOnly = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wishlist-test-"));
  const { server, db } = createApp({
    dbPath:path.join(dir,"test.sqlite"), publicOrigin:"https://wishlist.example.test",
    accessTeamDomain:"fixture.cloudflareaccess.com", accessAudience:"fixture-audience",
    getJwks:async()=>[jwk], htmlPath:path.join(dir,"index.html"), readOnly
  });
  fs.writeFileSync(path.join(dir,"index.html"), "<!doctype html><title>fixture</title>");
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{ await new Promise(resolve=>server.close(resolve)); db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  return { base, auth:{"cf-access-jwt-assertion":token()} };
}
test("private origin requires a valid Access JWT; health remains available", async t => {
  const {base,auth}=await fixture(t);
  assert.equal((await fetch(`${base}/`)).status,401);
  assert.equal((await fetch(`${base}/`,{headers:auth})).status,200);
  assert.equal((await fetch(`${base}/healthz`)).status,200);
});

test("save is revision-checked and idempotent after an expired undo window", async t => {
  const {base,auth}=await fixture(t);
  const snapshot={items:[item()],optout:[],pendingDeleteUndo:{item:item("Undo fixture"),expiresAt:Date.now()+500}};
  const request={expectedRevision:0,requestId:"fixture-request-000001",snapshot};
  const send=()=>fetch(`${base}/api/save`,{method:"POST",headers:{...auth,Origin:"https://wishlist.example.test","Content-Type":"application/json"},body:JSON.stringify(request)});
  const first=await send(); assert.equal(first.status,200); const saved=await first.json(); assert.equal(saved.revision,1);
  await new Promise(resolve=>setTimeout(resolve,650));
  const retry=await send(); assert.equal(retry.status,200); assert.deepEqual(await retry.json(),saved);
  const state=await fetch(`${base}/api/data`,{headers:auth}); assert.equal(state.status,200);
  const data=await state.json(); assert.equal(data.revision,1); assert.equal(data.items.length,1);
  assert.equal(data.items[0].title,"Synthetic fixture");
  const stale=await fetch(`${base}/api/save`,{method:"POST",headers:{...auth,Origin:"https://wishlist.example.test","Content-Type":"application/json"},body:JSON.stringify({expectedRevision:0,requestId:"fixture-request-000002",snapshot:{items:[item("Other fixture")],optout:[]}})});
  assert.equal(stale.status,409);
});

test("cross-origin writes and malformed snapshots are rejected", async t => {
  const {base,auth}=await fixture(t);
  const response=await fetch(`${base}/api/save`,{method:"POST",headers:{...auth,Origin:"https://attacker.example","Content-Type":"application/json"},body:JSON.stringify({expectedRevision:0,requestId:"fixture-request-000003",snapshot:{items:[],optout:[]}})});
  assert.equal(response.status,403);
});

test("read-only preview advertises its mode and rejects writes", async t => {
  const {base,auth}=await fixture(t,true);
  const session=await fetch(`${base}/api/session`,{headers:auth});
  assert.equal(session.status,200); assert.equal((await session.json()).readOnly,true);
  const response=await fetch(`${base}/api/save`,{method:"POST",headers:{...auth,Origin:"https://wishlist.example.test","Content-Type":"application/json"},body:JSON.stringify({expectedRevision:0,requestId:"fixture-readonly-0001",snapshot:{items:[item()],optout:[]}})});
  assert.equal(response.status,423); assert.deepEqual(await response.json(),{error:"read-only-preview"});
  const state=await fetch(`${base}/api/data`,{headers:auth});
  assert.equal((await state.json()).items.length,0);
});
