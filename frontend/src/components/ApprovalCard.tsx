'use client';

import { BedDouble, Check, ExternalLink, Plane, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { inr } from '@/lib/api';
import type { BookingSummary } from '@/lib/types';

/** Human-in-the-loop approval for an AG-UI interrupt raised by the booking_approval graph node. */
export function ApprovalCard({
  summary, busy, onDecide,
}: { summary: BookingSummary; busy: boolean; onDecide: (approved: boolean, comment: string) => void }) {
  const [comment, setComment] = useState('');
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700"><UserCheck className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Approve these bookings?</h3>
          <p className="text-xs text-stone-600">{summary.tripTitle} · {summary.dates} · {summary.travellers} traveller(s)</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-stone-500">Bookable items total</div>
          <div className="text-lg font-bold">{inr(summary.totalINR)}</div>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-amber-200/70 rounded-xl bg-white/70">
        {summary.items.map((i) => (
          <li key={i.title} className="flex items-center gap-3 px-3 py-2 text-sm">
            {i.kind === 'stay' ? <BedDouble className="h-4 w-4 shrink-0 text-stone-500" /> : <Plane className="h-4 w-4 shrink-0 text-stone-500" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{i.title}</div>
              <div className="text-xs text-stone-500">{i.details}</div>
            </div>
            <span className="shrink-0 text-sm font-semibold">{inr(i.amountINR)}</span>
            {i.bookingUrl && (
              <a href={i.bookingUrl} target="_blank" rel="noreferrer" className="shrink-0 text-saffron-600 hover:underline" aria-label={`Open booking page for ${i.title}`}>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-stone-500">{summary.note}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input id="approval-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional note (e.g. reason for rejecting)"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-saffron-500" />
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => onDecide(false, comment)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50">
            <X className="h-4 w-4" /> Reject
          </button>
          <button disabled={busy} onClick={() => onDecide(true, comment)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check className="h-4 w-4" /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}
