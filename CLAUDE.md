# Waku playable — agent entry

This folder is a **Waku playable**: a self-contained, phone-first interactive piece (React + TypeScript + Tailwind, built by Vite into `public/`) that runs inside the Waku app on top of the Polyverse content runtime (`window.Polyverse`). It is not a generic web page, not an artifact, not a Node service. When the user says "make a small game" / 「帮我做个小游戏」, build it here, as this playable — no need to ask which stack or where.

## First: load the wakukit skill

- Read and follow `~/.claude/skills/wakukit/SKILL.md` (Claude Code) or `~/.codex/skills/wakukit/SKILL.md` (Codex). It is the source of truth for the runtime SDK, the capability rules and the `wakukit` CLI; open its `references/` only for the capability you actually need.
- If that file is missing, ask the user to install wakukit (CLI + skill) and continue once it is there:
  `curl -fsSL https://storage.googleapis.com/polyverse-wakukit-releases/install-wakukit.sh | bash`

## Where the code goes

- `src/content/Content.tsx` is the content surface: replace the starter screen there. `src/waku/` is the platform floor — import from it, never edit it. Touch `src/App.tsx` / `main.tsx` / `index.css` only for shell-level needs.
- Boot renders a static first frame with no running side effects; every loop (rAF, timers, audio, sensors) is gated on `active`.

## Build → preview loop

`npm run build` → output in `public/` → `wakukit simulator ./public` opens it in a local phone host. The simulator serves the build, so rebuild after every change. `npm test` must be green before you hand over.

## Publishing (private first, public after your own test)

```bash
wakukit publish --name "<name>" --site-dir ./public --source-dir . --visibility private   # also writes .waku/project.json
wakukit promote                                        # no argument inside this folder: it reads .waku/project.json
                                                       # (wakukit < 0.7.69: pass the name, `wakukit promote "<name>"`)
                                                       # your first release — still private, only you can open it
npm run build && wakukit publish --visibility public   # run in this folder = same playable, now public
wakukit promote                                        # again: the public snapshot is frozen until you point it at this version
```

## Hard rules

- Never modify `static/vendor/polyverse-content-runtime.min.js`; the platform expects it byte-for-byte.
- The manifest stays inline in `index.html` (`type="application/polyverse-manifest"`). Add a capability only when the page really calls the matching SDK method; the reference block in `index.html` maps calls to ids. Content that calls no SDK keeps `"capabilities": []`.
- Every asset is local — under `static/` or imported from `src/`. No CDN links, no remote fonts/images/scripts: the local simulator's CSP blocks them.
- Portrait phone first: keep the viewport meta, pointer/touch input (no hover-only or keyboard-only interaction), fluid widths, no page scroll.

## When you finish

Tell the user how to look at it (`npm run build && wakukit simulator ./public`) and that they can simply describe the next change.

---
中文摘要：这是 Waku playable 项目，不是普通网页或 artifact。先加载 `wakukit` skill（文件不存在就请用户运行上面的安装命令）；代码写在 `src/content/Content.tsx`，`src/waku/` 与 `static/vendor/` 不改；每次改完 `npm run build` → `wakukit simulator ./public` 预览；发布先 `--visibility private` 自测再公开；素材全部本地、manifest 只声明真正调用的能力、竖屏手机优先；做完告诉用户怎么预览。
