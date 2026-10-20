import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { daysFromToday, formatDuration, haversineKm, LatLon, round } from '../common/geo.js';
import { fetchJson, fetchText, qs } from '../common/http.js';
import { GeoService } from './geo.service.js';
import { resolveGateway } from './india-data.js';

export interface RoadRoute {
  distanceKm: number;
  durationHours: number;
  durationText: string;
  provider: 'ola-maps' | 'osrm' | 'straight-line-estimate';
}

const OLA = 'https://api.olamaps.io';
/** erail.in class slots (15) — slots without a confirmed mapping are left null and ignored. */
const ERAIL_CLASSES = ['1A', '2A', '3A', 'CC', 'FC', 'SL', '2S', '3E', 'GN', null, 'EC', null, null, null, null];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
const ddmmyyyy = (iso: string, sep = '/') => iso.split('-').reverse().join(sep);

/**
 * Inter-city transport for India.
 *  - Road:    Ola Maps Directions → OSRM → straight-line estimate
 *  - Trains:  IRCTC via RapidAPI (if keyed) → erail.in public timetable (keyless) → fare estimate + IRCTC link
 *  - Flights: distance/advance-purchase fare model + MakeMyTrip / ixigo deep links
 *  - Buses:   fare estimate + redBus deep link
 */
@Injectable()
export class TransportService {
  private readonly log = new Logger(TransportService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly geo: GeoService,
  ) {}

  async roadRoute(from: LatLon, to: LatLon): Promise<RoadRoute> {
    const ola = this.geo.olaKey;
    if (ola) {
      try {
        const data = await fetchJson(
          `${OLA}/routing/v1/directions?${qs({ origin: `${from.lat},${from.lon}`, destination: `${to.lat},${to.lon}`, alternatives: false, steps: false, overview: 'false', api_key: ola })}`,
          { method: 'POST', headers: { 'X-Request-Id': crypto.randomUUID() } },
        );
        const legs = data?.routes?.[0]?.legs ?? [];
        if (legs.length) {
          const m = legs.reduce((s: number, l: any) => s + Number(l.distance ?? 0), 0);
          const sec = legs.reduce((s: number, l: any) => s + Number(l.duration ?? 0), 0);
          return this.route(m / 1000, sec / 3600, 'ola-maps');
        }
      } catch (e) {
        this.log.warn(`Ola directions failed: ${(e as Error).message}`);
      }
    }
    try {
      const data = await fetchJson(
        `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`,
        { timeoutMs: 10_000 },
      );
      const r = data?.routes?.[0];
      // OSRM free-flow times are optimistic on Indian roads; add 30%.
      if (r) return this.route(r.distance / 1000, (r.duration / 3600) * 1.3, 'osrm');
    } catch (e) {
      this.log.warn(`OSRM failed: ${(e as Error).message}`);
    }
    const km = haversineKm(from, to) * 1.3;
    return this.route(km, km / 45, 'straight-line-estimate');
  }

  private route(km: number, hours: number, provider: RoadRoute['provider']): RoadRoute {
    return { distanceKm: round(km), durationHours: round(hours, 1), durationText: formatDuration(hours), provider };
  }

  async trains(fromCity: string, toCity: string, date: string, roadKm: number | null) {
    const from = resolveGateway(fromCity)?.station;
    const to = resolveGateway(toCity)?.station;
    if (!from || !to) {
      return { available: false, note: `No mapped railhead for ${!from ? fromCity : toCity}; rail may not be practical.` };
    }
    const booking = 'https://www.irctc.co.in/nget/train-search';
    const key = this.config.get<string>('RAPIDAPI_KEY');
    if (key) {
      try {
        const data = await fetchJson(
          `https://irctc1.p.rapidapi.com/api/v3/trainBetweenStations?${qs({ fromStationCode: from.code, toStationCode: to.code, dateOfJourney: date })}`,
          { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'irctc1.p.rapidapi.com' }, ttlMs: 6 * 3600_000 },
        );
        const trains = (data?.data ?? []).slice(0, 8).map((t: any) => ({
          number: t.train_number, name: t.train_name, departs: t.from_std, arrives: t.to_sta ?? t.to_std,
          duration: t.duration, classes: t.class_type ?? [], runDays: t.run_days ?? null,
        }));
        if (trains.length) {
          return { available: true, isLive: true, provider: 'IRCTC via RapidAPI', from, to, trains, fareEstimate: this.trainFares(roadKm), bookingUrl: booking };
        }
      } catch (e) {
        this.log.warn(`IRCTC RapidAPI failed: ${(e as Error).message}`);
      }
    }
    if (this.config.get<string>('ERAIL_ENABLED') !== 'false') {
      try {
        const trains = await this.erailTrains(from.code, to.code, date);
        if (trains.length) {
          return {
            available: true, isLive: true, provider: 'erail.in public timetable (unofficial). Timings are live; fares are indicative — confirm the current fare on IRCTC', from, to,
            runningOn: date, trains, bookingUrl: booking,
            note: 'Book 60 days ahead on IRCTC; Tatkal opens 1 day before at 10:00 (AC) / 11:00 (non-AC).',
          };
        }
      } catch (e) {
        this.log.warn(`erail.in failed: ${(e as Error).message}`);
      }
    }
    const km = roadKm ?? null;
    return {
      available: true,
      isLive: false,
      provider: 'estimate (no live timetable available)',
      from,
      to,
      typicalDuration: km ? formatDuration(km / 62) : null,
      fareEstimate: this.trainFares(km),
      bookingUrl: booking,
      note: 'Book 60 days ahead on IRCTC; Tatkal opens 1 day before at 10:00 (AC) / 11:00 (non-AC).',
    };
  }

  /**
   * Trains between two stations from erail.in's public timetable endpoint (no key). The payload is
   * `^`-separated records of `~`-separated fields; layout verified against live responses:
   *  0 number · 1 name · 6/7 from name/code · 8/9 to name/code · 10 dep · 11 arr · 12 duration (hh.mm)
   *  13 run days (7 flags, Sunday first) · 21 class flags (15 slots) · 32 train type
   *  41 fares "TYPE:km:slot1:…:slot15", each slot "base,…,total" in the same order as the class flags.
   */
  private async erailTrains(fromCode: string, toCode: string, date: string) {
    const raw = await fetchText(
      `https://erail.in/rail/getTrains.aspx?${qs({ Station_From: fromCode, Station_To: toCode, DataSource: 0, Language: 0, Cache: 'true' })}`,
      { ttlMs: 6 * 3600_000, timeoutMs: 15_000, headers: { Accept: 'text/plain,*/*' } },
    );
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday, matches erail's day flags
    const hhmm = (v: string) => {
      const [h, m] = v.split('.').map(Number);
      return Number.isFinite(h) ? `${h}h ${m || 0}m` : v;
    };
    return raw
      .split('^')
      .slice(1)
      .map((rec) => rec.split('~'))
      .filter((f) => f.length > 41 && /^\d{5}$/.test(f[0]) && f[13]?.[weekday] === '1')
      .map((f) => {
        const slots = (f[41] ?? '').split(':').slice(2);
        const classes = ERAIL_CLASSES.map((cls, i) => {
          if (!cls || f[21]?.[i] !== '1') return null;
          const total = Number((slots[i] ?? '').split(',').at(-1));
          // 1A slot values don't match published 1A fares, so only its availability is reported.
          const fare = cls !== '1A' && Number.isFinite(total) && total > 0 ? total : null;
          return { class: cls, indicativeFareINR: fare };
        }).filter(Boolean);
        return {
          number: f[0], name: f[1], type: f[32] || null,
          from: `${f[6]} (${f[7]})`, to: `${f[8]} (${f[9]})`,
          departs: f[10].replace('.', ':'), arrives: f[11].replace('.', ':'), duration: hhmm(f[12]),
          runsOn: DAYS.filter((_, i) => f[13][i] === '1').join(' ') || 'n/a',
          classes,
          _minutes: (Number(f[12].split('.')[0]) || 0) * 60 + (Number(f[12].split('.')[1]) || 0),
        };
      })
      .sort((a, b) => a._minutes - b._minutes)
      .slice(0, 8)
      .map(({ _minutes, ...t }) => t);
  }

  private trainFares(km: number | null) {
    if (!km) return null;
    const f = (perKm: number, min: number) => Math.max(min, Math.round((perKm * km) / 10) * 10);
    return { sleeperSL: f(0.45, 180), ac3Tier3A: f(1.2, 550), ac2Tier2A: f(1.7, 800), chairCarCC: km < 700 ? f(1.3, 400) : null, currency: 'INR per person (estimate)' };
  }

  flights(fromCity: string, toCity: string, date: string, adults: number, roadKm: number | null) {
    const from = resolveGateway(fromCity)?.airport;
    const to = resolveGateway(toCity)?.airport;
    if (!from || !to) return { available: false, note: `No mapped airport for ${!from ? fromCity : toCity}.` };
    if (from.code === to.code) return { available: false, note: 'Origin and destination share the same airport — fly not needed.' };
    const km = (roadKm ?? 600) / 1.25; // approx great-circle from road distance
    const days = daysFromToday(date);
    const advance = days < 7 ? 1.45 : days < 21 ? 1.2 : days < 45 ? 1.05 : 1.0;
    const base = Math.max(2800, 2000 + 2.6 * km) * advance;
    const pax = `A-${adults}_C-0_I-0`;
    return {
      available: true,
      isLive: false,
      provider: 'fare model (no free Indian flight inventory API) — verify on booking sites',
      from,
      to,
      blockTime: formatDuration(km / 720 + 0.6),
      fareRangePerPersonINR: { low: Math.round(base * 0.85 / 100) * 100, high: Math.round(base * 1.45 / 100) * 100 },
      advancePurchaseNote: days < 21 ? 'Close-in booking: fares are typically higher.' : 'Booking 3+ weeks ahead usually gets lower fares.',
      bookingLinks: {
        makemytrip: `https://www.makemytrip.com/flight/search?itinerary=${from.code}-${to.code}-${ddmmyyyy(date)}&tripType=O&paxType=${pax}&intl=false&cabinClass=E`,
        ixigo: `https://www.ixigo.com/search/result/flight?from=${from.code}&to=${to.code}&date=${ddmmyyyy(date, '')}&adults=${adults}&children=0&infants=0&class=e`,
      },
    };
  }

  buses(fromCity: string, toCity: string, roadKm: number | null) {
    if (!roadKm || roadKm > 1100) return { available: false, note: 'Too far for a practical bus journey.' };
    return {
      available: true,
      isLive: false,
      provider: 'estimate — live seats on redBus',
      typicalDuration: formatDuration(roadKm / 48),
      fareRangePerPersonINR: { nonAcSeater: Math.round(roadKm * 1.0), acSleeper: Math.round(roadKm * 1.9), volvoMultiAxle: Math.round(roadKm * 2.3) },
      bookingUrl: `https://www.redbus.in/bus-tickets/${slug(fromCity)}-to-${slug(toCity)}`,
    };
  }

  cab(roadKm: number | null) {
    if (!roadKm) return null;
    return { sedanOneWayINR: Math.round(roadKm * 13 + 400), suvOneWayINR: Math.round(roadKm * 17 + 400), note: 'Includes driver allowance; tolls/parking extra.' };
  }
}
