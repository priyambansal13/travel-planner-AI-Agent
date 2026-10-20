'use client';

import {
  BedDouble, Bus, CalendarDays, Car, CloudSun, Compass, ExternalLink, IndianRupee, Map as MapIcon, Plane, ShieldCheck,
  Sparkles, TrainFront, TriangleAlert, Users, Utensils,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { fmtDate, inr } from '@/lib/api';
import type { ImdAlert, ItemCategory, TransportOption, TravelPlan } from '@/lib/types';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => <div className="h-[520px] animate-pulse rounded-xl bg-stone-100" /> });

const TABS = [
  { id: 'itinerary', label: 'Itinerary', icon: CalendarDays },
  { id: 'stays', label: 'Stays', icon: BedDouble },
  { id: 'transport', label: 'Transport', icon: TrainFront },
  { id: 'destination', label: 'Destination', icon: Compass },
  { id: 'budget', label: 'Budget & tips', icon: IndianRupee },
  { id: 'map', label: 'Map', icon: MapIcon },
] as const;
type Tab = (typeof TABS)[number]['id'];

const CAT_STYLE: Record<ItemCategory, string> = {
  sightseeing: 'bg-sky-100 text-sky-700', food: 'bg-orange-100 text-orange-700', travel: 'bg-stone-200 text-stone-700',
  activity: 'bg-emerald-100 text-emerald-700', rest: 'bg-violet-100 text-violet-700', shopping: 'bg-pink-100 text-pink-700',
  checkin: 'bg-amber-100 text-amber-800', nightlife: 'bg-indigo-100 text-indigo-700',
};

const ALERT_STYLE: Record<ImdAlert['level'], string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-300',
  orange: 'bg-orange-50 text-orange-800 border-orange-300',
  red: 'bg-rose-50 text-rose-800 border-rose-300',
};
const ALERT_LABEL: Record<ImdAlert['level'], string> = {
  green: 'No warning', yellow: 'Yellow alert · be updated', orange: 'Orange alert · be prepared', red: 'Red alert · take action',
};

function ImdAlertChip({ alert }: { alert: ImdAlert }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${ALERT_STYLE[alert.level]}`}>
      <TriangleAlert className="h-3 w-3" /> IMD {ALERT_LABEL[alert.level]}{alert.warnings.length ? `: ${alert.warnings.join(', ')}` : ''}
    </span>
  );
}

const Badge = ({ live }: { live: boolean }) => (
  <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${live ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
    {live ? 'live' : 'estimate'}
  </span>
);

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-stone-200 bg-white p-4 ${className}`}>{children}</div>
);

const List = ({ title, items, icon: Icon }: { title: string; items: string[]; icon: React.ComponentType<{ className?: string }> }) =>
  items.length ? (
    <Card>
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4 text-saffron-500" />{title}</h4>
      <ul className="space-y-1 text-[13px] text-stone-700">{items.map((t) => <li key={t} className="flex gap-2"><span className="text-saffron-500">•</span>{t}</li>)}</ul>
    </Card>
  ) : null;

function TransportCard({ o }: { o: TransportOption }) {
  const Icon = { flight: Plane, train: TrainFront, bus: Bus, road: Car }[o.mode];
  return (
    <div className={`rounded-xl border p-3 ${o.recommended ? 'border-saffron-400 bg-saffron-50/50' : 'border-stone-200 bg-white'}`}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-stone-100"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{o.title}</span>
            {o.recommended && <span className="rounded-full bg-saffron-500 px-1.5 py-px text-[10px] font-semibold text-white">recommended</span>}
            <Badge live={o.isLiveData} />
          </div>
          <p className="mt-0.5 text-[12.5px] text-stone-600">{o.details}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-stone-700">
            <span>⏱ {o.durationText}</span>
            {o.pricePerPersonINR != null && <span className="font-semibold">{inr(o.pricePerPersonINR)} / person</span>}
            {o.bookingUrl && (
              <a href={o.bookingUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-saffron-600 hover:underline">
                Book <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlanView({ plan }: { plan: TravelPlan }) {
  const [tab, setTab] = useState<Tab>('itinerary');
  const r = plan.request;
  const weatherByDate = new Map((plan.research?.weather.days ?? []).map((w) => [w.date, w]));
  const alertByDate = new Map((plan.research?.weather.alerts ?? []).map((a) => [a.date, a]));

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-950 via-teal-900 to-emerald-800 p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="font-display text-2xl font-semibold leading-tight sm:text-3xl">{plan.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-teal-50/90">{plan.summary}</p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3 text-right backdrop-blur">
            <div className="text-[11px] uppercase tracking-wide text-teal-100/80">Estimated total</div>
            <div className="text-2xl font-bold">{inr(plan.budget.totalINR)}</div>
            <div className="text-xs text-teal-100/80">{inr(plan.budget.perPersonINR)} per person</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/10 px-2.5 py-1">📅 {fmtDate(r.startDate)} → {fmtDate(r.endDate)} · {r.nights} nights</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1"><Users className="mr-1 inline h-3 w-3" />{r.adults} adults{r.children ? ` + ${r.children} kids` : ''}</span>
          {r.origin && <span className="rounded-full bg-white/10 px-2.5 py-1">from {r.origin}</span>}
          <span className="rounded-full bg-white/10 px-2.5 py-1 capitalize">{r.budgetLevel} · {r.pace} pace</span>
          {plan.budget.withinBudget != null && (
            <span className={`rounded-full px-2.5 py-1 ${plan.budget.withinBudget ? 'bg-emerald-400/30' : 'bg-rose-400/40'}`}>
              {plan.budget.withinBudget ? 'Within budget' : 'Over budget'}
            </span>
          )}
        </div>
        {plan.highlights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {plan.highlights.map((h) => <span key={h} className="rounded-md bg-saffron-500/20 px-2 py-0.5 text-[11px] text-saffron-100">✦ {h}</span>)}
          </div>
        )}
        {r.assumptions.length > 0 && <p className="mt-3 text-[11px] text-teal-100/70">Assumed: {r.assumptions.join(' · ')}</p>}
      </div>

      {/* Tabs */}
      <div className="scrollbar-thin flex gap-1 overflow-x-auto rounded-xl border border-stone-200 bg-white p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === id ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'itinerary' && (
        <div className="space-y-4">
          {plan.itinerary?.days.map((d) => {
            const w = weatherByDate.get(d.date);
            return (
              <Card key={d.day}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-stone-900 px-2 py-0.5 text-xs font-bold text-white">Day {d.day}</span>
                  <span className="text-sm text-stone-500">{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <h3 className="font-display text-lg font-semibold">{d.theme}</h3>
                  {w && <span className="ml-auto rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700"><CloudSun className="mr-1 inline h-3 w-3" />{w.condition} · {Math.round(w.minC)}–{Math.round(w.maxC)}°C</span>}
                </div>
                {alertByDate.get(d.date) && alertByDate.get(d.date)!.level !== 'green' && (
                  <div className="mb-2"><ImdAlertChip alert={alertByDate.get(d.date)!} /></div>
                )}
                {d.weatherNote && <p className="mb-3 rounded-lg bg-sky-50/70 px-3 py-1.5 text-xs text-sky-800">{d.weatherNote}</p>}
                <ol className="relative space-y-3 border-l-2 border-stone-200 pl-5">
                  {d.items.map((it, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-saffron-500 ring-1 ring-saffron-300" />
                      {it.travelFromPrevious && <div className="mb-1 text-[11px] text-stone-400">↳ {it.travelFromPrevious}</div>}
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs font-semibold text-stone-500">{it.time}</span>
                        <span className="text-sm font-semibold">{it.title}</span>
                        <span className={`rounded px-1.5 py-px text-[10px] font-medium ${CAT_STYLE[it.category] ?? CAT_STYLE.activity}`}>{it.category}</span>
                        {it.costINR != null && it.costINR > 0 && <span className="text-xs text-stone-500">{inr(it.costINR)}</span>}
                        {it.durationMins != null && <span className="text-xs text-stone-400">{it.durationMins} min</span>}
                      </div>
                      <p className="text-[13px] text-stone-600">{it.description}</p>
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })}
          {plan.itinerary?.optimizationNotes && <p className="text-xs text-stone-500">🧭 {plan.itinerary.optimizationNotes}</p>}
          {!plan.itinerary && <Card>No itinerary was produced.</Card>}
        </div>
      )}

      {tab === 'stays' && plan.accommodation && (
        <div className="space-y-3">
          <Card><p className="text-sm text-stone-700"><b>Where to stay:</b> {plan.accommodation.areaAdvice}</p>
            <p className="mt-1 text-xs text-stone-500">{plan.accommodation.roomsNeeded} room(s) · estimated stay total {inr(plan.accommodation.estimatedTotalINR)}</p></Card>
          <div className="grid gap-3 md:grid-cols-2">
            {plan.accommodation.options.map((s) => {
              const rec = s.name === plan.accommodation!.recommendedOption;
              return (
                <div key={s.name} className={`rounded-xl border p-4 ${rec ? 'border-saffron-400 bg-saffron-50/40' : 'border-stone-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold">{s.name}</h4>
                      <p className="text-xs capitalize text-stone-500">{s.type} · {s.area}</p>
                    </div>
                    {rec && <span className="rounded-full bg-saffron-500 px-2 py-0.5 text-[10px] font-semibold text-white">our pick</span>}
                  </div>
                  <p className="mt-2 text-[13px] text-stone-700">{s.highlights}</p>
                  <p className="mt-1 text-xs text-stone-500">Best for: {s.bestFor}</p>
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <span className="font-semibold">{inr(s.priceMinINR)}–{inr(s.priceMaxINR)}</span><span className="text-xs text-stone-500">/ night</span>
                    <Badge live={!s.priceIsEstimate} />
                    {s.bookingUrl && <a href={s.bookingUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-saffron-600 hover:underline">Check rates <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                  <p className="mt-1 text-[10px] text-stone-400">Source: {s.dataSource}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'transport' && plan.transport && (
        <div className="space-y-4">
          <Card><p className="text-sm text-stone-700">{plan.transport.recommendation}</p>
            <p className="mt-1 text-xs text-stone-500">Transport estimate (round trip + local): {inr(plan.transport.estimatedTotalINR)}</p></Card>
          {[{ t: 'Getting there', list: plan.transport.outbound }, { t: 'Coming back', list: plan.transport.returnJourney }].map(({ t, list }) =>
            list.length ? (
              <div key={t}>
                <h4 className="mb-2 text-sm font-semibold text-stone-700">{t}</h4>
                <div className="grid gap-2 md:grid-cols-2">{list.map((o, i) => <TransportCard key={i} o={o} />)}</div>
              </div>
            ) : null,
          )}
          <Card>
            <h4 className="mb-2 text-sm font-semibold">Getting around locally</h4>
            <div className="divide-y divide-stone-100">
              {plan.transport.localTransport.map((l) => (
                <div key={l.mode} className="flex gap-3 py-2 text-[13px]">
                  <span className="w-36 shrink-0 font-medium">{l.mode}</span>
                  <span className="flex-1 text-stone-600">{l.tip}</span>
                  {l.approxCostINR && <span className="shrink-0 text-stone-500">{l.approxCostINR}</span>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'destination' && plan.research && (
        <div className="space-y-4">
          <Card>
            <h3 className="font-display text-lg font-semibold">{plan.research.destination.name}{plan.research.destination.state ? `, ${plan.research.destination.state}` : ''}</h3>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{plan.research.overview}</p>
            <p className="mt-2 text-xs text-stone-500"><b>Best time to visit:</b> {plan.research.bestTimeToVisit}</p>
          </Card>
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-sm font-semibold">Weather</h4>
              <Badge live={plan.research.weather.isLiveForecast} />
              <span className="text-[11px] text-stone-400">{plan.research.weather.source}</span>
            </div>
            <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
              {plan.research.weather.days.map((w) => (
                <div key={w.date} className="min-w-[96px] rounded-lg bg-sky-50 px-3 py-2 text-center">
                  <div className="text-[11px] text-sky-700">{fmtDate(w.date, { weekday: 'short', day: 'numeric' })}</div>
                  <div className="text-sm font-semibold">{Math.round(w.maxC)}° / {Math.round(w.minC)}°</div>
                  <div className="text-[10px] text-stone-500">{w.condition}</div>
                  {w.precipitationMm > 0 && <div className="text-[10px] text-sky-600">{w.precipitationMm.toFixed(1)} mm</div>}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-stone-700">{plan.research.weather.advice}</p>
            {(plan.research.weather.alerts?.length ?? 0) > 0 && (
              <div className="mt-3 border-t border-stone-100 pt-3">
                <div className="mb-1.5 text-xs font-semibold text-stone-700">Official IMD district warnings</div>
                <div className="flex flex-wrap gap-1.5">
                  {plan.research.weather.alerts!.map((a) => (
                    <div key={a.date} className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-stone-500">{fmtDate(a.date, { weekday: 'short', day: 'numeric' })}</span>
                      <ImdAlertChip alert={a} />
                    </div>
                  ))}
                </div>
                {plan.research.weather.alertsSource && <p className="mt-1.5 text-[10px] text-stone-400">{plan.research.weather.alertsSource}</p>}
              </div>
            )}
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            {plan.research.attractions.map((a) => (
              <Card key={a.name} className="!p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-sm font-semibold">{a.name}</h4>
                  <span className="shrink-0 text-[11px] text-stone-400">{a.category}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-stone-600">{a.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-stone-500">
                  {a.suggestedHours != null && <span>⏱ ~{a.suggestedHours}h</span>}
                  {a.entryFeeINR != null && <span>🎟 {a.entryFeeINR ? inr(a.entryFeeINR) : 'Free'}</span>}
                  {a.bestTimeOfDay && <span>🕒 {a.bestTimeOfDay}</span>}
                </div>
              </Card>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {plan.research.neighbourhoods.length > 0 && (
              <Card>
                <h4 className="mb-2 text-sm font-semibold">Neighbourhoods</h4>
                {plan.research.neighbourhoods.map((n) => <p key={n.name} className="text-[13px]"><b>{n.name}</b> — <span className="text-stone-600">{n.vibe}</span></p>)}
              </Card>
            )}
            <List title="Must-try food" items={plan.research.cuisine} icon={Utensils} />
            <List title="Safety" items={plan.research.safety} icon={ShieldCheck} />
            <List title="Permits & entry" items={plan.research.permitsAndEntry} icon={Compass} />
            <List title="Local tips" items={plan.research.localTips} icon={Sparkles} />
          </div>
          {plan.research.news.length > 0 && (
            <Card>
              <h4 className="mb-2 text-sm font-semibold">Latest news & events</h4>
              <ul className="space-y-1.5">
                {plan.research.news.map((n) => (
                  <li key={n.url} className="text-[13px]"><a href={n.url} target="_blank" rel="noreferrer" className="hover:text-saffron-600 hover:underline">{n.title}</a> <span className="text-xs text-stone-400">— {n.source}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === 'budget' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="md:col-span-2">
            <h4 className="mb-3 text-sm font-semibold">Budget breakdown</h4>
            <div className="space-y-2.5">
              {plan.budget.breakdown.map((b) => {
                const pct = plan.budget.totalINR ? (b.amountINR / plan.budget.totalINR) * 100 : 0;
                return (
                  <div key={b.category}>
                    <div className="flex justify-between text-[13px]"><span className="font-medium">{b.category}</span><span>{inr(b.amountINR)}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-gradient-to-r from-saffron-400 to-rose-400" style={{ width: `${pct}%` }} /></div>
                    <p className="mt-0.5 text-[11px] text-stone-500">{b.notes}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-between border-t border-stone-100 pt-3 text-sm font-semibold">
              <span>Total{r.budgetINR ? ` (your budget ${inr(r.budgetINR)})` : ''}</span><span>{inr(plan.budget.totalINR)}</span>
            </div>
          </Card>
          <List title="Packing list" items={plan.packingList} icon={BedDouble} />
          <List title="Final tips" items={plan.finalTips} icon={Sparkles} />
        </div>
      )}

      {tab === 'map' && (
        <Card className="!p-2">
          <MapView plan={plan} />
          <p className="px-2 pt-2 text-[11px] text-stone-500">Coloured dots = itinerary stops by day · amber = stays (filled = our pick) · white = attractions</p>
        </Card>
      )}
    </div>
  );
}
