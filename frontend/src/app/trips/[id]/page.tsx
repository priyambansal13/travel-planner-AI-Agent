import { Activity, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PlanView } from '@/components/plan/PlanView';
import { api } from '@/lib/api';

async function TripDetail({ params }: Pick<PageProps<'/trips/[id]'>, 'params'>) {
  const { id } = await params;
  const trip = await api.trip(id).catch(() => null);
  if (!trip) notFound();
  const lastRun = trip.runs.at(-1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/?thread=${trip.threadId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800">
          <MessagesSquare className="h-4 w-4" /> Continue refining in chat
        </Link>
        {lastRun && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600">
            <Activity className="h-3.5 w-3.5" /> {trip.runs.length} agent runs · last: {lastRun.intent} [{lastRun.agentsRun.join(', ') || 'supervisor only'}] in {(lastRun.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      {trip.plan ? <PlanView plan={trip.plan} /> : <p className="text-stone-500">This trip has no plan yet.</p>}
    </div>
  );
}

export default function TripPage({ params }: PageProps<'/trips/[id]'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-stone-100" />}>
        <TripDetail params={params} />
      </Suspense>
    </div>
  );
}
