import test from "node:test";
import assert from "node:assert/strict";
import { forwardRadarRequest } from "../lib/radar-gateway";
const config = { baseUrl: "https://science.example", secret: "test-secret", userId: "alice", publicOrigin: "https://earth.test" };
const request = (path: string, body: unknown, origin = config.publicOrigin) => new Request(`https://earth.test${path}`, { method: "POST", headers: { origin, "content-type":"application/json" }, body: JSON.stringify(body) });
test("analysis and annotation gateway preserves signed user, normalized input and private responses", async () => {
  for (const [suffix, body] of [["analysis", { point: [-114.745, 36.055] }], ["annotations", {label:"uncertain",note:"Surface changed; cause unverified."}]] as const) {
    const path = `/api/change-jobs/example/${suffix}`;
    const r = await forwardRadarRequest(request(path, body), path, config, async (url, init) => {
      assert.equal(String(url), `https://science.example${path}`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-Earthsignal-User"), "alice");
      assert.match(headers.get("X-Earthsignal-Signature")!, /^[a-f0-9]{64}$/);
      const value = JSON.parse(String(init?.body));
      if (suffix === "analysis") assert.equal(value.thresholdDb,3);
      return Response.json({ok:true});
    });
    assert.equal(r.status,200); assert.equal(r.headers.get("Cache-Control"),"private, no-store");
  }
});
test("analytics preserve auth/CSRF and reject unbounded or malformed inputs before science requests", async () => {
  const path = "/api/change-jobs/example/analysis";
  const noFetch:typeof fetch = async()=>{throw new Error("Must not reach science");};
  assert.equal((await forwardRadarRequest(request(path,{}),path,{...config,userId:null},noFetch)).status,401);
  assert.equal((await forwardRadarRequest(request(path,{},"https://evil.test"),path,config,noFetch)).status,403);
  for(const body of [{point:[181,0]}, {thresholdDb:0}, {thresholdDb:31}, {path:"/etc/passwd"}, {transect:[[0,0]]}]) assert.equal((await forwardRadarRequest(request(path,body),path,config,noFetch)).status,400);
  const notes="/api/change-jobs/example/annotations";
  for(const body of [{label:"verified-flood",note:"test"},{label:"uncertain",note:""},{label:"uncertain",note:"x".repeat(1001)}]) assert.equal((await forwardRadarRequest(request(notes,body),notes,config,noFetch)).status,400);
});
