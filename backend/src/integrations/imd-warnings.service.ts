import { Injectable, Logger } from '@nestjs/common';
import { addDays } from '../common/geo.js';
import { fetchJson, qs } from '../common/http.js';

/** IMD hazard codes, as used by IMD's own district-warning map (mausam.imd.gov.in/responsive/districtWiseWarningGIS.php). */
const HAZARDS: Record<string, string> = {
  '1': 'No warning', '2': 'Heavy rain', '3': 'Heavy snow', '4': 'Thunderstorm & lightning, squall', '5': 'Hailstorm',
  '6': 'Dust storm', '7': 'Dust-raising winds', '8': 'Strong surface winds', '9': 'Heat wave', '10': 'Hot day',
  '11': 'Warm night', '12': 'Cold wave', '13': 'Cold day', '14': 'Ground frost', '15': 'Fog', '16': 'Very heavy rain',
  '17': 'Extremely heavy rain',
};
/** IMD colour scale in the data: 4 green (no warning), 3 yellow (be updated), 2 orange (be prepared), 1 red (take action). */
const LEVELS: Record<number, WarningLevel> = { 4: 'green', 3: 'yellow', 2: 'orange', 1: 'red' };
export type WarningLevel = 'green' | 'yellow' | 'orange' | 'red';

/** Common renamed districts: modern name ↔ name still used in IMD's district layer. */
const ALIASES: [string, string][] = [
  ['BENGALURU', 'BANGLORE'], ['BANGALORE', 'BANGLORE'], ['MYSURU', 'MYSORE'], ['BELAGAVI', 'BELGAUM'], ['KALABURAGI', 'GULBARGA'],
  ['VIJAYAPURA', 'BIJAPUR'], ['SHIVAMOGGA', 'SHIMOGA'], ['TUMAKURU', 'TUMKUR'], ['GURUGRAM', 'GURGAON'],
  ['PRAYAGRAJ', 'ALLAHABAD'], ['AYODHYA', 'FAIZABAD'], ['PUDUCHERRY', 'PONDICHERRY'], ['KOCHI', 'ERNAKULAM'],
  ['THIRUVANANTHAPURAM', 'TRIVANDRUM'], ['KOZHIKODE', 'CALICUT'], ['VADODARA', 'BARODA'], ['NUH', 'MEWAT'],
];

export interface DistrictWarnings {
  provider: string;
  district: string;
  issuedOn: string;
  days: { date: string; level: WarningLevel; warnings: string[] }[];
}

const WFS = 'https://reactjs.imd.gov.in/geoserver/wfs';
const norm = (s: string) => s.toUpperCase().replace(/\b(DISTRICT|DIST|TEHSIL|DIVISION)\b/g, '').replace(/[^A-Z]/g, '');

/**
 * Official IMD 5-day district-wise weather warnings from IMD's public GeoServer (keyless, the same
 * feed that powers IMD's warning map). The destination is reverse-geocoded to its district
 * (OpenStreetMap Nominatim) and matched against IMD's ~760 districts.
 */
@Injectable()
export class ImdWarningsService {
  private readonly log = new Logger(ImdWarningsService.name);

  private async allDistricts(): Promise<any[]> {
    const data = await fetchJson(
      `${WFS}?${qs({
        service: 'WFS', version: '1.0.0', request: 'GetFeature', outputFormat: 'application/json', typename: 'imd:district_warnings_india',
        propertyName: 'District,Date,Day_1,Day_2,Day_3,Day_4,Day_5,Day1_Color,Day2_Color,Day3_Color,Day4_Color,Day5_Color',
      })}`,
      { ttlMs: 30 * 60_000, timeoutMs: 20_000, headers: { Accept: 'application/json' } },
    );
    return (data?.features ?? []).map((f: any) => f.properties);
  }

  private async districtCandidates(lat: number, lon: number): Promise<string[]> {
    const r = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?${qs({ lat, lon, format: 'jsonv2', zoom: 10, addressdetails: 1, 'accept-language': 'en' })}`,
      { ttlMs: 24 * 3600_000 },
    );
    const a = r?.address ?? {};
    return [a.state_district, a.county, a.city_district, a.city, a.town, a.district].filter(Boolean);
  }

  private match(rows: any[], candidates: string[]) {
    for (const cand of candidates) {
      const c = norm(cand);
      if (!c) continue;
      const forms = new Set([c]);
      for (const [modern, old] of ALIASES) {
        if (c.includes(modern)) forms.add(c.replace(modern, old));
        if (c.includes(old)) forms.add(c.replace(old, modern));
      }
      for (const f of forms) {
        const exact = rows.find((r) => norm(r.District) === f);
        if (exact) return exact;
      }
      for (const f of forms) {
        const partial = rows.find((r) => {
          const d = norm(r.District);
          return d.length > 3 && (f.startsWith(d) || d.startsWith(f));
        });
        if (partial) return partial;
      }
    }
    return null;
  }

  async forLocation(lat: number, lon: number): Promise<DistrictWarnings | null> {
    try {
      const [rows, candidates] = await Promise.all([this.allDistricts(), this.districtCandidates(lat, lon)]);
      const row = this.match(rows, candidates);
      if (!row) {
        this.log.warn(`No IMD district match for ${candidates.join(' / ') || `${lat},${lon}`}`);
        return null;
      }
      return {
        provider: 'IMD district-wise warnings (official, public GeoServer)',
        district: row.District,
        issuedOn: row.Date,
        days: [1, 2, 3, 4, 5].map((n) => ({
          date: addDays(row.Date, n - 1),
          level: LEVELS[row[`Day${n}_Color`]] ?? 'green',
          warnings: String(row[`Day_${n}`] ?? '')
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c && c !== '1')
            .map((c) => HAZARDS[c] ?? `IMD code ${c}`),
        })),
      };
    } catch (e) {
      this.log.warn(`IMD warnings unavailable: ${(e as Error).message}`);
      return null;
    }
  }
}
