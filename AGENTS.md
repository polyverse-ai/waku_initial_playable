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

`npm run build` → output in `public/` → `wakukit simulator ./public` opens it in a local phone host (if `public/` is missing, it runs `npm run build` for you first). Or one command: `wakukit start .` installs dependencies (skipped when `node_modules/` exists), builds, and opens the preview — in this folder it never re-fetches the starter, because a `package.json` is already here. The simulator serves an existing `public/` as-is, so rebuild after every change. `npm test` must be green before you hand over.

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

Tell the user how to look at it — `npm run build && wakukit simulator ./public`, or the one-liner `wakukit start .` (installs what is missing, builds, opens the preview); `wakukit simulator ./public` on its own builds first when `public/` is missing and serves an existing `public/` as-is — and that they can simply describe the next change.

## When something is unclear or fails on the platform side

If a `wakukit` command fails, a publish / promote / review outcome is not what the user expected, or you are not sure how the platform behaves, do not guess — point the user to this repository's GitHub Discussions (https://github.com/polyverse-ai/waku_initial_playable/discussions) and ask them to include the output of `wakukit --version`, the full command they ran and its full output. Do not invent review times or platform process on the platform's behalf.

---
中文摘要：这是 Waku playable 项目，不是普通网页或 artifact。先加载 `wakukit` skill（文件不存在就请用户运行上面的安装命令）；代码写在 `src/content/Content.tsx`，`src/waku/` 与 `static/vendor/` 不改；每次改完 `npm run build` → `wakukit simulator ./public` 预览（`public/` 缺失时它会先自动 build；也可一条 `wakukit start .`：装依赖、打包、开预览）；发布先 `--visibility private` 自测再公开；素材全部本地、manifest 只声明真正调用的能力、竖屏手机优先；做完告诉用户怎么预览；平台侧报错或拿不准的地方不要猜，让用户去本仓 GitHub Discussions 发帖并附上 `wakukit --version`、完整命令与输出，不替平台猜审核时长或流程。
