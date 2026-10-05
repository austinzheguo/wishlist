import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const inputPath = process.env.IMPORT_FILE;
const dbPath = process.env.SQLITE_PATH || "/data/wishlist.sqlite";
if (!inputPath) throw new Error("IMPORT_FILE must point to a protected local export");
const sourceRevision = Number(process.env.SOURCE_REVISION);
const sourceUpdatedAt = process.env.SOURCE_UPDATED_AT;
if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0 || !sourceUpdatedAt || Number.isNaN(Date.parse(sourceUpdatedAt))) {
  throw new Error("Source revision and timestamp are required");
}

const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allowedSourceKeys = ["app","ver","exportedAt","items","optout"];
if (!source || source.app !== "wishlist" || source.ver !== 1 || Object.keys(source).some(key => !allowedSourceKeys.includes(key)) ||
    !Array.isArray(source.items) || source.items.length > 1000) throw new Error("Input is not a complete supported wishlist export");
const fields = ["id","type","title","status","priority","rating","note","cover","author","lang","platforms","created","updated"];
const items = source.items.map((raw, index) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid item at row ${index + 1}`);
  if (Object.keys(raw).length !== fields.length || Object.keys(raw).some(key => !fields.includes(key))) throw new Error(`Unexpected or missing field at row ${index + 1}`);
  const item = Object.fromEntries(fields.map(key => [key, raw[key]]));
  for (const k of ["id","type","title","status","note","cover","author","lang"]) {
    if (typeof item[k] !== "string") throw new Error(`Invalid ${k} at row ${index + 1}`);
  }
  if (!item.id || !item.type || !item.title.trim() || item.id.length > 160 || item.title.length > 300 || item.type.length > 40 ||
      !["want","doing","done","dropped"].includes(item.status) || item.note.length > 20000 || item.cover.length > 4 * 1024 * 1024 || item.author.length > 300 || item.lang.length > 80) {
    throw new Error(`Out-of-range field at row ${index + 1}`);
  }
  if (item.cover && !/^https?:\/\//i.test(item.cover) && !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(item.cover)) throw new Error(`Invalid cover format at row ${index + 1}`);
  for (const k of ["priority","rating"]) if (!Number.isInteger(item[k]) || item[k] < 0 || item[k] > 9) throw new Error(`Invalid ${k} at row ${index + 1}`);
  if (!Array.isArray(item.platforms) || item.platforms.length > 30 || item.platforms.some(x => typeof x !== "string" || x.length > 40)) throw new Error(`Invalid platforms at row ${index + 1}`);
  for (const k of ["created","updated"]) if (!Number.isSafeInteger(item[k]) || item[k] <= 0) throw new Error(`Invalid ${k} at row ${index + 1}`);
  return item;
}).sort((a,b) => a.id.localeCompare(b.id));
if (new Set(items.map(x => x.id)).size !== items.length) throw new Error("Duplicate item IDs in source export");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceDigest = digest(items);

fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath, { timeout: 5000 });
try { fs.chmodSync(dbPath, 0o600); } catch {}
const existing = db.prepare("SELECT COUNT(*) AS n FROM wishlist_items").get();
if (Number(existing.n) !== 0) throw new Error("Refusing to import into a non-empty wishlist database");
const state = db.prepare("SELECT revision,updated_at FROM app_state WHERE id=1").get();
if (Number(state.revision) !== 0 || Number(existing.n) !== 0) throw new Error("Refusing to overwrite initialized canonical state");

if (!Array.isArray(source.optout) || source.optout.length > 2000 || source.optout.some(x => typeof x !== "string" || x.length > 300)) {
  throw new Error("Cover preferences are missing or invalid; refusing lossy import");
}
const optout = source.optout.slice();
db.exec("BEGIN IMMEDIATE");
try {
  const insert = db.prepare(`INSERT INTO wishlist_items
    (id,type,title,status,priority,rating,note,cover,author,lang,platforms_json,created,updated)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const x of items) insert.run(x.id,x.type,x.title,x.status,x.priority,x.rating,x.note,x.cover,x.author,x.lang,JSON.stringify(x.platforms),x.created,x.updated);
  db.prepare("UPDATE app_state SET revision=?,updated_at=?,optout_json=?,pending_delete_json=NULL WHERE id=1")
    .run(sourceRevision,sourceUpdatedAt,JSON.stringify(optout));
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); throw error; }

const reread = db.prepare(`SELECT id,type,title,status,priority,rating,note,cover,author,lang,platforms_json,created,updated FROM wishlist_items ORDER BY id`).all()
  .map(r => ({id:r.id,type:r.type,title:r.title,status:r.status,priority:Number(r.priority),rating:Number(r.rating),note:r.note,cover:r.cover,author:r.author,lang:r.lang,platforms:JSON.parse(r.platforms_json),created:Number(r.created),updated:Number(r.updated)}));
const targetDigest = digest(reread);
const finalState = db.prepare("SELECT revision,updated_at,optout_json FROM app_state WHERE id=1").get();
db.close();
if (targetDigest !== sourceDigest || Number(finalState.revision) !== sourceRevision || finalState.updated_at !== sourceUpdatedAt || JSON.stringify(JSON.parse(finalState.optout_json)) !== JSON.stringify(optout)) throw new Error("Post-import verification failed");
console.log(JSON.stringify({ok:true,count:items.length,sourceSha256:sourceDigest,targetSha256:targetDigest,revision:sourceRevision,updatedAt:sourceUpdatedAt}));
