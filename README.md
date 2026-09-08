# Polyverse Playable Template

A starter template for building **playables** — self-contained interactive
content that runs inside the Waku app. It is a static site (React + TypeScript +
Tailwind, built with Vite) that talks to the platform through the Polyverse
content runtime SDK.

Start from this template, replace the content surface, and ship.

## Quick start

```bash
npm ci        # install exactly the locked dependencies
npm run dev   # local dev server with hot reload
npm test      # typecheck + contract checks + production build verification
npm run build # production build into public/
npm run verify # npm test, plus a headless browser smoke test of the build
```

`npm test` is the gate to keep green while you work. It runs `tsc --noEmit`, the
runtime contract check, the SDK bundle behavior check, a real production build,
and the built-asset path checks.

`npm run verify` additionally loads the built output in a headless mobile
viewport and fails on objectively broken results (white screen, collapsed
layout, zero-size canvas, uncaught page errors, a stuck state machine). It needs
[Playwright](https://playwright.dev) installed; if Playwright is not available
it skips that stage and exits cleanly rather than failing.

## Working with an AI assistant

The project ships `CLAUDE.md` and `AGENTS.md`; Claude Code and Codex read
them on startup, so an assistant launched in this folder already knows it is
building a Waku playable, where the code goes, and how to preview and publish
it. Install `wakukit` first (the CLI plus the `wakukit` skill the assistant
follows):

```bash
curl -fsSL https://storage.googleapis.com/polyverse-wakukit-releases/install-wakukit.sh | bash
```

Then just say what you want to make — "make a balloon-popping game" is enough;
the assistant does not need the platform explained.

## Need help? / 求助

Post in this repository's GitHub Discussions: <https://github.com/polyverse-ai/waku_initial_playable/discussions>.
Include the output of `wakukit --version`, the full command you ran together
with its full output, and your operating system. Section 7 of the getting-started
guide covers the common failures, so check it first —
[中文](https://storage.googleapis.com/polyverse-wakukit-releases/docs/wakukit-getting-started.zh.md) /
[English](https://storage.googleapis.com/polyverse-wakukit-releases/docs/wakukit-getting-started.en.md).

有问题就到本仓的 GitHub Discussions 发帖：<https://github.com/polyverse-ai/waku_initial_playable/discussions>。
帖子里附上 `wakukit --version` 的输出、你运行的完整命令与完整输出、以及你的系统。
常见卡点先看新手入门指南第 7 节——[中文](https://storage.googleapis.com/polyverse-wakukit-releases/docs/wakukit-getting-started.zh.md) /
[English](https://storage.googleapis.com/polyverse-wakukit-releases/docs/wakukit-getting-started.en.md)。

## Layout

| Path                 | What it is                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/content/Content.tsx` | **Your starting point.** The near-blank content surface — write your playable here.                                     |
| `src/waku/`          | Platform floor: runtime handshake, host lifecycle, safe-area/z-layer primitives, audio lifecycle. **Don't edit.** Import from `src/waku` only. |
| `src/lib/`           | Shell helpers: uniform viewport scaling for the host's shrunk card/edit frames (`viewport-scale.ts`, wired in `main.tsx`) and an opt-in media preloader (`preload.ts`, not imported by default). |
| `src/App.tsx`, `src/main.tsx`, `src/index.css` | App shell and the platform layer classes. Edit sparingly.                                                 |
| `recipes/`           | Optional, unwired reference material — an example playable and a reusable toolkit. Nothing here is imported by the app; copy or import what you need, delete what you don't. |
| `static/`            | Copied verbatim into the build output. Holds `static/vendor/` and `static/locales/`.                                        |
| `static/vendor/`     | The platform SDK bundle. **Don't hand-edit** — it is replaced wholesale on SDK updates, and the contract checks read it as the source of truth for the capability vocabulary. |
| `scripts/`           | The checks behind `npm test` and `npm run verify`.                                                                          |
| `index.html`         | Page shell, the content manifest, and the capability reference.                                                             |
| `public/`            | Build output. Generated, git-ignored — never edit by hand.                                                                  |

### The content surface

`Content` receives an `active` prop that is true only while the host says the
playable is running. Keep the pattern in the starter file:

- Boot renders a **static first frame** with zero running side effects — no rAF,
  timers, sensors, audio, or network on mount.
- Every loop is **gated on `active`**; nothing runs while the content is ready or
  paused.
- On pause, cancel loops and release heavy buffers. A backgrounded playable
  should cost nothing.

This is not a style preference: the host freezes idle content, and a playable
that burns CPU or leaks audio in the background will be visibly wrong.

## Declaring capabilities

`index.html` contains two script blocks.

**The manifest** (`type="application/polyverse-manifest"`) is live configuration.
Its `capabilities` array is what the platform actually grants:

```html
<script type="application/polyverse-manifest">
  {
    "name": "Minimal Playable",
    "runtime": "@polyverse/content-runtime@1",
    "capabilities": []
  }
</script>
```

**The capability reference** (`id="polyverse-capability-reference"`) is
documentation only — it is marked `data-reference-only="true"` and is never read
at runtime. It lists every capability the SDK knows, what each one is for, and
which SDK call it maps to. Read it to find the capability you need; don't copy
it into the manifest.

Rules:

- **Declare only what you actually call.** An empty array is the correct
  starting point: it grants the **free default set** — the platform's default
  set minus every paid capability. Save points, player files, leaderboards and
  comment composing all work with an empty manifest.
- **Paid capabilities are never granted by an empty manifest.** They cost real
  money on every call, so the platform grants them only when the manifest names
  them: `llm.chat`, `llm.chat.vision`, `multimodal.generate.image`,
  `multimodal.generate.video`, `multimodal.generate.audio`,
  `multimodal.transcribe.audio`, `assets.write`, the realtime model streams
  (`realtime.tts`, `realtime.image`, `realtime.voice`), and `server.invoke`.
  Calling one you did not declare fails with `403 capability_denied` — an empty
  array is **not** enough for, say, `pv.llm.chat`.
- **A non-empty array replaces the set; it does not add to it.** The moment the
  array is non-empty you get exactly what you listed and nothing more — the free
  defaults are gone too, so list the free capabilities you still call as well.
- Add a capability the moment your code calls the matching SDK method, and not
  before.
- A capability id that is not in the reference will fail `npm test`.
- Capabilities that run as asynchronous jobs (image/video/audio generation,
  transcription, vision chat) must also declare `multimodal.jobs.read`. This is
  checked.
- Some entries list an `alsoDeclare` array — declare those alongside.

Reach the SDK through the floor rather than touching the global directly:

```ts
import { readyWakuRuntime } from "./waku";

const pv = await readyWakuRuntime();
```

`readyWakuRuntime()` wraps the `window.Polyverse.ready()` handshake and gives you
a typed client.

For multiplayer, declare `realtime.connect`, then join an ordered or lockstep
room with `pv.realtime.connect({ mode, profileId, room })`. The platform owns
identity, tickets, room membership, ordering, and reconnect; the playable owns
its game rules and rendering.

## Publishing

Publishing goes through the `wakukit` CLI. Build first — `publish` uploads bytes
and never builds for you — then run these three steps from the project root:

```bash
# 1. build into public/
npm run build

# 2. read-only check: can this project run as a playable?
wakukit doctor .

# 3. first publish — private, so only you can see it
wakukit publish --name "My Playable" \
  --site-dir ./public --source-dir . --visibility private
```

`--visibility private` on the first publish is deliberate. A private playable is
one you can create the first release for yourself (`wakukit promote`), which is
what a playable with a `server/` backend needs before its backend calls will run
at all. Publish it public straight away and that first release is not yours to
make. Keep the `project_id` the receipt prints — you need it to republish this
same playable rather than create a second one.

When your own testing passes, republish it as public:

```bash
npm run build
wakukit publish --project-id <project_id> \
  --site-dir ./public --source-dir . --visibility public
```

Visibility is the only thing `--visibility` changes, and omitting it keeps
whatever the playable has now — republishing never flips visibility on its own.
Going public makes the playable eligible for the public feed; it appears there
once platform review has passed.

Installing `wakukit` is covered in [Working with an AI assistant](#working-with-an-ai-assistant).
`wakukit --help` lists every command; `wakukit <command> --help` is the source of
truth for its options.

## License

Proprietary and source-available to Polyverse partners under a partner
agreement. See [LICENSE](./LICENSE).
