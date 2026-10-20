/**
 * Structured outputs for every agent. OpenAI strict JSON-schema mode requires every
 * field to be present, so "optional" values are modelled as `.nullable()`.
 */
import { z } from 'zod';

export const AGENT_IDS = ['destination_research', 'itinerary_planner', 'accommodation', 'transport'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const TripRequestSchema = z.object({
  origin: z.string().nullable().describe('Departure city in India, e.g. "Bengaluru". null if unknown.'),
  destination: z.string().nullable().describe('Primary destination, e.g. "Goa" or "Jaipur, Rajasthan". null if unknown.'),
  startDate: z.string().describe('Trip start date YYYY-MM-DD'),
  endDate: z.string().describe('Trip end date YYYY-MM-DD (departure day)'),
  nights: z.number().int(),
  adults: z.number().int(),
  children: z.number().int(),
  budgetINR: z.number().nullable().describe('Total trip budget in INR for the whole group, null if not given'),
  budgetLevel: z.enum(['budget', 'moderate', 'luxury']),
  interests: z.array(z.string()).describe('e.g. beaches, heritage, food, trekking, nightlife, spiritual, wildlife'),
  pace: z.enum(['relaxed', 'balanced', 'packed']),
  transportPreference: z.enum(['any', 'flight', 'train', 'bus', 'road']),
  accommodationType: z.string().nullable().describe('e.g. hotel, homestay, resort, hostel, villa'),
  dietary: z.string().nullable().describe('e.g. vegetarian, Jain, vegan'),
  notes: z.string().nullable().describe('Other constraints: senior citizens, toddler, accessibility, occasion'),
  assumptions: z.array(z.string()).describe('Defaults you assumed because the user did not specify them'),
});
export type TripRequest = z.infer<typeof TripRequestSchema>;

export const SupervisorDecisionSchema = z.object({
  intent: z.enum(['new_trip', 'refine', 'question', 'clarify', 'book']),
  reasoning: z.string().describe('One or two sentences explaining the routing decision'),
  request: TripRequestSchema,
  agentsToRun: z.array(z.enum(AGENT_IDS)).describe('Specialist agents that must (re)run for this turn'),
  instructions: z.object({
    destination_research: z.string().nullable(),
    itinerary_planner: z.string().nullable(),
    accommodation: z.string().nullable(),
    transport: z.string().nullable(),
  }).describe('Specific instructions for each agent this turn (esp. for refinements); null when none'),
  reply: z.string().nullable().describe('For intent=question or clarify: the message to send the user. Otherwise null.'),
});
export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;

const NewsSchema = z.object({ title: z.string(), url: z.string(), source: z.string() });

export const ResearchSchema = z.object({
  destination: z.object({ name: z.string(), state: z.string().nullable(), lat: z.number(), lon: z.number() }),
  overview: z.string(),
  bestTimeToVisit: z.string(),
  weather: z.object({
    source: z.string(),
    isLiveForecast: z.boolean(),
    days: z.array(z.object({ date: z.string(), maxC: z.number(), minC: z.number(), precipitationMm: z.number(), condition: z.string() })),
    advice: z.string().describe('Practical advice; mention any IMD warnings (yellow/orange/red) and how the plan adapts'),
    alerts: z.array(z.object({
      date: z.string(),
      level: z.enum(['green', 'yellow', 'orange', 'red']),
      warnings: z.array(z.string()),
    })).describe('Official IMD district warnings for trip dates (copy from the weather tool; empty if none)'),
    alertsSource: z.string().nullable().describe('e.g. "IMD district-wise warnings — ERNAKULAM, issued 2026-10-17"'),
  }),
  attractions: z.array(z.object({
    name: z.string(),
    category: z.string(),
    description: z.string(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    suggestedHours: z.number().nullable(),
    entryFeeINR: z.number().nullable(),
    bestTimeOfDay: z.string().nullable(),
  })),
  neighbourhoods: z.array(z.object({ name: z.string(), vibe: z.string() })),
  cuisine: z.array(z.string()),
  safety: z.array(z.string()),
  localTips: z.array(z.string()),
  permitsAndEntry: z.array(z.string()).describe('Inner Line Permits, protected-area permits, temple dress codes, etc.'),
  news: z.array(NewsSchema),
});
export type Research = z.infer<typeof ResearchSchema>;

export const AccommodationSchema = z.object({
  areaAdvice: z.string(),
  options: z.array(z.object({
    name: z.string(),
    type: z.string(),
    area: z.string(),
    priceMinINR: z.number().describe('per night per room'),
    priceMaxINR: z.number(),
    priceIsEstimate: z.boolean(),
    highlights: z.string(),
    bestFor: z.string(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    bookingUrl: z.string().nullable(),
    dataSource: z.string(),
  })),
  recommendedOption: z.string(),
  roomsNeeded: z.number().int(),
  estimatedTotalINR: z.number().describe('Total stay cost for all rooms and nights'),
});
export type Accommodation = z.infer<typeof AccommodationSchema>;

const TransportOptionSchema = z.object({
  mode: z.enum(['flight', 'train', 'bus', 'road']),
  title: z.string().describe('e.g. "IndiGo/Air India DEL→GOI" or "12779 Goa Express" or "Self-drive via NH48"'),
  details: z.string(),
  durationText: z.string(),
  pricePerPersonINR: z.number().nullable(),
  isLiveData: z.boolean(),
  bookingUrl: z.string().nullable(),
  recommended: z.boolean(),
});

export const TransportSchema = z.object({
  outbound: z.array(TransportOptionSchema),
  returnJourney: z.array(TransportOptionSchema),
  recommendation: z.string(),
  localTransport: z.array(z.object({ mode: z.string(), tip: z.string(), approxCostINR: z.string().nullable() })),
  estimatedTotalINR: z.number().describe('Round-trip intercity + local transport for the whole group'),
});
export type Transport = z.infer<typeof TransportSchema>;

export const ItinerarySchema = z.object({
  days: z.array(z.object({
    day: z.number().int(),
    date: z.string(),
    theme: z.string(),
    items: z.array(z.object({
      time: z.string().describe('HH:MM 24h'),
      title: z.string(),
      description: z.string(),
      category: z.enum(['sightseeing', 'food', 'travel', 'activity', 'rest', 'shopping', 'checkin', 'nightlife']),
      placeName: z.string().nullable(),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      durationMins: z.number().nullable(),
      costINR: z.number().nullable().describe('for the whole group'),
      travelFromPrevious: z.string().nullable().describe('e.g. "15 min by auto (4 km)"'),
    })),
    weatherNote: z.string().nullable(),
  })),
  optimizationNotes: z.string(),
  estimatedActivitiesAndFoodINR: z.number(),
});
export type Itinerary = z.infer<typeof ItinerarySchema>;

export const AggregateSchema = z.object({
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  budget: z.object({
    totalINR: z.number(),
    perPersonINR: z.number(),
    withinBudget: z.boolean().nullable(),
    breakdown: z.array(z.object({ category: z.string(), amountINR: z.number(), notes: z.string() })),
  }),
  packingList: z.array(z.string()),
  finalTips: z.array(z.string()),
  chatReply: z.string().describe('Short friendly markdown message for the chat (what was planned/changed, key next steps)'),
});
export type Aggregate = z.infer<typeof AggregateSchema>;

export interface StampedResult<T> {
  runId: string;
  data: T | null;
  error: string | null;
  durationMs: number;
}

/** Human-in-the-loop booking approval (AG-UI interrupt / LangGraph interrupt()). */
export interface BookingItem {
  kind: 'stay' | 'outbound' | 'return';
  title: string;
  details: string;
  amountINR: number | null;
  bookingUrl: string | null;
}
export interface BookingSummary {
  tripTitle: string;
  dates: string;
  travellers: number;
  items: BookingItem[];
  totalINR: number;
  note: string;
}
export interface BookingRecord {
  status: 'awaiting_approval' | 'approved' | 'rejected' | 'dismissed';
  interruptId: string | null;
  summary: BookingSummary;
  requestedAt: string;
  decidedAt: string | null;
  comment: string | null;
}

export interface TravelPlan extends Aggregate {
  request: TripRequest;
  research: Research | null;
  accommodation: Accommodation | null;
  transport: Transport | null;
  itinerary: Itinerary | null;
  generatedAt: string;
}
