'use client';

import { Brain, Building2, CalendarDays, Database, MessageSquareText, Plane, Search, UserCheck, type LucideIcon } from 'lucide-react';
import type { AgentKey, AgentStatus } from '@/lib/types';

export interface AgentRuntime {
  status: AgentStatus;
  durationMs?: number;
  tools: number;
  message?: string;
}

export const AGENT_META: Record<AgentKey, { label: string; blurb: string; icon: LucideIcon; tint: string }> = {
  supervisor: { label: 'Supervisor', blurb: 'Understands request, routes tasks', icon: Brain, tint: 'text-emerald-600 bg-emerald-50' },
  destination_research: { label: 'Destination Research', blurb: 'Places, weather, safety, news', icon: Search, tint: 'text-sky-600 bg-sky-50' },
  itinerary_planner: { label: 'Itinerary Planning', blurb: 'Day-wise plan, route optimisation', icon: CalendarDays, tint: 'text-indigo-600 bg-indigo-50' },
  accommodation: { label: 'Accommodation', blurb: 'Hotels & homestays by budget', icon: Building2, tint: 'text-amber-600 bg-amber-50' },
  transport: { label: 'Transport Booking', blurb: 'Flights, trains, buses, road', icon: Plane, tint: 'text-cyan-600 bg-cyan-50' },
  aggregator: { label: 'Response Aggregator', blurb: 'Combines results, final plan', icon: MessageSquareText, tint: 'text-violet-600 bg-violet-50' },
  booking: { label: 'Booking approval', blurb: 'Human in the loop (AG-UI interrupt)', icon: UserCheck, tint: 'text-rose-600 bg-rose-50' },
};

const STATUS_STYLE: Record<AgentStatus, string> = {
  idle: 'border-stone-200 bg-white',
  running: 'border-blue-400 bg-blue-50/60 pulse-ring',
  waiting: 'border-amber-400 bg-amber-50',
  done: 'border-emerald-400 bg-emerald-50/50',
  error: 'border-rose-400 bg-rose-50',
  skipped: 'border-dashed border-stone-300 bg-stone-50 opacity-60',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle', running: 'Working…', waiting: 'Waiting for you', done: 'Done', error: 'Error', skipped: 'Skipped (reused)',
};

function Node({ id, rt, compact }: { id: AgentKey; rt: AgentRuntime; compact?: boolean }) {
  const meta = AGENT_META[id];
  const Icon = meta.icon;
  return (
    <div className={`relative rounded-xl border-2 px-3 py-2.5 transition-all ${STATUS_STYLE[rt.status]}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${meta.tint}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-tight">{meta.label}</div>
          {!compact && <div className="text-[11px] leading-snug text-stone-500">{meta.blurb}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]">
            <span className={rt.status === 'error' ? 'text-rose-600' : rt.status === 'running' ? 'text-blue-600' : rt.status === 'waiting' ? 'text-amber-700' : 'text-stone-500'}>
              {STATUS_LABEL[rt.status]}
            </span>
            {rt.tools > 0 && <span className="text-stone-400">· {rt.tools} tool calls</span>}
            {rt.durationMs != null && <span className="text-stone-400">· {(rt.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

const Connector = ({ dashed }: { dashed?: boolean }) => (
  <div className={`mx-auto h-4 w-px ${dashed ? 'border-l-2 border-dashed border-stone-300' : 'bg-stone-300'}`} />
);

export function AgentFlow({
  runtime, intent, reasoning, compact,
}: { runtime: Record<AgentKey, AgentRuntime>; intent?: string; reasoning?: string; compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">LangGraph orchestration <span className="ml-1 rounded bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-700">live via AG-UI</span></h3>
        {intent && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">intent: {intent.replace('_', ' ')}</span>
        )}
      </div>
      <div className="mx-auto max-w-xs">
        <Node id="supervisor" rt={runtime.supervisor} compact={compact} />
      </div>
      {reasoning && !compact && <p className="mx-auto mt-2 max-w-xl text-center text-[11px] italic text-stone-500">“{reasoning}”</p>}
      <Connector dashed />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(['destination_research', 'itinerary_planner', 'accommodation', 'transport'] as const).map((id) => (
          <Node key={id} id={id} rt={runtime[id]} compact={compact} />
        ))}
      </div>
      <div className="mt-1 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-center text-[11px] text-rose-700">
        Shared LangGraph state · Postgres checkpointer (conversation, intermediate results, preferences)
      </div>
      <Connector />
      <div className="mx-auto grid max-w-2xl grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Node id="aggregator" rt={runtime.aggregator} compact={compact} />
        <Node id="booking" rt={runtime.booking} compact={compact} />
        <div className="flex items-center gap-1.5 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800">
          <Database className="h-4 w-4" /> PostgreSQL
        </div>
      </div>
    </div>
  );
}
