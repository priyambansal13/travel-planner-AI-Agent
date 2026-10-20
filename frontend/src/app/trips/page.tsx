import { ArrowRight, MapPin } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { api, fmtDate } from '@/lib/api';

const STATUS: Record<string, string> = {
  ready: 'bg-emerald-100 text-emerald-700', planning: 'bg-blue-100 text-blue-700',
  needs_input: 'bg-amber-100 text-amber-700', awaiting_approval: 'bg-orange-100 text-orange-700', error: 'bg-rose-100 text-rose-700',
};

async function TripList() {
  let trips;
  try {
    trips = await api.trips();
  } catch {
    return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Could not reach the backend API.</p>;
  }
  if (!trips.length) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-500">
        No trips yet. <Link href="/" className="font-medium text-saffron-600 hover:underline">Plan your first one →</Link>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((t) => (
        <Link key={t.id} href={`/trips/${t.id}`} className="group rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-saffron-400 hover:shadow">
          <div className="flex items-center justify-between">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[t.status] ?? ''}`}>{t.status.replace('_', ' ')}</span>
            <span className="text-[11px] text-stone-400">v{t.version} · {new Date(t.updatedAt).toLocaleDateString('en-IN')}</span>
          </div>
          <h3 className="mt-2 font-display text-lg font-semibold leading-snug group-hover:text-saffron-600">{t.title}</h3>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500">
            {t.destination && <span><MapPin className="mr-0.5 inline h-3 w-3" />{t.destination}</span>}
            {t.request && <span>{fmtDate(t.request.startDate)} · {t.request.nights} nights · {t.request.adults + t.request.children} travellers</span>}
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-saffron-600">Open plan <ArrowRight className="h-3 w-3" /></div>
        </Link>
      ))}
    </div>
  );
}

export default function TripsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 font-display text-3xl font-semibold">My trips</h1>
      <p className="mb-6 text-sm text-stone-500">Every plan is persisted in PostgreSQL with its conversation and agent run history.</p>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-stone-100" />}>
        <TripList />
      </Suspense>
    </div>
  );
}
