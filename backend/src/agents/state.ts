import { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type {
  Accommodation, BookingRecord, Itinerary, Research, StampedResult, SupervisorDecision, Transport, TravelPlan, TripRequest,
} from './schemas.js';

const last = <T>() => Annotation<T>({ reducer: (_prev: T, next: T) => next, default: () => null as T });

/**
 * Shared LangGraph state ("Shared State / Memory" in the HLD). Persisted per conversation
 * thread by the Postgres checkpointer, so follow-up requests reuse earlier agent results.
 * Each specialist writes only its own key, so parallel branches never conflict; results are
 * stamped with the runId that produced them, which tells the supervisor what is fresh.
 */
export const TravelState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  runId: last<string>(),
  request: last<TripRequest | null>(),
  decision: last<(SupervisorDecision & { runId: string }) | null>(),
  researchResult: last<StampedResult<Research> | null>(),
  stayResult: last<StampedResult<Accommodation> | null>(),
  transportResult: last<StampedResult<Transport> | null>(),
  itineraryResult: last<StampedResult<Itinerary> | null>(),
  plan: last<TravelPlan | null>(),
  booking: last<BookingRecord | null>(),
});

export type TravelStateType = typeof TravelState.State;
export type TravelStateUpdate = typeof TravelState.Update;

/** Agent id → state key (LangGraph forbids node names that equal state keys). */
export const RESULT_KEY = {
  destination_research: 'researchResult',
  itinerary_planner: 'itineraryResult',
  accommodation: 'stayResult',
  transport: 'transportResult',
} as const;

/** Progress events streamed to the UI over WebSocket and stored as the trip's trace. */
export type AgentEvent =
  | { type: 'agent'; agent: string; status: 'running' | 'done' | 'error' | 'skipped'; message?: string; durationMs?: number; at: string }
  | { type: 'tool'; agent: string; callId: string; tool: string; phase: 'start' | 'end'; input?: unknown; preview?: string; durationMs?: number; ok?: boolean; at: string }
  | { type: 'supervisor'; intent: string; reasoning: string; agents: string[]; at: string };
