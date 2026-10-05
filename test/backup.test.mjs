import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

test("backup is independently readable, integrity-checked, and leaves no SQLite sidecars", t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"wishlist-backup-test-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const dbPath=path.join(dir,"source.sqlite"), backupDir=path.join(dir,"backups");
  const db=new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE wishlist_items(id TEXT PRIMARY KEY);
    CREATE TABLE app_state(id INTEGER PRIMARY KEY, revision INTEGER, updated_at TEXT, optout_json TEXT, pending_delete_json TEXT);
    INSERT INTO wishlist_items VALUES('synthetic');
    INSERT INTO app_state VALUES(1,7,'2026-01-02T03:04:05.000Z','[]',NULL);`);
  db.close();
  const result=spawnSync(process.execPath,["backup.mjs"],{encoding:"utf8",env:{...process.env,SQLITE_PATH:dbPath,BACKUP_DIR:backupDir}});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout.trim()); assert.equal(report.ok,true); assert.equal(report.rows,1); assert.equal(report.revision,7);
  const files=fs.readdirSync(backupDir); assert.equal(files.length,1); assert.match(files[0],/\.sqlite$/);
  const backupPath=path.join(backupDir,files[0]);
  assert.equal(fs.statSync(backupPath).mode & 0o777,0o600);
  const verify=spawnSync(process.execPath,["verify-backup.mjs",backupPath],{encoding:"utf8"});
  assert.equal(verify.status,0,verify.stderr);
  const checked=JSON.parse(verify.stdout.trim()); assert.equal(checked.ok,true); assert.equal(checked.rows,1); assert.equal(checked.revision,7);
  assert.deepEqual(fs.readdirSync(backupDir),files);
});
