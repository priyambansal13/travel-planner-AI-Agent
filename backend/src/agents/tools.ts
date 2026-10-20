import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { formatDuration, haversineKm, round } from '../common/geo.js';
import { GeoService } from '../integrations/geo.service.js';
import { resolveGateway, TARIFF_BANDS, TIER_MULTIPLIER } from '../integrations/india-data.js';
import { NewsService } from '../integrations/news.service.js';
import { PlacesService } from '../integrations/places.service.js';
import { TransportService } from '../integrations/transport.service.js';
import { WeatherService } from '../integrations/weather.service.js';
import type { AgentId } from './schemas.js';

export interface Integrations {
  geo: GeoService;
  places: PlacesService;
  weather: WeatherService;
  transport: TransportService;
  news: NewsService;
}

const MAX_TOOL_CHARS = 7000;
const out = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > MAX_TOOL_CHARS ? `${s.slice(0, MAX_TOOL_CHARS)}…(truncated)` : s;
};

/** Wraps a tool body so failures come back to the LLM as data instead of crashing the agent. */
const safe = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return out(await fn(a));
  } catch (e) {
    return out({ error: (e as Error).message });
  }
};

export function buildTools(s: Integrations): Record<AgentId, StructuredToolInterface[]> {
  const geocode = tool(
    safe(async ({ query }: { query: string }) => (await s.geo.geocode(query)) ?? { error: `Could not geocode "${query}" in India` }),
    {
      name: 'geocode_place',
      description: 'Resolve an Indian place name to coordinates and state (Ola Maps, fallback OpenStreetMap).',
      schema: z.object({ query: z.string().describe('Place name, e.g. "Hampi, Karnataka"') }),
    },
  );

  const weather = tool(
    safe(async ({ lat, lon, startDate, endDate }: { lat: number; lon: number; startDate: string; endDate: string }) =>
      s.weather.forTrip(lat, lon, startDate, endDate)),
    {
      name: 'get_weather_forecast',
      description: 'Daily weather for the trip dates (live forecast if within 16 days, else same dates last year as seasonal reference). Timezone IST.',
      schema: z.object({ lat: z.number(), lon: z.number(), startDate: z.string(), endDate: z.string() }),
    },
  );

  const findPlaces = tool(
    safe(async (a: { category: 'attractions' | 'restaurants' | 'nightlife' | 'shopping' | 'nature'; lat: number; lon: number; nearLabel: string; radiusKm: number | null }) =>
      s.places.findByCategory(a.category, { lat: a.lat, lon: a.lon, label: a.nearLabel }, a.radiusKm ?? 15, 15)),
    {
      name: 'find_places',
      description: 'Find real places of a category near coordinates (Ola Maps Places, fallback OpenStreetMap). Returns names, coordinates, distance.',
      schema: z.object({
        category: z.enum(['attractions', 'restaurants', 'nightlife', 'shopping', 'nature']),
        lat: z.number(),
        lon: z.number(),
        nearLabel: z.string().describe('Human label for the area, e.g. "Jaipur"'),
        radiusKm: z.number().nullable().describe('Search radius in km (default 15)'),
      }),
    },
  );

  const textSearch = tool(
    safe(async (a: { query: string; lat: number; lon: number; nearLabel: string }) =>
      s.places.textSearch(a.query, { lat: a.lat, lon: a.lon, label: a.nearLabel })),
    {
      name: 'search_places_text',
      description: 'Free-text place search near a location, e.g. "Rajasthani thali restaurant" or "sunset point".',
      schema: z.object({ query: z.string(), lat: z.number(), lon: z.number(), nearLabel: z.string() }),
    },
  );

  const wiki = tool(
    safe(async ({ title }: { title: string }) => s.places.wikipediaSummary(title)),
    {
      name: 'get_wikipedia_summary',
      description: 'Short encyclopedic summary of a place/attraction (history, significance).',
      schema: z.object({ title: z.string().describe('Wikipedia article title, e.g. "Amer Fort"') }),
    },
  );

  const news = tool(
    safe(async ({ query }: { query: string }) => s.news.search(query, 8)),
    {
      name: 'search_travel_news',
      description: 'Recent Indian news for a destination: festivals, events, closures, advisories, weather alerts (NewsData.io / Google News India).',
      schema: z.object({ query: z.string().describe('e.g. "Goa tourism" or "Manali road closure"') }),
    },
  );

  const hotels = tool(
    safe(async (a: { destination: string; lat: number; lon: number; checkIn: string; checkOut: string; adults: number; rooms: number; budgetLevel: 'budget' | 'moderate' | 'luxury'; areaHint: string | null }) => {
      const label = a.areaHint ? `${a.areaHint}, ${a.destination}` : a.destination;
      // Search the requested area and the whole destination in parallel, so an area name the
      // geocoder can't resolve never sinks (or slows down) the search.
      const [inArea, citywide] = await Promise.all([
        a.areaHint ? s.places.findByCategory('hotels', { lat: a.lat, lon: a.lon, label }, 12, 20).catch(() => []) : Promise.resolve([]),
        s.places.findByCategory('hotels', { lat: a.lat, lon: a.lon, label: a.destination }, 15, 20).catch(() => []),
      ]);
      const seen = new Set<string>();
      const found = [...inArea, ...citywide].filter((h) => !seen.has(h.name) && seen.add(h.name)).slice(0, 20);
      const tier = resolveGateway(a.destination)?.tier ?? 'leisure';
      const [lo, hi] = TARIFF_BANDS[a.budgetLevel];
      const m = TIER_MULTIPLIER[tier];
      const booking = (q: string) =>
        `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}&checkin=${a.checkIn}&checkout=${a.checkOut}&group_adults=${a.adults}&no_rooms=${a.rooms}`;
      return {
        provider: found[0]?.provider ?? 'none',
        priceGuidance: {
          perNightPerRoomINR: { min: Math.round(lo * m), max: Math.round(hi * m) },
          basis: `Typical ${a.budgetLevel} tariff band for a ${tier} destination (estimate; live rates on booking links)`,
        },
        searchAllUrl: booking(label),
        properties: found.map((h) => ({ ...h, bookingUrl: booking(`${h.name} ${a.destination}`) })),
      };
    }),
    {
      name: 'search_hotels',
      description: 'Find real hotels/homestays/resorts near a destination or area, with tariff guidance for the budget level and booking links.',
      schema: z.object({
        destination: z.string(),
        lat: z.number(),
        lon: z.number(),
        checkIn: z.string(),
        checkOut: z.string(),
        adults: z.number().int(),
        rooms: z.number().int(),
        budgetLevel: z.enum(['budget', 'moderate', 'luxury']),
        areaHint: z.string().nullable().describe('Neighbourhood to focus on, e.g. "Calangute" or null'),
      }),
    },
  );

  const cityDistance = async (from: string, to: string) => {
    const [a, b] = await Promise.all([s.geo.geocode(from), s.geo.geocode(to)]);
    if (!a || !b) return null;
    return s.transport.roadRoute(a, b);
  };

  const road = tool(
    safe(async ({ from, to }: { from: string; to: string }) => {
      const r = await cityDistance(from, to);
      return r ? { ...r, cab: s.transport.cab(r.distanceKm) } : { error: 'Could not geocode one of the places' };
    }),
    {
      name: 'get_road_route',
      description: 'Driving distance/time between two Indian places (Ola Maps Directions, fallback OSRM) plus cab fare estimate.',
      schema: z.object({ from: z.string(), to: z.string() }),
    },
  );

  const trains = tool(
    safe(async ({ fromCity, toCity, date }: { fromCity: string; toCity: string; date: string }) => {
      const r = await cityDistance(fromCity, toCity);
      return s.transport.trains(fromCity, toCity, date, r?.distanceKm ?? null);
    }),
    {
      name: 'search_trains',
      description: 'Indian Railways options between two cities on a date (live IRCTC timetable when configured; otherwise class-wise fare estimates) with IRCTC booking link.',
      schema: z.object({ fromCity: z.string(), toCity: z.string(), date: z.string().describe('YYYY-MM-DD') }),
    },
  );

  const flights = tool(
    safe(async ({ fromCity, toCity, date, adults }: { fromCity: string; toCity: string; date: string; adults: number }) => {
      const r = await cityDistance(fromCity, toCity);
      return s.transport.flights(fromCity, toCity, date, adults, r?.distanceKm ?? null);
    }),
    {
      name: 'search_flights',
      description: 'Domestic flight option between two Indian cities: nearest airports, block time, estimated fare range, MakeMyTrip/ixigo deep links.',
      schema: z.object({ fromCity: z.string(), toCity: z.string(), date: z.string(), adults: z.number().int() }),
    },
  );

  const buses = tool(
    safe(async ({ fromCity, toCity }: { fromCity: string; toCity: string }) => {
      const r = await cityDistance(fromCity, toCity);
      return s.transport.buses(fromCity, toCity, r?.distanceKm ?? null);
    }),
    {
      name: 'search_buses',
      description: 'Intercity bus option (duration, fare range by bus type) with redBus link.',
      schema: z.object({ fromCity: z.string(), toCity: z.string() }),
    },
  );

  const optimize = tool(
    safe(async ({ start, stops }: { start: { name: string; lat: number; lon: number }; stops: { name: string; lat: number; lon: number }[] }) => {
      // Greedy nearest-neighbour ordering — good enough for 3-8 stops in a day.
      const remaining = [...stops];
      const ordered: { name: string; lat: number; lon: number; legKm: number; legMins: number; mode: string }[] = [];
      let cur = start;
      while (remaining.length) {
        remaining.sort((x, y) => haversineKm(cur, x) - haversineKm(cur, y));
        const next = remaining.shift()!;
        const km = haversineKm(cur, next) * 1.35;
        const mode = km < 1.2 ? 'walk' : km < 10 ? 'auto-rickshaw / cab' : 'cab';
        const mins = mode === 'walk' ? (km / 4.5) * 60 : (km / 22) * 60 + 8;
        ordered.push({ ...next, legKm: round(km, 1), legMins: Math.round(mins), mode });
        cur = next;
      }
      const totalMins = ordered.reduce((t, o) => t + o.legMins, 0);
      return { order: ordered, totalTravel: formatDuration(totalMins / 60), note: 'Estimated city travel (avg 22 km/h incl. traffic).' };
    }),
    {
      name: 'optimize_day_route',
      description: 'Order a day\'s stops to minimise travel, returning per-leg distance, time and suggested mode (walk/auto/cab).',
      schema: z.object({
        start: z.object({ name: z.string(), lat: z.number(), lon: z.number() }).describe('Usually the hotel'),
        stops: z.array(z.object({ name: z.string(), lat: z.number(), lon: z.number() })),
      }),
    },
  );

  return {
    destination_research: [geocode, weather, findPlaces, wiki, news],
    accommodation: [geocode, hotels, findPlaces],
    transport: [flights, trains, buses, road],
    itinerary_planner: [optimize, textSearch, findPlaces, road],
  };
}
