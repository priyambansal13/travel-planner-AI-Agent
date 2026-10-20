import { Injectable, Logger } from '@nestjs/common';
import { haversineKm, round } from '../common/geo.js';
import { fetchJson, qs } from '../common/http.js';
import { GeoService } from './geo.service.js';

export interface Place {
  name: string;
  category: string;
  address: string | null;
  lat: number;
  lon: number;
  distanceKm: number | null;
  rating: number | null;
  stars: string | null;
  website: string | null;
  wikipedia: string | null;
  provider: 'ola-maps' | 'openstreetmap' | 'wikipedia';
}

export type PlaceCategory = 'attractions' | 'hotels' | 'restaurants' | 'nightlife' | 'shopping' | 'nature';

/** Text queries used against Ola Maps, and equivalent OpenStreetMap tag filters for the fallback. */
const CATEGORY_QUERIES: Record<PlaceCategory, { ola: string; osm: string[] }> = {
  attractions: {
    ola: 'tourist attractions',
    osm: [
      'nwr["tourism"~"^(attraction|museum|viewpoint|gallery|theme_park|zoo)$"]["name"]',
      'nwr["historic"~"^(monument|fort|castle|palace|memorial|archaeological_site|ruins)$"]["name"]',
      'nwr["amenity"="place_of_worship"]["wikipedia"]["name"]',
    ],
  },
  hotels: { ola: 'hotels', osm: ['nwr["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]["name"]', 'nwr["leisure"="resort"]["name"]'] },
  restaurants: { ola: 'restaurants', osm: ['nwr["amenity"~"^(restaurant|cafe|food_court)$"]["name"]'] },
  nightlife: { ola: 'bars and pubs', osm: ['nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]'] },
  shopping: { ola: 'markets and shopping', osm: ['nwr["shop"~"^(mall|department_store|craft|gift|clothes)$"]["name"]', 'nwr["amenity"="marketplace"]["name"]'] },
  nature: {
    ola: 'parks beaches lakes waterfalls',
    osm: ['nwr["natural"~"^(beach|peak|waterfall|cave_entrance)$"]["name"]', 'nwr["leisure"~"^(park|nature_reserve)$"]["name"]', 'nwr["waterway"="waterfall"]["name"]'],
  },
};

const OLA = 'https://api.olamaps.io';
const OVERPASS_TIMEOUT_MS = 6_000;
const PHRASES: Record<PlaceCategory, string> = {
  hotels: 'hotels', restaurants: 'restaurants', nightlife: 'bars', shopping: 'marketplaces', attractions: 'attraction', nature: 'park',
};
const SIGHT_PHRASES: Record<'attractions' | 'nature', string[]> = {
  // Kept short: Nominatim allows 1 req/s, so every phrase costs ~1 s when several agents search at once.
  attractions: ['attraction', 'viewpoint'],
  nature: ['waterfall', 'beach', 'park'],
};
const OVERPASS_MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const SIGHT_RE = /fort|palace|temple|mandir|mosque|masjid|church|cathedral|basilica|gurudwara|museum|monument|memorial|tomb|mausoleum|stepwell|baori|gate|haveli|observatory|heritage|garden|lake|beach|ghat|bazaar|market|zoo|park|cave|dargah|stupa|monastery|gompa|waterfall|falls|viewpoint|hill|island|sanctuary|national park|landmark|historic|archaeolog|ruins|dam|church|chhatri|square|maidan|bridge|lighthouse|aquarium|gallery|tourist/i;
const NATURE_RE = /lake|beach|waterfall|falls|hill|peak|park|garden|sanctuary|national park|reserve|forest|river|valley|cave|island|dam|wetland|backwater|lagoon|trek|pass|glacier|meadow/i;
const EXCLUDE_RE = /school|college|university|institute|district|tehsil|constituency|bomb|attack|hospital|railway station|railway|metro station|airport|company|politician|cricket|stadium|election|ward|village|neighbourhood|suburb|locality|census|club|hotel|bank|office|court|police|newspaper|film|television|radio/i;

@Injectable()
export class PlacesService {
  private readonly log = new Logger(PlacesService.name);
  constructor(private readonly geo: GeoService) {}

  /**
   * Places of a category around a point. Chain: Ola Maps text search (India, keyed) →
   * keyless fallbacks: Wikipedia GeoSearch for sights/nature, Nominatim category search for
   * hotels/food/nightlife/shopping → OpenStreetMap Overpass (mirrors) as the last resort.
   */
  async findByCategory(category: PlaceCategory, near: { lat: number; lon: number; label: string }, radiusKm = 15, limit = 15) {
    const spec = CATEGORY_QUERIES[category];
    if (this.geo.olaKey) {
      try {
        const places = await this.olaTextSearch(`${spec.ola} in ${near.label}`, near, radiusKm, limit, category);
        if (places.length) return places;
      } catch (e) {
        this.log.warn(`Ola text search failed, using OSM: ${(e as Error).message}`);
      }
    }
    let primary: Place[] = [];
    try {
      if (category === 'attractions' || category === 'nature') {
        primary = await this.wikipediaNearby(near, category, limit);
        if (primary.length < Math.min(5, limit)) {
          // Small towns have few geotagged Wikipedia articles — top up with OSM features via Nominatim.
          for (const phrase of SIGHT_PHRASES[category]) {
            primary = this.rank([...primary, ...(await this.nominatimCategory(phrase, near, radiusKm, limit))], limit);
            if (primary.length >= limit) break;
          }
        }
      } else {
        primary = await this.nominatimCategory(PHRASES[category], near, radiusKm, limit);
      }
      if (primary.length >= Math.min(3, limit)) return primary;
    } catch (e) {
      this.log.warn(`Keyless ${category} search failed, trying Overpass: ${(e as Error).message}`);
    }
    try {
      const extra = await this.overpass(spec.osm, near, radiusKm, limit, category);
      return this.rank([...primary, ...extra], limit);
    } catch (e) {
      this.log.warn(`Overpass failed: ${(e as Error).message}`);
      if (primary.length) return primary;
      throw new Error(`No ${category} found near ${near.label} (OpenStreetMap services busy) — try a wider radius or a nearby town.`);
    }
  }

  /** Free-text search (e.g. "South Indian breakfast in Basavanagudi"). Requires Ola Maps for best results. */
  async textSearch(query: string, near: { lat: number; lon: number; label: string }, limit = 10): Promise<Place[]> {
    if (this.geo.olaKey) return this.olaTextSearch(query, near, 25, limit, 'search');
    // Fallback: guess a category from the query and use OSM.
    const q = query.toLowerCase();
    const cat: PlaceCategory = /hotel|stay|resort|hostel/.test(q)
      ? 'hotels'
      : /food|restaurant|cafe|eat|breakfast|dinner|lunch/.test(q)
        ? 'restaurants'
        : /bar|pub|club|night/.test(q)
          ? 'nightlife'
          : /market|shop|bazaar|mall/.test(q)
            ? 'shopping'
            : /beach|lake|park|waterfall|trek|peak/.test(q)
              ? 'nature'
              : 'attractions';
    return this.findByCategory(cat, near, 15, limit);
  }

  private async olaTextSearch(input: string, near: { lat: number; lon: number }, radiusKm: number, limit: number, category: string): Promise<Place[]> {
    const data = await fetchJson(
      `${OLA}/places/v1/textsearch?${qs({ input, location: `${near.lat},${near.lon}`, radius: radiusKm * 1000, size: limit, api_key: this.geo.olaKey })}`,
      { headers: { 'X-Request-Id': crypto.randomUUID() } },
    );
    return (data?.predictions ?? [])
      .filter((p: any) => p?.geometry?.location)
      .slice(0, limit)
      .map((p: any) => {
        const loc = { lat: p.geometry.location.lat, lon: p.geometry.location.lng };
        return {
          name: p.name ?? p.structured_formatting?.main_text ?? 'Unnamed',
          category: p.types?.[0] ?? category,
          address: p.formatted_address ?? p.description ?? null,
          ...loc,
          distanceKm: round(haversineKm(near, loc), 1),
          rating: p.rating ?? null,
          stars: null,
          website: null,
          wikipedia: null,
          provider: 'ola-maps' as const,
        };
      });
  }

  private async nominatimCategory(phrase: string, near: { lat: number; lon: number; label: string }, radiusKm: number, limit: number): Promise<Place[]> {
    // A bare category phrase bounded by a viewbox is more reliable than "<phrase> in <label>",
    // because labels are often landmarks ("City Palace") that Nominatim can't resolve as an area.
    const d = Math.max(radiusKm, 2) / 111;
    const rows = await fetchJson<any[]>(
      `https://nominatim.openstreetmap.org/search?${qs({
        q: phrase, format: 'jsonv2', limit: 40, countrycodes: 'in', extratags: 1,
        viewbox: `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`, bounded: 1,
      })}`,
      { ttlMs: 6 * 3600_000 },
    );
    const places = rows
      // Drop unnamed/generic features such as a node literally named "Temple" or "Waterfall".
      .filter((r) => r.name && r.name.toLowerCase() !== String(r.type).toLowerCase() && r.name.toLowerCase() !== phrase)
      .map((r) => {
        const loc = { lat: Number(r.lat), lon: Number(r.lon) };
        return {
          name: r.name, category: r.type ?? phrase, address: r.display_name?.split(',').slice(1, 4).join(',').trim() ?? null, ...loc,
          distanceKm: round(haversineKm(near, loc), 1), rating: null, stars: r.extratags?.stars ?? null,
          website: r.extratags?.website ?? null, wikipedia: r.extratags?.wikipedia ?? null, provider: 'openstreetmap' as const,
        };
      });
    return this.rank(places, limit);
  }

  /** Notable sights near a point from Wikipedia's geosearch, filtered to landmark-like articles. */
  private async wikipediaNearby(near: { lat: number; lon: number }, category: PlaceCategory, limit: number): Promise<Place[]> {
    const data = await fetchJson(
      `https://en.wikipedia.org/w/api.php?${qs({
        action: 'query', generator: 'geosearch', ggscoord: `${near.lat}|${near.lon}`, ggsradius: 10000, ggslimit: 80,
        prop: 'coordinates|description', colimit: 'max', format: 'json', formatversion: 2,
      })}`,
      { ttlMs: 24 * 3600_000 },
    );
    const sightRe = category === 'nature' ? NATURE_RE : SIGHT_RE;
    return (data?.query?.pages ?? [])
      .filter((p: any) => p.coordinates?.[0] && sightRe.test(`${p.title} ${p.description ?? ''}`) && !EXCLUDE_RE.test(`${p.title} ${p.description ?? ''}`))
      .map((p: any) => {
        const loc = { lat: p.coordinates[0].lat, lon: p.coordinates[0].lon };
        return {
          name: p.title, category: p.description ?? 'landmark', address: null, ...loc, distanceKm: round(haversineKm(near, loc), 1),
          rating: null, stars: null, website: null, wikipedia: `en:${p.title}`, provider: 'wikipedia' as const,
        };
      })
      .sort((a: Place, b: Place) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, limit);
  }

  private async overpass(filters: string[], near: { lat: number; lon: number }, radiusKm: number, limit: number, category: string): Promise<Place[]> {
    const around = `(around:${Math.round(radiusKm * 1000)},${near.lat},${near.lon})`;
    const query = `[out:json][timeout:12];(${filters.map((f) => `${f}${around};`).join('')});out center tags 150;`;
    let data: any = null;
    let lastError: unknown;
    for (const endpoint of OVERPASS_MIRRORS) {
      try {
        data = await fetchJson(endpoint, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeoutMs: OVERPASS_TIMEOUT_MS,
          ttlMs: 6 * 3600_000,
        });
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!data) throw lastError ?? new Error('Overpass unavailable');
    const seen = new Set<string>();
    const places: Place[] = [];
    for (const el of data?.elements ?? []) {
      const t = el.tags ?? {};
      const name = t['name:en'] || t.name;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!name || lat == null || seen.has(name)) continue;
      seen.add(name);
      places.push({
        name,
        category: t.tourism || t.historic || t.amenity || t.natural || t.leisure || t.shop || category,
        address: [t['addr:street'], t['addr:city']].filter(Boolean).join(', ') || null,
        lat,
        lon,
        distanceKm: round(haversineKm(near, { lat, lon }), 1),
        rating: null,
        stars: t.stars ?? null,
        website: t.website ?? t['contact:website'] ?? null,
        wikipedia: t.wikipedia ?? null,
        provider: 'openstreetmap',
      });
    }
    return this.rank(places, limit);
  }

  /** Notable places (Wikipedia/Wikidata, star rating, website) first, then nearest. */
  private rank(places: Place[], limit: number) {
    const seen = new Set<string>();
    const score = (p: Place) => (p.wikipedia ? 3 : 0) + (p.stars ? 1 : 0) + (p.website ? 1 : 0);
    return places
      .filter((p) => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
      .sort((a, b) => score(b) - score(a) || (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, limit);
  }

  /** Wikipedia page summary for richer descriptions. */
  async wikipediaSummary(title: string) {
    const clean = title.replace(/^en:/, '');
    const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean.replace(/ /g, '_'))}`, {
      ttlMs: 24 * 3600_000,
    });
    return {
      title: data.title,
      description: data.description ?? null,
      extract: data.extract,
      coordinates: data.coordinates ? { lat: data.coordinates.lat, lon: data.coordinates.lon } : null,
      url: data.content_urls?.desktop?.page ?? null,
    };
  }
}
