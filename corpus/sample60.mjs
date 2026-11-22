// Deterministic stratified sample of 60 NEW findings (excluding the 30 hand-read in PD1): node corpus/sample60.mjs [--src]
// Reads corpus/reports/*.json (regenerate with corpus/run.sh first).
import { readFileSync } from "node:fs";
const OLD = new Set(`libuv src/unix/core.c:98|libuv src/unix/linux.c:2554|libuv src/unix/random-sysctl-linux.c:71|libuv src/unix/os390-syscalls.c:165|libuv src/unix/linux.c:1687|libuv include/uv/unix.h:427|libuv src/unix/pipe.c:127|libuv test/task.h:429|dropbear src/dbutil.c:761|dropbear src/dbrandom.c:281|dropbear libtomcrypt/makefile.mingw:19|dropbear src/netio.c:622|dropbear src/dbrandom.c:270|dropbear src/netio.c:245|iperf src/flowlabel.h:31|iperf src/iperf_api.c:5566|iperf src/iperf_api.c:5631|iperf src/net.c:788|iperf src/main.c:86|iperf src/tcp_info.c:138|libev ev.c:389|libev ev.c:4340|libev ev_epoll.c:105|libev ev_epoll.c:218|libev ev.c:435|libev ev.c:2598|cJSON Makefile:15|cJSON tests/unity/extras/fixture/test/Makefile:3|lua makefile:80|kilo kilo.c:37`.split("|"));
const plan = { libuv: 18, dropbear: 12, iperf: 10, libev: 10, cJSON: 7, lua: 3 };
const out = [];
for (const [name, n] of Object.entries(plan)) {
  const r = JSON.parse(readFileSync(new URL(`./reports/${name}.json`, import.meta.url)));
  const pool = r.findings.filter((f) => !OLD.has(`${name} ${f.file}:${f.line}`));
  if (pool.length < n) throw new Error(`${name}: only ${pool.length} eligible`);
  const stride = pool.length / n;
  for (let k = 0; k < n; k++) {
    const f = pool[Math.floor(stride * k + stride / 2)];
    const ctx = f.context.filter((c) => Math.abs(c.n - f.line) <= 1).map((c) => `${c.n === f.line ? ">" : " "}${c.n}: ${c.text.trim().slice(0, 110)}`);
    out.push({ n: out.length + 1, project: name, loc: `${f.file}:${f.line}`, rule: f.ruleId.replace("QNX-", ""), guard: f.guard, guards: f.guards.join(" / "), ctx });
  }
}
if (out.length !== 60) throw new Error("expected 60, got " + out.length);
for (const o of out) console.log(`#${o.n} ${o.project} ${o.loc} [${o.rule}] guard=${o.guard}${o.guards ? " (" + o.guards + ")" : ""}\n${o.ctx.join("\n")}`);
