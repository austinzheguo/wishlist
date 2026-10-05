import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sample = {
  app:"wishlist", ver:1, exportedAt:"2026-10-05T00:00:00.000Z", optout:["fixture-title"],
  items:[{id:"fixture-id",type:"书",title:"Synthetic migration fixture",status:"want",priority:2,rating:0,note:"synthetic only",cover:"",author:"",lang:"",platforms:["PC"],created:1700000000000,updated:1700000001000}]
};
function runImport(t, data) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"wishlist-migrate-test-"));
  const input=path.join(dir,"fixture.json"), dbPath=path.join(dir,"fixture.sqlite");
  fs.writeFileSync(input,JSON.stringify(data));
  const {db}=createApp({dbPath,htmlPath:path.join(dir,"unused.html")}); db.close();
  const result=spawnSync(process.execPath,[path.join(root,"migrate.mjs")],{encoding:"utf8",env:{...process.env,IMPORT_FILE:input,SQLITE_PATH:dbPath,SOURCE_REVISION:"19",SOURCE_UPDATED_AT:"2026-09-12T13:02:42.325268Z"}});
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return {result,dbPath};
}

test("migration preserves every supported synthetic field and metadata", t => {
  const {result,dbPath}=runImport(t,sample);
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout.trim());
  assert.equal(output.count,1); assert.equal(output.revision,19);
  const db=new DatabaseSync(dbPath,{readOnly:true});
  const row=db.prepare("SELECT * FROM wishlist_items WHERE id='fixture-id'").get();
  const meta=db.prepare("SELECT revision,updated_at,optout_json FROM app_state WHERE id=1").get();
  assert.equal(row.title,sample.items[0].title); assert.equal(row.note,sample.items[0].note);
  assert.deepEqual(JSON.parse(row.platforms_json),sample.items[0].platforms);
  assert.equal(Number(meta.revision),19); assert.equal(meta.updated_at,"2026-09-12T13:02:42.325268Z");
  assert.deepEqual(JSON.parse(meta.optout_json),sample.optout);
  db.close();
});

test("migration fails closed instead of defaulting malformed fields", t => {
  const invalid=structuredClone(sample); invalid.items[0].rating="bad";
  const {result,dbPath}=runImport(t,invalid);
  assert.notEqual(result.status,0);
  const db=new DatabaseSync(dbPath,{readOnly:true});
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM wishlist_items").get().n),0);
  assert.equal(Number(db.prepare("SELECT revision FROM app_state WHERE id=1").get().revision),0);
  db.close();
});
