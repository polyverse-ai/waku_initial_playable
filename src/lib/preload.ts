// Content preloader that prioritizes video. GCS-hosted videos are the slowest,
// heaviest asset a playable references, so when content loads we warm them FIRST
// (detached <video preload="auto">, which fills the HTTP cache without needing
// CORS), then images. preload() never rejects — a cold/broken asset can't
// white-screen the app; it just resolves once everything has settled.

interface PreloadOptions {
  videos?: string[]; // warmed first, in order
  images?: string[]; // warmed after videos
  videoTimeoutMs?: number; // stop waiting on one video (default 10000)
  onProgress?: (done: number, total: number) => void;
}

const warmed = new Set<string>(); // dedupe across calls
const pinned: HTMLVideoElement[] = []; // hold refs so GC can't drop mid-load

function warmVideo(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    pinned.push(v);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      const i = pinned.indexOf(v);
      if (i >= 0) pinned.splice(i, 1);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    // canplaythrough = enough buffered to play start-to-end; loadeddata is the
    // weaker "first frame ready" signal we accept as good enough to fade in.
    v.addEventListener("canplaythrough", finish, { once: true });
    v.addEventListener("loadeddata", finish, { once: true });
    v.addEventListener("error", finish, { once: true });
    v.load();
  });
}

function warmImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

// Prioritized warm-up: videos first (in parallel), then images. Resolves when
// all assets have buffered, errored, or timed out.
export async function preloadAssets(opts: PreloadOptions): Promise<void> {
  const videos = (opts.videos ?? []).filter((u) => u && !warmed.has(u));
  const images = (opts.images ?? []).filter((u) => u && !warmed.has(u));
  [...videos, ...images].forEach((u) => warmed.add(u));
  const total = videos.length + images.length;
  if (!total) return;
  let done = 0;
  const tick = () => opts.onProgress?.(++done, total);
  const timeout = opts.videoTimeoutMs ?? 10000;
  // Kick videos first so their requests hit the network before images compete.
  const videoJobs = videos.map((u) => warmVideo(u, timeout).then(tick));
  const imageJobs = images.map((u) => warmImage(u).then(tick));
  await Promise.all([...videoJobs, ...imageJobs]);
}

// Convenience for the common case: just warm a list of GCS videos.
export function preloadVideos(urls: string[], timeoutMs?: number): Promise<void> {
  return preloadAssets({ videos: urls, videoTimeoutMs: timeoutMs });
}
