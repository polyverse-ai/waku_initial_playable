type Lang = "en" | "zh";
type Dictionary = Record<string, string>;
type Listener = (lang: Lang) => void;

const SUPPORTED: Lang[] = ["en", "zh"];
const FALLBACK: Lang = "en";

let current: Lang = FALLBACK;
let dict: Dictionary = {};
let fallbackDict: Dictionary = {};
const listeners = new Set<Listener>();

function normalize(tag: string | undefined | null): Lang | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) return "zh";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  return null;
}

function detect(): Lang {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of candidates) {
    const normalized = normalize(tag);
    if (normalized && SUPPORTED.includes(normalized)) return normalized;
  }
  return FALLBACK;
}

async function load(lang: Lang): Promise<Dictionary> {
  const response = await fetch(new URL(`locales/${lang}.json`, document.baseURI));
  if (!response.ok) throw new Error(`locale ${lang} missing`);
  return response.json() as Promise<Dictionary>;
}

export async function initI18n() {
  fallbackDict = await load(FALLBACK);
  current = detect();
  dict = current === FALLBACK ? fallbackDict : await load(current).catch(() => fallbackDict);
  document.documentElement.setAttribute("lang", current);
  return current;
}

export async function setLang(lang: Lang) {
  if (!SUPPORTED.includes(lang) || lang === current) return;
  dict = lang === FALLBACK ? fallbackDict : await load(lang).catch(() => fallbackDict);
  current = lang;
  document.documentElement.setAttribute("lang", current);
  listeners.forEach((fn) => fn(lang));
}

export function getLang() {
  return current;
}

export function t(key: string) {
  return dict[key] ?? fallbackDict[key] ?? key;
}

export function onLangChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
