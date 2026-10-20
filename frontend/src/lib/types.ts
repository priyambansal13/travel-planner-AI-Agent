// Mirrors backend/src/agents/schemas.ts and trip.entity.ts

export type AgentKey = 'supervisor' | 'destination_research' | 'itinerary_planner' | 'accommodation' | 'transport' | 'aggregator' | 'booking';
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error' | 'skipped';

export type AgentEvent =
  | { type: 'agent'; agent: AgentKey; status: Exclude<AgentStatus, 'idle'>; message?: string; durationMs?: number; at: string }
  | { type: 'tool'; agent: AgentKey; tool: string; phase: 'start' | 'end'; input?: unknown; preview?: string; durationMs?: number; ok?: boolean; at: string }
  | { type: 'supervisor'; intent: string; reasoning: string; agents: AgentKey[]; at: string };

export interface TripRequest {
  origin: string | null;
  destination: string | null;
  startDate: string;
  endDate: string;
  nights: number;
  adults: number;
  children: number;
  budgetINR: number | null;
  budgetLevel: 'budget' | 'moderate' | 'luxury';
  interests: string[];
  pace: 'relaxed' | 'balanced' | 'packed';
  transportPreference: string;
  accommodationType: string | null;
  dietary: string | null;
  notes: string | null;
  assumptions: string[];
}

export interface ImdAlert { date: string; level: 'green' | 'yellow' | 'orange' | 'red'; warnings: string[] }

export interface Research {
  destination: { name: string; state: string | null; lat: number; lon: number };
  overview: string;
  bestTimeToVisit: string;
  weather: {
    source: string; isLiveForecast: boolean; advice: string;
    days: { date: string; maxC: number; minC: number; precipitationMm: number; condition: string }[];
    alerts?: ImdAlert[];
    alertsSource?: string | null;
  };
  attractions: { name: string; category: string; description: string; lat: number | null; lon: number | null; suggestedHours: number | null; entryFeeINR: number | null; bestTimeOfDay: string | null }[];
  neighbourhoods: { name: string; vibe: string }[];
  cuisine: string[];
  safety: string[];
  localTips: string[];
  permitsAndEntry: string[];
  news: { title: string; url: string; source: string }[];
}

export interface StayOption {
  name: string; type: string; area: string; priceMinINR: number; priceMaxINR: number; priceIsEstimate: boolean;
  highlights: string; bestFor: string; lat: number | null; lon: number | null; bookingUrl: string | null; dataSource: string;
}
export interface Accommodation { areaAdvice: string; options: StayOption[]; recommendedOption: string; roomsNeeded: number; estimatedTotalINR: number }

export interface TransportOption {
  mode: 'flight' | 'train' | 'bus' | 'road'; title: string; details: string; durationText: string;
  pricePerPersonINR: number | null; isLiveData: boolean; bookingUrl: string | null; recommended: boolean;
}
export interface Transport {
  outbound: TransportOption[]; returnJourney: TransportOption[]; recommendation: string;
  localTransport: { mode: string; tip: string; approxCostINR: string | null }[]; estimatedTotalINR: number;
}

export type ItemCategory = 'sightseeing' | 'food' | 'travel' | 'activity' | 'rest' | 'shopping' | 'checkin' | 'nightlife';
export interface ItineraryItem {
  time: string; title: string; description: string; category: ItemCategory; placeName: string | null;
  lat: number | null; lon: number | null; durationMins: number | null; costINR: number | null; travelFromPrevious: string | null;
}
export interface ItineraryDay { day: number; date: string; theme: string; items: ItineraryItem[]; weatherNote: string | null }
export interface Itinerary { days: ItineraryDay[]; optimizationNotes: string; estimatedActivitiesAndFoodINR: number }

export interface TravelPlan {
  title: string;
  summary: string;
  highlights: string[];
  budget: { totalINR: number; perPersonINR: number; withinBudget: boolean | null; breakdown: { category: string; amountINR: number; notes: string }[] };
  packingList: string[];
  finalTips: string[];
  chatReply: string;
  request: TripRequest;
  research: Research | null;
  accommodation: Accommodation | null;
  transport: Transport | null;
  itinerary: Itinerary | null;
  generatedAt: string;
}

export interface BookingItem { kind: 'stay' | 'outbound' | 'return'; title: string; details: string; amountINR: number | null; bookingUrl: string | null }
export interface BookingSummary { tripTitle: string; dates: string; travellers: number; items: BookingItem[]; totalINR: number; note: string }
export interface BookingRecord {
  status: 'awaiting_approval' | 'approved' | 'rejected' | 'dismissed';
  interruptId: string | null;
  summary: BookingSummary;
  requestedAt: string;
  decidedAt: string | null;
  comment: string | null;
}

export interface ChatEntry { role: 'user' | 'assistant'; content: string; at: string }
export interface RunRecord { runId: string; intent: string; agentsRun: string[]; durationMs: number; errors: { agent: string; error: string }[]; events: AgentEvent[]; at: string }

export interface Trip {
  id: string; threadId: string; title: string; destination: string | null;
  status: 'planning' | 'ready' | 'needs_input' | 'awaiting_approval' | 'error';
  request: TripRequest | null; plan: TravelPlan | null; booking: BookingRecord | null; conversation: ChatEntry[]; runs: RunRecord[]; version: number;
  createdAt: string; updatedAt: string;
}

export interface PlanResult { threadId: string; tripId: string; reply: string; intent: string; agentsRun: string[]; errors: { agent: string; error: string }[]; trip: Trip }

export interface Health {
  status: string; database: string; llm: { provider: string; model: string; configured: boolean };
  observability: { langsmith: boolean }; providers: Record<string, string>;
}
