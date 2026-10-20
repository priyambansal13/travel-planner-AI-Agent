/**
 * Small HTTP helpers shared by all external integrations:
 * timeouts, a polite User-Agent (required by OSM services) and an in-memory TTL cache.
 */
const cache = new Map<string, { expires: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** Hosts with strict usage policies get requests spaced out (Nominatim: max 1 req/s). */
const THROTTLE_MS: Record<string, number> = { 'nominatim.openstreetmap.org': 1100 };
const nextSlot = new Map<string, number>();

async function throttle(url: string) {
  const host = new URL(url).host;
  const gap = THROTTLE_MS[host];
  if (!gap) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + gap);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

const USER_AGENT = 'IndiaTravelPlanner/1.0 (LangGraph multi-agent demo)';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  ttlMs?: number;
}

async function request(url: string, opts: FetchOptions): Promise<Response> {
  const { timeoutMs = 12_000, ttlMs: _ttl, headers, ...init } = opts;
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${body.slice(0, 160)}`);
  }
  return res;
}

function cacheKey(url: string, opts: FetchOptions) {
  return `${opts.method ?? 'GET'} ${url} ${typeof opts.body === 'string' ? opts.body : ''}`;
}

async function cached<T>(url: string, opts: FetchOptions, read: (r: Response) => Promise<T>): Promise<T> {
  const key = cacheKey(url, opts);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  // Parallel agents often ask for the same thing (e.g. geocoding the destination) — share one request.
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    await throttle(url);
    const value = await read(await request(url, opts));
    cache.set(key, { value, expires: Date.now() + (opts.ttlMs ?? 15 * 60_000) });
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const fetchJson = <T = any>(url: string, opts: FetchOptions = {}) =>
  cached<T>(url, opts, (r) => r.json() as Promise<T>);

export const fetchText = (url: string, opts: FetchOptions = {}) => cached<string>(url, opts, (r) => r.text());

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  return sp.toString();
}
