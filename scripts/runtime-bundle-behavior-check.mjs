import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundleSource = readFileSync(
  join(root, "static/vendor/polyverse-content-runtime.min.js"),
  "utf8",
);

function loadRuntime() {
  const sandbox = {
    clearTimeout,
    console,
    Response,
    setTimeout,
    URLSearchParams,
    window: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bundleSource, sandbox);
  return sandbox.PolyverseContentRuntime;
}

function bridgeWindow(posted) {
  return {
    webkit: {
      messageHandlers: {
        polyverse: {
          postMessage(message) {
            posted.push(message);
          },
        },
      },
    },
  };
}

function bridgeClient(capabilities) {
  const runtime = loadRuntime();
  const posted = [];
  const windowRef = bridgeWindow(posted);
  const manifest = { capabilities };
  const transport = new runtime.BridgeTransport({
    manifest,
    timeoutMs: 1_000,
    windowRef,
  });
  const client = new runtime.PolyverseClient(transport, { manifest });
  return { client, posted, windowRef };
}

async function assertMediaCall({ api, capability, input, media }) {
  const { client, posted, windowRef } = bridgeClient([capability]);
  const pending = client.media[api](input);

  assert.equal(posted.length, 1);
  assert.equal(posted[0].method, capability);
  windowRef.Polyverse.__resolveBridgeCall({
    type: "polyverse.response",
    protocol: "polyverse-runtime/1",
    id: posted[0].id,
    ok: true,
    result: media,
  });

  const result = await pending;
  assert.equal(result.supported, true);
  assert.equal(result.source, "host");
  assert.equal(result.media.assetId, media.assetId);
  assert.equal(result.media.mimeType, media.mimeType);
}

async function assertBatteryCall() {
  const { client, posted, windowRef } = bridgeClient(["device.battery.read"]);
  const pending = client.device.getBattery();

  assert.equal(posted.length, 1);
  assert.equal(posted[0].method, "device.battery.read");
  windowRef.Polyverse.__resolveBridgeCall({
    type: "polyverse.response",
    protocol: "polyverse-runtime/1",
    id: posted[0].id,
    ok: true,
    result: { level: 0.8, state: "charging" },
  });

  const result = await pending;
  assert.equal(result.supported, true);
  assert.equal(result.source, "host");
  assert.equal(result.level, 0.8);
  assert.equal(result.state, "charging");
}

// This SDK build ships trace as an inert stub: the `pv.trace` namespace still
// exists (so content that calls it keeps working), but nothing is buffered and
// nothing is ever sent. This check pins that contract — if a future bundle
// starts actually emitting telemetry, this check goes red on purpose.
async function assertTraceIsInert() {
  const { client, posted, windowRef } = bridgeClient(["trace.write"]);

  client.trace.clear();
  client.trace.record({ type: "template.runtime.behavior_check" });
  assert.equal(client.trace.size(), 0, "trace.record must not buffer anything");

  // An explicit flush resolves as skipped rather than posting over the bridge.
  const flushResult = await client.trace.flush();
  assert.equal(flushResult.skipped, true, "trace.flush must report itself as skipped");
  assert.equal(posted.length, 0, "trace.flush must not post over the bridge");

  // A host background lifecycle event is still acknowledged, but must not
  // trigger a flush either.
  const hostResult = await windowRef.Polyverse.__hostEvent({
    type: "polyverse.hostEvent",
    protocol: "polyverse-runtime/1",
    id: "host_background_1",
    method: "host.lifecycle",
    params: { state: "background" },
  });

  assert.equal(hostResult.ok, true, "host.lifecycle must still be acknowledged");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posted.length, 0, "a host background event must not emit telemetry");
  assert.equal(client.trace.size(), 0);
}

const checks = [
  [
    "media.capture returns a host media envelope",
    () =>
      assertMediaCall({
        api: "capture",
        capability: "media.camera.capture",
        input: { kind: "photo", return: "asset" },
        media: {
          assetId: "uas_camera_1",
          url: "https://storage.example/camera.jpg",
          mimeType: "image/jpeg",
          bytes: 1_024,
          width: 100,
          height: 80,
        },
      }),
  ],
  [
    "media.pickPhoto returns a host media envelope",
    () =>
      assertMediaCall({
        api: "pickPhoto",
        capability: "media.photo.pick",
        media: {
          assetId: "uas_photo_1",
          url: "https://storage.example/photo.jpg",
          mimeType: "image/jpeg",
          bytes: 2_048,
        },
      }),
  ],
  [
    "media.pickVideo returns a host media envelope",
    () =>
      assertMediaCall({
        api: "pickVideo",
        capability: "media.video.pick",
        media: {
          assetId: "uas_video_1",
          url: "https://storage.example/video.mp4",
          mimeType: "video/mp4",
          bytes: 4_096,
          durationMs: 3_000,
        },
      }),
  ],
  [
    "media.recordAudio returns a host media envelope",
    () =>
      assertMediaCall({
        api: "recordAudio",
        capability: "media.microphone.record",
        input: { maxDurationMs: 6_000 },
        media: {
          assetId: "uas_audio_1",
          url: "https://storage.example/audio.m4a",
          mimeType: "audio/mp4",
          bytes: 2_676,
          durationMs: 6_000,
        },
      }),
  ],
  ["device.getBattery preserves the host battery result", assertBatteryCall],
  ["trace is an inert stub that never emits telemetry", assertTraceIsInert],
];

let failures = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`runtime bundle behavior failed: ${failures}/${checks.length} checks`);
  process.exitCode = 1;
} else {
  console.log(`runtime bundle behavior ok: ${checks.length}/${checks.length} checks`);
}
