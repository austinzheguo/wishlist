import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";

const dbPath = process.env.SQLITE_PATH || "/data/wishlist.sqlite";
const backupDir = process.env.BACKUP_DIR || "/backups";
const keep = Number(process.env.BACKUP_KEEP || 14);
async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(".", "");
const finalPath = path.join(backupDir, `wishlist-${stamp}.sqlite`);
const tempPath = `${finalPath}.tmp`;
const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
try {
  const pages = await backup(db, tempPath, { rate: 64 });
  db.close();
  fs.chmodSync(tempPath, 0o600);
  const verify = new DatabaseSync(tempPath);
  const integrity = verify.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
  const count = Number(verify.prepare("SELECT COUNT(*) AS n FROM wishlist_items").get().n);
  const meta = verify.prepare("SELECT revision,updated_at FROM app_state WHERE id=1").get();
  verify.exec("PRAGMA journal_mode=DELETE");
  verify.close();
  const hash = await sha256File(tempPath);
  fs.renameSync(tempPath, finalPath);
  const files = fs.readdirSync(backupDir).filter(name => /^wishlist-\d{8}T\d{9}Z\.sqlite$/.test(name)).sort().reverse();
  for (const stale of files.slice(keep)) fs.unlinkSync(path.join(backupDir, stale));
  console.log(JSON.stringify({ok:true,rows:count,revision:Number(meta.revision),updatedAt:meta.updated_at,pages,sha256:hash,backupCount:Math.min(files.length,keep)}));
} catch (error) {
  try { db.close(); } catch {}
  try { fs.unlinkSync(tempPath); } catch {}
  throw error;
}
