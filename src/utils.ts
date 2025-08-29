export const deepClone = <T>(x: T): T => JSON.parse(JSON.stringify(x ?? {}));

export function getAtPath<T = any>(obj: any, path?: string): T {
  if (!path) return obj;
  return path.split(".").reduce((o: any, k: string) => (o && typeof o === "object" ? o[k] : undefined), obj) as T;
}

export function setAtPath(obj: any, path: string, value: any) {
  if (!path) return value;
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

export const joinPath = (root: string, sub: string) => {
  if (!root) return sub || "";
  if (!sub) return root;
  return `${root}.${sub}`;
};

export const parseCsvNumbers = (s: string) =>
  !s ? [] : s.split(",").map(x => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

export const toCsvNumbers = (arr: unknown) => Array.isArray(arr) ? (arr as any[]).join(", ") : "";

export const parseCsvText = (s: string) =>
  !s ? [] : s.split(",").map(x => x.trim()).filter(Boolean);

export const toCsvText = (arr: unknown) => Array.isArray(arr) ? (arr as any[]).join(", ") : "";

export function coerceScalar(type: string, raw: string | boolean) {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "checkbox") return !!raw;
  if (["date","time","datetime-local"].includes(type)) return raw || null;
  return raw ?? null;
}

// visibleIf evaluator
export function isVisible(visibleIf: any | undefined, stagedModel: any, bindPathForItem?: string) {
  if (!visibleIf) return true;
  const checkPath = bindPathForItem ? `${bindPathForItem}.${visibleIf.path}` : visibleIf.path;
  const val = getAtPath(stagedModel, checkPath);
  if (visibleIf.equals !== undefined) return val === visibleIf.equals;
  if (visibleIf.notEquals !== undefined) return val !== visibleIf.notEquals;
  if (visibleIf.contains !== undefined && typeof val === "string") return val.toLowerCase().includes(String(visibleIf.contains).toLowerCase());
  if (visibleIf.isTruthy) return !!val;
  if (visibleIf.isFalsy) return !val;
  return true;
}

