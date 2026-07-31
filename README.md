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

## Layout

| Path                 | What it is                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/content/Content.tsx` | **Your starting point.** The near-blank content surface — write your playable here.                                     |
| `src/waku/`          | Platform floor: runtime handshake, host lifecycle, safe-area/z-layer primitives, audio lifecycle. **Don't edit.** Import from `src/waku` only. |
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
  starting point, and it still gets the platform's default capability set — you
  do not need to declare anything to build a working playable.
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

## Publishing

Publishing instructions are provided with your partner onboarding.

## License

Proprietary and source-available to Polyverse partners under a partner
agreement. See [LICENSE](./LICENSE).
