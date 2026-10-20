'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';

const CITIES = [
  'Delhi', 'Mumbai', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Chandigarh',
  'Kochi', 'Goa', 'Udaipur', 'Jaisalmer', 'Varanasi', 'Rishikesh', 'Manali', 'Shimla', 'Leh', 'Srinagar', 'Darjeeling',
  'Gangtok', 'Munnar', 'Alleppey', 'Ooty', 'Coorg', 'Hampi', 'Pondicherry', 'Andaman', 'Agra', 'Amritsar', 'Mysuru',
];
const INTERESTS = ['Heritage', 'Food', 'Beaches', 'Mountains', 'Trekking', 'Spiritual', 'Wildlife', 'Nightlife', 'Shopping', 'Photography', 'Adventure', 'Culture'];

export const EXAMPLES = [
  '5 days in Kerala — Munnar and Alleppey houseboat — for a couple from Bengaluru, mid-range budget, love food and nature.',
  'Weekend trip to Rishikesh from Delhi by train for 3 friends, budget ₹15,000 total, want rafting and cafes.',
  'Family trip to Jaipur from Mumbai in late December, 2 adults + 1 child, vegetarian, relaxed pace, heritage focus.',
];

const inDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

export function TripForm({ onSubmit, disabled }: { onSubmit: (message: string) => void; disabled: boolean }) {
  const [f, setF] = useState({
    origin: 'Bengaluru', destination: '', startDate: inDays(21), nights: 4, adults: 2, children: 0,
    budget: '', budgetLevel: 'moderate', pace: 'balanced', transport: 'any', stay: 'hotel', dietary: '', notes: '',
    interests: ['Food', 'Culture'] as string[],
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.destination.trim()) return;
    const parts = [
      `Plan a trip to ${f.destination.trim()}${f.origin ? ` from ${f.origin}` : ''}, starting ${f.startDate} for ${f.nights} nights,`,
      `for ${f.adults} adult${f.adults > 1 ? 's' : ''}${f.children ? ` and ${f.children} child${f.children > 1 ? 'ren' : ''}` : ''}.`,
      f.budget ? `Total budget ₹${Number(f.budget).toLocaleString('en-IN')} (${f.budgetLevel}).` : `Budget level: ${f.budgetLevel}.`,
      f.interests.length ? `Interests: ${f.interests.join(', ').toLowerCase()}.` : '',
      `Pace: ${f.pace}. Preferred transport: ${f.transport}. Stay type: ${f.stay}.`,
      f.dietary ? `Dietary: ${f.dietary}.` : '',
      f.notes ? `Notes: ${f.notes}` : '',
    ];
    onSubmit(parts.filter(Boolean).join(' '));
  };

  const input = 'w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-saffron-500 focus:ring-2 focus:ring-saffron-100';
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-500';

  return (
    <form onSubmit={submit} className="space-y-3">
      <datalist id="in-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>From</label>
          <input list="in-cities" className={input} value={f.origin} onChange={(e) => set('origin', e.target.value)} placeholder="Origin city" />
        </div>
        <div>
          <label className={label}>To *</label>
          <input list="in-cities" required className={input} value={f.destination} onChange={(e) => set('destination', e.target.value)} placeholder="e.g. Udaipur" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <label className={label}>Start</label>
          <input type="date" className={input} value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
        <div>
          <label className={label}>Nights</label>
          <input type="number" min={1} max={21} className={input} value={f.nights} onChange={(e) => set('nights', Number(e.target.value))} />
        </div>
        <div>
          <label className={label}>Adults</label>
          <input type="number" min={1} max={20} className={input} value={f.adults} onChange={(e) => set('adults', Number(e.target.value))} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={label}>Kids</label>
          <input type="number" min={0} max={10} className={input} value={f.children} onChange={(e) => set('children', Number(e.target.value))} />
        </div>
        <div>
          <label className={label}>Budget ₹</label>
          <input type="number" min={0} step={1000} className={input} value={f.budget} onChange={(e) => set('budget', e.target.value)} placeholder="Total" />
        </div>
        <div>
          <label className={label}>Level</label>
          <select className={input} value={f.budgetLevel} onChange={(e) => set('budgetLevel', e.target.value)}>
            <option value="budget">Budget</option><option value="moderate">Mid-range</option><option value="luxury">Luxury</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={label}>Pace</label>
          <select className={input} value={f.pace} onChange={(e) => set('pace', e.target.value)}>
            <option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="packed">Packed</option>
          </select>
        </div>
        <div>
          <label className={label}>Travel by</label>
          <select className={input} value={f.transport} onChange={(e) => set('transport', e.target.value)}>
            <option value="any">Any</option><option value="flight">Flight</option><option value="train">Train</option><option value="bus">Bus</option><option value="road">Road trip</option>
          </select>
        </div>
        <div>
          <label className={label}>Stay</label>
          <select className={input} value={f.stay} onChange={(e) => set('stay', e.target.value)}>
            <option value="hotel">Hotel</option><option value="homestay">Homestay</option><option value="resort">Resort</option><option value="hostel">Hostel</option><option value="heritage haveli">Heritage</option>
          </select>
        </div>
      </div>
      <div>
        <label className={label}>Interests</label>
        <div className="flex flex-wrap gap-1.5">
          {INTERESTS.map((i) => {
            const on = f.interests.includes(i);
            return (
              <button type="button" key={i} onClick={() => set('interests', on ? f.interests.filter((x) => x !== i) : [...f.interests, i])}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${on ? 'border-saffron-500 bg-saffron-50 text-saffron-600' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                {i}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>Dietary</label>
          <input className={input} value={f.dietary} onChange={(e) => set('dietary', e.target.value)} placeholder="e.g. Jain, vegan" />
        </div>
        <div>
          <label className={label}>Notes</label>
          <input className={input} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anniversary, seniors…" />
        </div>
      </div>
      <button disabled={disabled || !f.destination.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-saffron-500 to-rose-500 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">
        <Sparkles className="h-4 w-4" /> Plan my trip
      </button>
    </form>
  );
}
