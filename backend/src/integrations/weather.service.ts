import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { addDays, daysFromToday, haversineKm, round } from '../common/geo.js';
import { fetchJson, qs } from '../common/http.js';
import { ImdWarningsService } from './imd-warnings.service.js';

const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Heavy showers',
  82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
};

export interface WeatherDay {
  date: string;
  maxC: number;
  minC: number;
  precipitationMm: number;
  rainChancePct: number | null;
  condition: string;
}

const IMD = 'https://api.imd.gov.in/api/v1';
const IMD_MAX_STATION_KM = 60;

/**
 * Weather for Indian destinations.
 *  - IMD (India Meteorological Department) official 7-day city forecast when IMD_API_KEY + IMD_JWT
 *    are configured (requires IMD registration and IP whitelisting); nearest IMD station ≤ 60 km.
 *  - Open-Meteo (keyless, Asia/Kolkata): live 16-day forecast, or the same dates last year as a
 *    seasonal reference for trips further out. Also fills dates/rainfall IMD does not cover.
 */
@Injectable()
export class WeatherService {
  private readonly log = new Logger(WeatherService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly imdWarnings: ImdWarningsService,
  ) {}

  get imdConfigured() {
    return !!(this.config.get<string>('IMD_API_KEY') && this.config.get<string>('IMD_JWT'));
  }

  /** Forecast for the trip dates plus official IMD district warnings (when the trip overlaps IMD's 5-day window). */
  async forTrip(lat: number, lon: number, startDate: string, endDate: string) {
    const [forecast, warnings] = await Promise.all([
      this.forecastOnly(lat, lon, startDate, endDate),
      daysFromToday(startDate) <= 4 ? this.imdWarnings.forLocation(lat, lon) : Promise.resolve(null),
    ]);
    const inTrip = warnings?.days.filter((d) => d.date >= startDate && d.date <= endDate) ?? [];
    return {
      ...forecast,
      imdWarnings: warnings && inTrip.length
        ? { ...warnings, days: inTrip }
        : { note: 'IMD district warnings cover only the next 5 days; none apply to these dates yet.' },
    };
  }

  private async forecastOnly(lat: number, lon: number, startDate: string, endDate: string) {
    const base = await this.openMeteo(lat, lon, startDate, endDate);
    if (!this.imdConfigured || daysFromToday(startDate) > 6) return base;
    try {
      const imd = await this.imdForecast(lat, lon);
      if (!imd) return base;
      const byDate = new Map(imd.days.map((d) => [d.date, d]));
      const covered = base.days.filter((d) => byDate.has(d.date)).length;
      if (!covered) return base;
      return {
        kind: 'forecast' as const,
        source: `IMD official city forecast — ${imd.station} (${imd.distanceKm} km away); rainfall amounts & later dates from Open-Meteo`,
        days: base.days.map((d) => {
          const o = byDate.get(d.date);
          return o ? { ...d, maxC: o.maxC ?? d.maxC, minC: o.minC ?? d.minC, condition: o.condition || d.condition } : d;
        }),
      };
    } catch (e) {
      this.log.warn(`IMD forecast failed, using Open-Meteo: ${(e as Error).message}`);
      return base;
    }
  }

  /** IMD 7-day city forecast from the nearest station (cityforecastloc returns all stations with coordinates). */
  private async imdForecast(lat: number, lon: number) {
    const headers = {
      'X-API-Key': this.config.get<string>('IMD_API_KEY')!,
      Authorization: `Bearer ${this.config.get<string>('IMD_JWT')}`,
    };
    const data = await fetchJson(`${IMD}/cityforecastloc`, { headers, ttlMs: 3 * 3600_000, timeoutMs: 20_000 });
    const rows: any[] = Array.isArray(data) ? data : (data?.data ?? data?.result ?? []);
    const num = (row: any, re: RegExp) => {
      const k = Object.keys(row).find((key) => re.test(key));
      const v = k ? Number(row[k]) : NaN;
      return Number.isFinite(v) ? v : null;
    };
    let best: { row: any; km: number } | null = null;
    for (const row of rows) {
      const la = num(row, /^lat/i);
      const lo = num(row, /^(lon|lng)/i);
      if (la == null || lo == null) continue;
      const km = haversineKm({ lat, lon }, { lat: la, lon: lo });
      if (!best || km < best.km) best = { row, km };
    }
    if (!best || best.km > IMD_MAX_STATION_KM) return null;
    const r = best.row;
    const t = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    const days = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      date: addDays(r.Date, n - 1),
      maxC: t(n === 1 ? r.Todays_Forecast_Max_Temp : r[`Day_${n}_Max_Temp`]),
      minC: t(n === 1 ? r.Todays_Forecast_Min_temp : r[`Day_${n}_Min_temp`]),
      condition: String((n === 1 ? r.Todays_Forecast : r[`Day_${n}_Forecast`]) ?? '').trim(),
    }));
    return { station: r.Station_Name ?? r.Station_Code, distanceKm: round(best.km), days };
  }

  private async openMeteo(lat: number, lon: number, startDate: string, endDate: string) {
    const startOffset = daysFromToday(startDate);
    if (startOffset <= 15) {
      const start = startOffset < 0 ? addDays(startDate, -startOffset) : startDate;
      const maxEnd = addDays(start, 15 - Math.max(startOffset, 0));
      const end = endDate < maxEnd ? endDate : maxEnd;
      const data = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?${qs({
          latitude: lat, longitude: lon, timezone: 'Asia/Kolkata', start_date: start, end_date: end,
          daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code',
        })}`,
        { ttlMs: 30 * 60_000 },
      );
      return { kind: 'forecast' as const, source: 'Open-Meteo forecast API', days: this.mapDaily(data.daily, 0) };
    }
    // Seasonal reference: same calendar window, previous year (archive API).
    const shift = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
    const data = await fetchJson(
      `https://archive-api.open-meteo.com/v1/archive?${qs({
        latitude: lat, longitude: lon, timezone: 'Asia/Kolkata', start_date: shift(startDate), end_date: shift(endDate),
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
      })}`,
      { ttlMs: 24 * 3600_000 },
    );
    return {
      kind: 'seasonal-reference' as const,
      source: 'Open-Meteo historical archive (same dates last year) — trip is beyond the 16-day forecast window',
      days: this.mapDaily(data.daily, 1),
    };
  }

  private mapDaily(d: any, yearShift: number): WeatherDay[] {
    return (d?.time ?? []).map((t: string, i: number) => ({
      date: yearShift ? `${Number(t.slice(0, 4)) + yearShift}${t.slice(4)}` : t,
      maxC: d.temperature_2m_max[i],
      minC: d.temperature_2m_min[i],
      precipitationMm: d.precipitation_sum[i] ?? 0,
      rainChancePct: d.precipitation_probability_max?.[i] ?? null,
      condition: WMO[d.weather_code[i]] ?? `WMO ${d.weather_code[i]}`,
    }));
  }
}
