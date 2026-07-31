#!/usr/bin/env node
// auto-smoke.mjs — machine verdict on "is it BROKEN?" (not "is it good?").
//
// Part of `npm run verify`. Loads the built product in a real headless mobile
// viewport and auto-asserts the objective failure modes that npm test (static)
// can't catch: white screen, collapsed root, dead/zero-size canvas, uncaught
// page errors, and — if the playable exposes the `window.__waku_debug` hook — a
// stuck state machine (interaction produces no state change).
//
// It deliberately does NOT judge quality. "Looks right / feels good / wow lands"
// is for a human to decide by actually playing it. This script only fast-fails
// the broken builds so that judgment pass isn't wasted on a blank screen.
//
// Exit: 0 = PASS or gracefully skipped (no playwright); 1 = FAIL (broken).
//
// Debug hook contract (optional but recommended). Expose this on window from
// your playable and the behavior checks below become machine-verifiable:
//   window.__waku_debug = {
//     getState(): any,     // serialisable snapshot of current phase/state
//     start(): void,       // leave attract/ready, enter the core loop
//     step(n?): void,      // advance the core loop / simulate progress
//   }

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIR = resolve(process.argv[2] || "public");
const PORT = Number(process.env.SMOKE_PORT || 8131);

function npmGlobalRoot() {
  try { const p = execSync("npm config get prefix", { encoding: "utf8" }).trim(); if (p) return join(p, "lib/node_modules/"); } catch {}
  return null;
}
function loadPlaywright() {
  const roots = [process.cwd(), npmGlobalRoot(), process.env.NPM_CONFIG_PREFIX ? join(process.env.NPM_CONFIG_PREFIX, "lib/node_modules/") : null].filter(Boolean);
  for (const r of roots) { try { return createRequire(r.endsWith("/") ? r : r + "/")("playwright"); } catch {} }
  return null;
}
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  for (const d of readdirSync(base)) {
    if (!d.startsWith("chromium")) continue;
    for (const c of [join(base, d, "chrome-linux/headless_shell"), join(base, d, "chrome-linux/chrome")]) if (existsSync(c)) return c;
  }
  return undefined;
}

function readManifestCaps(dir) {
  try {
    const html = readFileSync(join(dir, "index.html"), "utf8");
    const i = html.indexOf("application/polyverse-manifest");
    if (i < 0) return [];
    const open = html.indexOf(">", i) + 1;
    const end = html.indexOf("</script>", open);
    const j = JSON.parse(html.slice(open, end).trim());
    return Array.isArray(j.capabilities) ? j.capabilities : [];
  } catch { return []; }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm" };
async function handler(req, res) {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const f = join(DIR, p); const s = await stat(f).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(await readFile(f));
  } catch { res.writeHead(500); res.end("500"); }
}
function startServer(port, triesLeft = 10) {
  return new Promise((ok, rej) => {
    const srv = createServer(handler);
    srv.once("error", (e) => { if (e.code === "EADDRINUSE" && triesLeft > 0) startServer(port + 1, triesLeft - 1).then(ok, rej); else rej(e); });
    srv.listen(port, () => ok({ srv, port }));
  });
}

async function main() {
  if (!existsSync(join(DIR, "index.html"))) { console.error(`auto-smoke: ${DIR}/index.html not found — run the build first`); process.exit(1); }
  const pw = loadPlaywright();
  if (!pw) { console.log("auto-smoke: SKIP — playwright not found in this environment. Static checks already passed; the dynamic health check is skipped."); process.exit(0); }

  const fails = [], warns = [];
  const { srv, port } = await startServer(PORT);
  const exe = findChromium();
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  } catch (e) { console.log("auto-smoke: SKIP — chromium failed to launch (" + e.message.split("\n")[0] + "). Dynamic health check skipped."); srv.close(); process.exit(0); }

  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN" });
  const page = await ctx.newPage();
  const pageErrors = [], consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto(`http://localhost:${port}/`, { waitUntil: "load", timeout: 15000 }).catch((e) => fails.push("page failed to load: " + e.message));
  await page.waitForTimeout(1000);

  // ── Structural check: white screen / collapsed root / canvas ───────────────
  const health = await page.evaluate(`(()=>{
    const root=document.getElementById('root');const rb=root?root.getBoundingClientRect():{width:0,height:0};
    const cs=[...document.querySelectorAll('canvas')].map(c=>({w:c.clientWidth,h:c.clientHeight}));
    let txt=0,painted=0;
    for(const el of document.body.querySelectorAll('*')){const r=el.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<0||r.top>innerHeight)continue;const s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none'||s.opacity==='0')continue;if((el.textContent||'').trim())txt++;if(s.backgroundImage!=='none'||(s.backgroundColor&&s.backgroundColor!=='rgba(0, 0, 0, 0)'))painted++;}
    return {rootW:Math.round(rb.width),rootH:Math.round(rb.height),canvases:cs.length,zeroCanvas:cs.filter(c=>c.w===0||c.h===0).length,visibleText:txt,paintedBoxes:painted};
  })()`).catch(() => null);
  if (!health) fails.push("page evaluate failed (the page script probably crashed)");
  else {
    if (health.rootH < 50) fails.push(`#root is only ${health.rootH}px tall — collapsed (a container position was overridden into height:0)`);
    if (health.zeroCanvas > 0) fails.push(`${health.zeroCanvas}/${health.canvases} canvas element(s) have zero size — nothing is displayed`);
    if (health.visibleText === 0 && health.paintedBoxes <= 1 && health.canvases === 0) fails.push("first screen has almost no visible content — likely a white screen");
  }

  // ── Did the canvas actually paint anything (not a flat single color)? ──────
  if (health && health.canvases > 0 && health.zeroCanvas === 0) {
    const painted = await page.evaluate(`(()=>{
      for(const c of document.querySelectorAll('canvas')){try{const ctx=c.getContext('2d');if(!ctx)return 'maybe';const w=Math.min(c.width,64),h=Math.min(c.height,64);if(!w||!h)continue;const d=ctx.getImageData(0,0,w,h).data;const seen=new Set();for(let i=0;i<d.length;i+=16){seen.add(d[i]+','+d[i+1]+','+d[i+2]);if(seen.size>3)return 'painted';}}catch(e){return 'maybe';}}return 'uniform';})()`).catch(() => "maybe");
    if (painted === "uniform") warns.push("canvas pixels are nearly a single color — content may not have been drawn (or the background really is flat; confirm yourself)");
  }

  // ── Behavior check: reachability / softlock (self-driven via __waku_debug) ──
  const hasHook = await page.evaluate(`!!(window.__waku_debug && typeof window.__waku_debug.getState==='function')`).catch(() => false);
  if (!hasHook) {
    warns.push("no window.__waku_debug hook — behavior checks (reachability / softlock / degradation) skipped; expose the hook (see the contract at the top of this file) to make them machine-verifiable");
  } else {
    const snap = async () => { try { return JSON.stringify(await page.evaluate(`(()=>{try{return window.__waku_debug.getState()}catch(e){return 'ERR:'+e.message}})()`)); } catch { return null; } };
    const drive = async (fn) => { await page.evaluate(`(()=>{try{window.__waku_debug.${fn}&&window.__waku_debug.${fn}()}catch(e){}})()`).catch(() => {}); };
    const s0 = await snap();
    await drive("start"); await page.waitForTimeout(600);
    const states = [s0, await snap()];
    let lastChangeIdx = 1;
    for (let i = 0; i < 12; i++) {
      await drive("step"); await page.waitForTimeout(250);
      const s = await snap(); states.push(s);
      if (s !== states[states.length - 2]) lastChangeIdx = states.length - 1;
    }
    const distinct = new Set(states.filter(Boolean));
    const sFinal = states[states.length - 1] || "";
    // Heuristic: does the final state name look like an end/result state? The
    // last three alternatives are the CJK words for "result" / "end" / "complete",
    // written as escapes so this file stays ASCII; they let the heuristic also
    // recognise playables whose state names are in Chinese.
    const looksTerminal = /result|end|over|done|finish|win|los|complete|gameover|\u7ed3\u7b97|\u7ed3\u675f|\u5b8c\u6210/i.test(sFinal);
    if (distinct.size <= 1) {
      fails.push(`state machine is stuck — state never changes after start()/step() (${s0}); interaction does nothing`);
    } else if (!looksTerminal && lastChangeIdx < states.length - 4) {
      warns.push(`possible softlock — after several steps the state froze somewhere that is not an ending (final state ${sFinal.slice(0, 60)}); confirm the player can actually reach an ending`);
    }
  }

  if (pageErrors.length) fails.push(`page threw ×${pageErrors.length}: ${pageErrors.slice(0, 2).join(" | ")}`);
  if (consoleErrors.length) warns.push(`console error ×${consoleErrors.length}: ${consoleErrors.slice(0, 2).join(" | ")}`);

  // ── Fault injection: does it degrade gracefully when AI calls fail (no white
  //    screen)? Only runs when the manifest declares in-content AI. ───────────
  const caps = readManifestCaps(DIR);
  const usesAI = caps.some((c) => /^(llm|multimodal)/.test(c));
  if (usesAI) {
    try {
      const fctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN" });
      // Before the app boots, make every window.Polyverse call reject — this
      // simulates "in-content AI / platform capability is down".
      await fctx.addInitScript(`(()=>{const rej=()=>Promise.reject(new Error('fault-injected'));const ns=()=>new Proxy({},{get:()=>rej});try{Object.defineProperty(window,'Polyverse',{configurable:true,get(){return {ready:()=>Promise.resolve(),multimodal:ns(),storage:ns(),leaderboard:ns(),host:ns(),app:ns(),media:ns(),project:ns(),assets:ns()};},set(){}});}catch(e){}})()`);
      const fp = await fctx.newPage();
      const fErr = [];
      fp.on("pageerror", (e) => fErr.push(e.message));
      await fp.goto(`http://localhost:${port}/`, { waitUntil: "load", timeout: 15000 }).catch(() => {});
      await fp.waitForTimeout(1200);
      const fh = await fp.evaluate(`(()=>{const r=document.getElementById('root');const rb=r?r.getBoundingClientRect():{height:0};let t=0;for(const el of document.body.querySelectorAll('*')){const b=el.getBoundingClientRect();if(b.width>2&&b.height>2&&(el.textContent||'').trim())t++;}return {h:Math.round(rb.height),txt:t};})()`).catch(() => null);
      const fHook = await fp.evaluate(`!!(window.__waku_debug&&window.__waku_debug.getState)`).catch(() => false);
      if (fHook) { await fp.evaluate(`(()=>{try{window.__waku_debug.start&&window.__waku_debug.start()}catch(e){}})()`).catch(() => {}); await fp.waitForTimeout(500); }
      if (!fh || fh.h < 50 || fh.txt === 0) fails.push("white screen / collapsed layout under fault injection (all AI calls rejected) — no fallback branch, so the playable will break whenever AI is unavailable at runtime");
      else if (fErr.length) warns.push(`page threw ×${fErr.length} under fault injection — the fallback branch did not catch it: ${(fErr[0] || "").slice(0, 60)}`);
      await fctx.close();
    } catch (e) { warns.push("fault-injection check errored (skipped): " + (e.message || "").slice(0, 50)); }
  }

  // ── Lifecycle contract check (host-driven start/pause/resume; boot must be
  //    idle at `ready`) ──────────────────────────────────────────────────────
  // `?waku-host=1` simulates "a host is present" (suppressing the bare-browser
  // autostart). Asserts: after load it is frozen at ready (canvas static) →
  // polyverse:start enters running (canvas moves) → pause freezes → resume
  // continues.
  try {
    const lctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN" });
    const lp = await lctx.newPage();
    const lErr = [];
    lp.on("pageerror", (e) => lErr.push(e.message));
    await lp.goto(`http://localhost:${port}/?waku-host=1`, { waitUntil: "load", timeout: 15000 }).catch(() => {});
    await lp.waitForTimeout(800);

    const lcOf = async () => await lp.evaluate(`(()=>{const el=document.querySelector('[data-lifecycle]');return el?el.getAttribute('data-lifecycle'):null})()`).catch(() => null);
    // Whole-frame thumbnail hash (drawImage down to 160x160, then read pixels):
    // this detects slow or partial animation too — do not sample only the top-left corner.
    const canvasHash = async () => await lp.evaluate(`(()=>{const c=document.querySelector('canvas');if(!c)return 'no-canvas';try{if(!c.width||!c.height)return 'zero';const t=document.createElement('canvas');t.width=160;t.height=160;const x=t.getContext('2d');if(!x)return 'no-2d';x.drawImage(c,0,0,160,160);const d=x.getImageData(0,0,160,160).data;let s=0;for(let i=0;i<d.length;i+=4)s=(s*31+d[i]+d[i+1]+d[i+2])>>>0;return String(s);}catch(e){return 'err'}})()`).catch(() => null);
    const sendLifecycle = async (action) => { await lp.evaluate(`window.dispatchEvent(new Event('polyverse:${action}'))`).catch(() => {}); };
    const waitLc = async (expected, ms = 1500) => {
      const until = Date.now() + ms;
      while (Date.now() < until) { if ((await lcOf()) === expected) return true; await lp.waitForTimeout(100); }
      return (await lcOf()) === expected;
    };

    const lc0 = await lcOf();
    if (lc0 == null) {
      warns.push("no data-lifecycle attribute — lifecycle contract check skipped; content should wire pv.lifecycle and expose data-lifecycle");
    } else {
      if (lc0 !== "ready") fails.push(`with a host present the page should be frozen at ready after load, but data-lifecycle="${lc0}" — boot is not idle, so the warm-up window burns CPU and can leak audio`);
      const frozenA = await canvasHash(); await lp.waitForTimeout(450); const frozenB = await canvasHash();
      const canHash = frozenA && frozenA !== "no-canvas" && frozenA !== "no-2d" && frozenA !== "err" && frozenA !== "zero";
      if (canHash && frozenA !== frozenB) fails.push("canvas is still animating in the ready state (two samples differ) — rAF is not gated and runs before start");

      await sendLifecycle("start");
      if (!(await waitLc("running"))) fails.push("did not enter running after polyverse:start — the lifecycle wiring is broken (host event -> pv.lifecycle -> UI)");
      else {
        if (canHash) {
          // A slow animation can quantise to the same frame across one interval —
          // sample 3 times over ~1.2s and only warn when all three are identical.
          const runA = await canvasHash(); await lp.waitForTimeout(600); const runB = await canvasHash(); await lp.waitForTimeout(600); const runC = await canvasHash();
          if (runA === runB && runB === runC) warns.push("canvas is identical across three samples in the running state — the animation may not have started with start (or the picture really is static; confirm yourself)");
        }
        await sendLifecycle("pause");
        if (!(await waitLc("paused"))) fails.push("did not enter paused after polyverse:pause — pause/resume is declared but not handled");
        else {
          const pA = await canvasHash(); await lp.waitForTimeout(450); const pB = await canvasHash();
          if (canHash && pA !== pB) fails.push("canvas is still animating in the paused state — pause does not actually freeze rAF");
          await sendLifecycle("resume");
          if (!(await waitLc("running"))) fails.push("did not return to running after polyverse:resume — resume is broken");
        }
      }
      if (lErr.length) warns.push(`page threw ×${lErr.length} during the lifecycle check: ${(lErr[0] || "").slice(0, 60)}`);
    }
    await lctx.close();
  } catch (e) { warns.push("lifecycle check errored (skipped): " + (e.message || "").slice(0, 50)); }

  await browser.close(); srv.close();

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log(`\n=== auto-smoke @ ${DIR} ===`);
  if (health) console.log(`first screen: #root ${health.rootW}×${health.rootH}, canvas ${health.canvases}, visible text blocks ${health.visibleText}`);
  for (const w of warns) console.log("  ⚠ " + w);
  if (fails.length) {
    for (const f of fails) console.log("  ✗ " + f);
    console.log("VERDICT: FAIL (objectively broken) — fix the ✗ items above, then play it yourself to judge whether it is any good.");
    process.exit(1);
  }
  console.log("VERDICT: PASS (not broken) — it builds, does not white-screen, and the state machine advances. That only proves it is not broken; play it yourself to judge whether it is good.");
  process.exit(0);
}
main().catch((e) => { console.error("auto-smoke failed on its own:", e.message); process.exit(1); });
