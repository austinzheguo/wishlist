import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_ITEMS = 1000;
const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie, Cf-Access-Jwt-Assertion"
};

function json(res, status, body) {
  res.writeHead(status, { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createApp({
  dbPath = process.env.SQLITE_PATH || "/data/wishlist.sqlite",
  publicOrigin = process.env.PUBLIC_ORIGIN || "https://wishlist.orbitspaces.top",
  accessTeamDomain = process.env.ACCESS_TEAM_DOMAIN || "",
  accessAudience = process.env.ACCESS_AUDIENCE || "",
  readOnly = process.env.READ_ONLY === "true",
  getJwks = null,
  htmlPath = path.join(HERE, "index.html")
} = {}) {
  process.umask(0o077);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try { fs.chmodSync(dbPath, 0o600); } catch {}
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS wishlist_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      note TEXT NOT NULL,
      cover TEXT NOT NULL,
      author TEXT NOT NULL,
      lang TEXT NOT NULL,
      platforms_json TEXT NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      optout_json TEXT NOT NULL,
      pending_delete_json TEXT
    );
    CREATE TABLE IF NOT EXISTS save_requests (
      request_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare(`INSERT OR IGNORE INTO app_state(id,revision,updated_at,optout_json,pending_delete_json)
    VALUES(1,0,?,'[]',NULL)`).run(new Date().toISOString());

  let jwksCache = null;
  let jwksExpiry = 0;

  async function loadJwks() {
    if (getJwks) return getJwks();
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(accessTeamDomain)) throw new Error("Access team domain is not configured");
    if (jwksCache && Date.now() < jwksExpiry) return jwksCache;
    const endpoint = `https://${accessTeamDomain}/cdn-cgi/access/certs`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error("Access signing keys unavailable");
    const value = await response.json();
    if (!Array.isArray(value.keys) || value.keys.length === 0) throw new Error("Access signing keys invalid");
    jwksCache = value.keys;
    jwksExpiry = Date.now() + 5 * 60 * 1000;
    return jwksCache;
  }

  async function authenticate(req) {
    const token = req.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length > 16384) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    const parts = token.split(".");
    if (parts.length !== 3) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    let header, claims;
    try { header = decodePart(parts[0]); claims = decodePart(parts[1]); }
    catch { throw Object.assign(new Error("Unauthorized"), { status: 401 }); }
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }
    let keys;
    try { keys = await loadJwks(); }
    catch { throw Object.assign(new Error("Authorization service unavailable"), { status: 503 }); }
    const jwk = keys.find(k => k.kid === header.kid && k.kty === "RSA" && (!k.use || k.use === "sig"));
    if (!jwk) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    let validSignature = false;
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      validSignature = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
    } catch { validSignature = false; }
    const now = Math.floor(Date.now() / 1000);
    const issuer = accessTeamDomain ? `https://${accessTeamDomain}` : "";
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!validSignature || !issuer || claims.iss !== issuer || !accessAudience || !audiences.includes(accessAudience) ||
        !Number.isFinite(claims.exp) || claims.exp <= now ||
        (Number.isFinite(claims.nbf) && claims.nbf > now) ||
        (Number.isFinite(claims.iat) && claims.iat > now + 60) || typeof claims.sub !== "string" || !claims.sub) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }
    return claims;
  }

  function requireSameOrigin(req) {
    if (req.headers.origin !== publicOrigin) throw Object.assign(new Error("Origin rejected"), { status: 403 });
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin") throw Object.assign(new Error("Cross-site request rejected"), { status: 403 });
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      throw Object.assign(new Error("JSON required"), { status: 415 });
    }
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large"), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
  }

  function cleanItem(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid item");
    const str = (key, max, fallback = "") => {
      const value = input[key] == null ? fallback : input[key];
      if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${key}`);
      return value;
    };
    const id = str("id", 160);
    const type = str("type", 40, "书");
    const title = str("title", 300).trim();
    const status = str("status", 20, "want");
    const note = str("note", 20000);
    const cover = str("cover", 4 * 1024 * 1024);
    const author = str("author", 300);
    const lang = str("lang", 80);
    if (!id || !title || !["want", "doing", "done", "dropped"].includes(status)) throw new Error("Invalid item fields");
    if (cover && !/^https?:\/\//i.test(cover) && !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(cover)) throw new Error("Invalid cover format");
    const priority = Number(input.priority ?? 0);
    const rating = Number(input.rating ?? 0);
    const created = Number(input.created);
    const updated = Number(input.updated);
    if (!Number.isInteger(priority) || priority < 0 || priority > 9 || !Number.isInteger(rating) || rating < 0 || rating > 9 ||
        !Number.isSafeInteger(created) || created < 0 || !Number.isSafeInteger(updated) || updated < 0) throw new Error("Invalid numeric fields");
    const platforms = input.platforms == null ? [] : input.platforms;
    if (!Array.isArray(platforms) || platforms.length > 30 || platforms.some(x => typeof x !== "string" || x.length > 40)) throw new Error("Invalid platforms");
    return { id, type, title, status, priority, rating, note, cover, author, lang, platforms: [...platforms], created, updated };
  }

  function readState({ includeItems = true } = {}) {
    const meta = db.prepare("SELECT revision,updated_at,optout_json,pending_delete_json FROM app_state WHERE id=1").get();
    let undo = meta.pending_delete_json ? JSON.parse(meta.pending_delete_json) : null;
    if (undo && (!Number.isFinite(undo.expiresAt) || undo.expiresAt <= Date.now())) {
      db.prepare("UPDATE app_state SET pending_delete_json=NULL WHERE id=1").run();
      undo = null;
    }
    const result = {
      revision: Number(meta.revision),
      updatedAt: meta.updated_at,
      optout: JSON.parse(meta.optout_json),
      pendingDeleteUndo: undo
    };
    if (includeItems) {
      result.items = db.prepare(`SELECT id,type,title,status,priority,rating,note,cover,author,lang,platforms_json,created,updated
        FROM wishlist_items ORDER BY updated DESC,id`).all().map(row => ({
          id: row.id, type: row.type, title: row.title, status: row.status, priority: row.priority,
          rating: row.rating, note: row.note, cover: row.cover, author: row.author, lang: row.lang,
          platforms: JSON.parse(row.platforms_json), created: Number(row.created), updated: Number(row.updated)
        }));
    }
    return result;
  }

  function validateSnapshot(input) {
    if (!input || !Array.isArray(input.items) || input.items.length > MAX_ITEMS) throw Object.assign(new Error("Invalid item list"), { status: 400 });
    let items;
    try { items = input.items.map(cleanItem); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    const ids = new Set(items.map(item => item.id));
    if (ids.size !== items.length) throw Object.assign(new Error("Duplicate item id"), { status: 400 });
    const optout = input.optout == null ? [] : input.optout;
    if (!Array.isArray(optout) || optout.length > 2000 || optout.some(x => typeof x !== "string" || x.length > 300)) {
      throw Object.assign(new Error("Invalid cover preferences"), { status: 400 });
    }
    let pendingDeleteUndo = input.pendingDeleteUndo ?? null;
    if (pendingDeleteUndo !== null) {
      try { pendingDeleteUndo = { item: cleanItem(pendingDeleteUndo.item), expiresAt: Number(pendingDeleteUndo.expiresAt) }; }
      catch (error) { throw Object.assign(error, { status: 400 }); }
      if (!Number.isSafeInteger(pendingDeleteUndo.expiresAt) || pendingDeleteUndo.expiresAt <= Date.now() ||
          pendingDeleteUndo.expiresAt > Date.now() + 60 * 1000 + 5000) pendingDeleteUndo = null;
    }
    return { items, optout: [...new Set(optout)], pendingDeleteUndo };
  }

  function saveSnapshot(input) {
    const expectedRevision = Number(input?.expectedRevision);
    const requestId = String(input?.requestId || "");
    if (!input || !input.snapshot || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[A-Za-z0-9_-]{16,120}$/.test(requestId)) {
      throw Object.assign(new Error("Invalid revision or request id"), { status: 400 });
    }
    const fingerprint = createHash("sha256").update(canonical({ expectedRevision, snapshot: input.snapshot })).digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = db.prepare("SELECT fingerprint,response_json FROM save_requests WHERE request_id=?").get(requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          db.exec("ROLLBACK");
          return { conflict: true, reason: "idempotency-key-reused", state: readState({ includeItems: false }) };
        }
        const result = JSON.parse(previous.response_json);
        db.exec("COMMIT");
        return { result };
      }
      const { items, optout, pendingDeleteUndo } = validateSnapshot(input.snapshot);
      const current = db.prepare("SELECT revision,updated_at FROM app_state WHERE id=1").get();
      if (expectedRevision !== Number(current.revision)) {
        db.exec("ROLLBACK");
        return { conflict: true, state: readState({ includeItems: false }) };
      }
      const revision = Number(current.revision) + 1;
      const updatedAt = new Date().toISOString();
      const insert = db.prepare(`INSERT INTO wishlist_items
        (id,type,title,status,priority,rating,note,cover,author,lang,platforms_json,created,updated)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      db.prepare("DELETE FROM wishlist_items").run();
      for (const item of items) insert.run(item.id,item.type,item.title,item.status,item.priority,item.rating,item.note,item.cover,item.author,item.lang,JSON.stringify(item.platforms),item.created,item.updated);
      db.prepare("UPDATE app_state SET revision=?,updated_at=?,optout_json=?,pending_delete_json=? WHERE id=1")
        .run(revision, updatedAt, JSON.stringify(optout), pendingDeleteUndo ? JSON.stringify(pendingDeleteUndo) : null);
      const result = { ok: true, revision, updatedAt };
      db.prepare("INSERT INTO save_requests(request_id,fingerprint,response_json,created_at) VALUES(?,?,?,?)")
        .run(requestId,fingerprint,JSON.stringify(result),Date.now());
      db.prepare("DELETE FROM save_requests WHERE created_at < ?").run(Date.now() - 30 * 24 * 60 * 60 * 1000);
      db.exec("COMMIT");
      return { result };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") return json(res, 200, { ok: true });
    try {
      const claims = await authenticate(req);
      if (req.method === "GET" && req.url === "/") {
        try {
          const nonce = randomBytes(18).toString("base64url");
          const body = fs.readFileSync(htmlPath, "utf8").replaceAll("__CSP_NONCE__", nonce);
          const csp = `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`;
          res.writeHead(200, { ...PRIVATE_HEADERS, "Content-Security-Policy": csp, "X-Frame-Options":"DENY", "Content-Type": "text/html; charset=utf-8" });
          return res.end(body);
        } catch { return json(res, 500, { error: "Application unavailable" }); }
      }
      if (!req.url?.startsWith("/api/")) return json(res, 404, { error: "Not found" });
      if (req.method === "GET" && req.url === "/api/session") return json(res, 200, { ok: true, expiresAt: Number(claims.exp) * 1000, readOnly });
      if (req.method === "GET" && req.url === "/api/data") return json(res, 200, readState());
      if (req.method === "POST" && req.url === "/api/save") {
        requireSameOrigin(req);
        if (readOnly) return json(res, 423, { error: "read-only-preview" });
        const body = await readJson(req);
        const outcome = saveSnapshot(body);
        if (outcome.conflict) return json(res, 409, { error: "conflict", reason: outcome.reason, revision: outcome.state.revision, updatedAt: outcome.state.updatedAt });
        return json(res, 200, outcome.result);
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status >= 500) console.error("request failed", req.method, req.url, status);
      return json(res, status, { error: status === 401 ? "unauthorized" : status === 503 ? "authorization-unavailable" : status < 500 ? "request-rejected" : "internal-error" });
    }
  });

  return { server, db };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, db } = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`wishlist-server listening on ${host}:${port}`));
  const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
