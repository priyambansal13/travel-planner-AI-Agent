import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson, qs } from '../common/http.js';

export interface GeoResult {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  state: string | null;
  provider: 'ola-maps' | 'openstreetmap-nominatim';
}

const OLA = 'https://api.olamaps.io';

/** Geocoding: Ola Maps (India) first, OpenStreetMap Nominatim (restricted to India) as fallback. */
@Injectable()
export class GeoService {
  private readonly log = new Logger(GeoService.name);
  constructor(private readonly config: ConfigService) {}

  get olaKey(): string | undefined {
    return this.config.get<string>('OLA_MAPS_API_KEY') || undefined;
  }

  async geocode(query: string): Promise<GeoResult | null> {
    if (this.olaKey) {
      try {
        const data = await fetchJson(`${OLA}/places/v1/geocode?${qs({ address: query, api_key: this.olaKey })}`, {
          headers: { 'X-Request-Id': crypto.randomUUID() },
        });
        const r = data?.geocodingResults?.[0];
        if (r?.geometry?.location) {
          const state = r.address_components?.find((c: any) => c.types?.includes('administrative_area_level_1'))
            ?.long_name;
          return {
            name: r.name ?? query,
            displayName: r.formatted_address ?? query,
            lat: r.geometry.location.lat,
            lon: r.geometry.location.lng,
            state: state ?? null,
            provider: 'ola-maps',
          };
        }
      } catch (e) {
        this.log.warn(`Ola geocode failed, falling back to Nominatim: ${(e as Error).message}`);
      }
    }
    const rows = await fetchJson<any[]>(
      `https://nominatim.openstreetmap.org/search?${qs({ q: query, format: 'jsonv2', limit: 1, countrycodes: 'in', addressdetails: 1 })}`,
      { ttlMs: 24 * 3600_000 },
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      name: r.name || query,
      displayName: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      state: r.address?.state ?? null,
      provider: 'openstreetmap-nominatim',
    };
  }
}
