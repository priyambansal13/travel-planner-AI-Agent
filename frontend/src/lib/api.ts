import type { Health, Trip } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  trips: () => get<Trip[]>('/trips'),
  trip: (id: string) => get<Trip>(`/trips/${id}`),
  health: () => get<Health>('/health'),
  deleteTrip: (id: string) => fetch(`${API_URL}/api/trips/${id}`, { method: 'DELETE' }),
  /** Stops the agents server-side, whichever channel started the run. */
  cancelRun: (threadId: string) => fetch(`${API_URL}/api/trips/${threadId}/cancel`, { method: 'POST' }).catch(() => undefined),
};

export const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', opts);
