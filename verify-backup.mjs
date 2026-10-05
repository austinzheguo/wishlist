import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2];
if (!file) throw new Error("Usage: node verify-backup.mjs <private-backup-file>");
async function sha256File(target) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}
const db = new DatabaseSync(file, { readOnly: true });
const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
const rows = Number(db.prepare("SELECT COUNT(*) AS n FROM wishlist_items").get().n);
const state = db.prepare("SELECT revision,updated_at FROM app_state WHERE id=1").get();
db.close();
if (integrity !== "ok") throw new Error("SQLite integrity check failed");
console.log(JSON.stringify({ok:true,rows,revision:Number(state.revision),updatedAt:state.updated_at,sha256:await sha256File(file)}));
