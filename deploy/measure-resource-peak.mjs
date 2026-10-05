import fs from "node:fs";
import { once } from "node:events";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
const { createApp } = await import("/app/server.mjs");

if (process.env.RESOURCE_TEST !== "1" || !fs.existsSync("/data/.wishlist-resource-benchmark")) {
  throw new Error("Refusing to run without an explicitly marked isolated database copy");
}
if (process.env.SQLITE_PATH !== "/data/wishlist.sqlite") throw new Error("Unexpected benchmark database path");

const digest = items => createHash("sha256").update(JSON.stringify(items)).digest("hex");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-resource-fixture", use: "sig", alg: "RS256" };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function syntheticToken() {
  const now = Math.floor(Date.now() / 1000);
  const content = `${b64({ alg: "RS256", kid: jwk.kid, typ: "JWT" })}.${b64({
    iss: "https://fixture.cloudflareaccess.com", aud: ["fixture-audience"], sub: "synthetic-resource-user",
    iat: now, exp: now + 300
  })}`;
  return `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
}

const { server, db } = createApp({
  dbPath: process.env.SQLITE_PATH,
  publicOrigin: "https://wishlist.example.test",
  accessTeamDomain: "fixture.cloudflareaccess.com",
  accessAudience: "fixture-audience",
  readOnly: false,
  getJwks: async () => [jwk]
});
let peakRss = process.memoryUsage.rss();
const monitor = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage.rss()); }, 5);
monitor.unref();
const readCgroup = name => {
  try { return fs.readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim(); }
  catch { return null; }
};
const cpuBefore = readCgroup("cpu.stat");
server.listen(3000, "127.0.0.1");
await once(server, "listening");

try {
  const auth = { "cf-access-jwt-assertion": syntheticToken() };
  const htmlResponse = await fetch("http://127.0.0.1:3000/", { headers: auth });
  if (!htmlResponse.ok) throw new Error("Authenticated HTML read failed");
  const htmlBytes = Buffer.byteLength(await htmlResponse.text());

  const beforeResponse = await fetch("http://127.0.0.1:3000/api/data", { headers: auth });
  if (!beforeResponse.ok) throw new Error("Authenticated data read failed");
  const before = await beforeResponse.json();
  if (before.items.length !== 57) throw new Error("Unexpected fixture row count");
  const beforeDigest = digest(before.items);
  const request = {
    expectedRevision: before.revision,
    requestId: "synthetic-resource-save-0001",
    snapshot: { items: before.items, optout: before.optout, pendingDeleteUndo: before.pendingDeleteUndo }
  };
  const saveResponse = await fetch("http://127.0.0.1:3000/api/save", {
    method: "POST",
    headers: { ...auth, Origin: "https://wishlist.example.test", "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!saveResponse.ok) throw new Error("Authenticated 57-row save failed");
  const saveResult = await saveResponse.json();
  const retryResponse = await fetch("http://127.0.0.1:3000/api/save", {
    method: "POST",
    headers: { ...auth, Origin: "https://wishlist.example.test", "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!retryResponse.ok || JSON.stringify(await retryResponse.json()) !== JSON.stringify(saveResult)) {
    throw new Error("Idempotent save retry failed");
  }

  const afterResponse = await fetch("http://127.0.0.1:3000/api/data", { headers: auth });
  if (!afterResponse.ok) throw new Error("Post-save readback failed");
  const after = await afterResponse.json();
  const afterDigest = digest(after.items);
  if (after.items.length !== 57 || beforeDigest !== afterDigest || after.revision !== saveResult.revision) {
    throw new Error("Post-save readback mismatch");
  }

  peakRss = Math.max(peakRss, process.memoryUsage.rss());
  const cpuAfter = readCgroup("cpu.stat");
  let cpuUsageUsec = null;
  try {
    const getUsage = value => Number(value.match(/^usage_usec (\d+)$/m)?.[1]);
    cpuUsageUsec = getUsage(cpuAfter) - getUsage(cpuBefore);
  } catch {}
  console.log(JSON.stringify({
    ok: true,
    rowsReadAndSaved: 57,
    revisionAdvanced: after.revision === before.revision + 1,
    itemDigestPreserved: beforeDigest === afterDigest,
    htmlBytes,
    requestBytes: Buffer.byteLength(JSON.stringify(request)),
    rssPeakBytes: peakRss,
    cgroupMemoryPeakBytes: readCgroup("memory.peak"),
    cgroupCpuUsageUsec: cpuUsageUsec
  }));
} finally {
  clearInterval(monitor);
  await new Promise(resolve => server.close(resolve));
  db.close();
}
