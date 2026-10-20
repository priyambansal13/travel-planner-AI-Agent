'use client';

import { CheckCircle2, CircleAlert, Loader2, Wrench } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AGENT_META } from './AgentFlow';
import type { AgentKey } from '@/lib/types';

export interface ToolActivity {
  id: string;
  agent: AgentKey;
  tool: string;
  input?: unknown;
  status: 'running' | 'ok' | 'error';
  durationMs?: number;
  preview?: string;
}

const argSummary = (input: unknown) => {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v != null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v).slice(0, 28)}`)
    .join(', ');
};

export function ActivityFeed({ items }: { items: ToolActivity[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [items.length]);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5">
        <Wrench className="h-4 w-4 text-stone-500" />
        <h3 className="text-sm font-semibold">Live tool calls</h3>
        <span className="ml-auto text-[11px] text-stone-400">{items.length} calls</span>
      </div>
      <div ref={ref} className="scrollbar-thin max-h-72 space-y-1 overflow-y-auto p-2">
        {items.length === 0 && <p className="px-2 py-6 text-center text-xs text-stone-400">Agent tool calls to external APIs will stream here.</p>}
        {items.map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-stone-50">
            {t.status === 'running' ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
            ) : t.status === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-stone-100 px-1.5 py-px text-[10px] font-medium text-stone-600">{AGENT_META[t.agent]?.label ?? t.agent}</span>
                <code className="font-mono font-semibold text-stone-800">{t.tool}</code>
                {t.durationMs != null && <span className="text-stone-400">{(t.durationMs / 1000).toFixed(1)}s</span>}
              </div>
              <div className="truncate font-mono text-[10.5px] text-stone-500">{argSummary(t.input)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
