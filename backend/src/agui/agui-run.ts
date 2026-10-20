import { randomUUID } from 'node:crypto';
import { type BaseEvent, EventType } from '@ag-ui/core';
import type { BookingRecord, TravelPlan } from '../agents/schemas.js';
import type { AgentEvent } from '../agents/state.js';

export const AGENT_KEYS = ['supervisor', 'destination_research', 'itinerary_planner', 'accommodation', 'transport', 'aggregator', 'booking'] as const;
type AgentKey = (typeof AGENT_KEYS)[number];

export interface AgentRuntimeState {
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error' | 'skipped';
  durationMs: number | null;
  tools: number;
  message: string | null;
}

/** AG-UI shared state for a travel-planning run (mirrored live in the UI). */
export interface TripAgentState {
  threadId: string;
  tripId: string | null;
  status: 'running' | 'done' | 'awaiting_approval' | 'cancelled' | 'error';
  intent: string | null;
  reasoning: string | null;
  agents: Record<AgentKey, AgentRuntimeState>;
  plan: TravelPlan | null;
  booking: BookingRecord | null;
}

/** AG-UI RUN_FINISHED outcome (success, paused for approval, or cancelled). */
export type RunOutcome =
  | { type: 'success' }
  | { type: 'cancelled' }
  | { type: 'interrupt'; interrupts: { id: string; reason: string; message?: string; responseSchema?: Record<string, any>; metadata?: Record<string, any> }[] };

export function initialState(threadId: string, tripId: string | null, plan: TravelPlan | null, booking: BookingRecord | null = null): TripAgentState {
  const agents = Object.fromEntries(
    AGENT_KEYS.map((a) => [a, { status: 'idle', durationMs: null, tools: 0, message: null }]),
  ) as Record<AgentKey, AgentRuntimeState>;
  return { threadId, tripId, status: 'running', intent: null, reasoning: null, agents, plan, booking };
}

/**
 * Translates the multi-agent graph's internal progress events into AG-UI protocol events:
 *  - each agent  → STEP_STARTED / STEP_FINISHED (stepName = agent id)
 *  - tool calls  → TOOL_CALL_START / ARGS / END / RESULT (metadata.agent attributes the call)
 *  - progress    → STATE_DELTA (RFC 6902 JSON Patch) on the shared TripAgentState
 *  - final reply → TEXT_MESSAGE_START / CONTENT (streamed) / END
 *  - run end     → RUN_FINISHED with outcome success | interrupt (booking approval) | cancelled
 */
export class AguiRun {
  private readonly state: TripAgentState;
  private readonly openSteps = new Set<string>();
  private readonly openTools = new Set<string>();

  constructor(
    private readonly send: (e: BaseEvent) => void,
    private readonly threadId: string,
    private readonly runId: string,
    state: TripAgentState,
  ) {
    this.state = state;
  }

  start() {
    this.send({ type: EventType.RUN_STARTED, threadId: this.threadId, runId: this.runId } as BaseEvent);
    this.send({ type: EventType.STATE_SNAPSHOT, snapshot: this.state } as BaseEvent);
  }

  private patch(ops: { op: 'replace'; path: string; value: unknown }[]) {
    this.send({ type: EventType.STATE_DELTA, delta: ops } as BaseEvent);
  }

  onAgentEvent(e: AgentEvent) {
    if (e.type === 'supervisor') {
      this.state.intent = e.intent;
      this.state.reasoning = e.reasoning;
      this.patch([
        { op: 'replace', path: '/intent', value: e.intent },
        { op: 'replace', path: '/reasoning', value: e.reasoning },
      ]);
      return;
    }
    if (e.type === 'agent') {
      const agent = e.agent as AgentKey;
      if (!this.state.agents[agent]) return;
      if (e.status === 'running' && !this.openSteps.has(agent)) {
        this.openSteps.add(agent);
        this.send({ type: EventType.STEP_STARTED, stepName: agent } as BaseEvent);
      }
      const rt = this.state.agents[agent];
      rt.status = e.status;
      rt.durationMs = e.durationMs ?? rt.durationMs;
      rt.message = e.message ?? rt.message;
      this.patch([{ op: 'replace', path: `/agents/${agent}`, value: { ...rt } }]);
      if ((e.status === 'done' || e.status === 'error') && this.openSteps.delete(agent)) {
        this.send({ type: EventType.STEP_FINISHED, stepName: agent } as BaseEvent);
      }
      return;
    }
    // tool events
    const meta = { agent: e.agent };
    if (e.phase === 'start') {
      this.openTools.add(e.callId);
      this.send({ type: EventType.TOOL_CALL_START, toolCallId: e.callId, toolCallName: e.tool, metadata: meta } as BaseEvent);
      this.send({ type: EventType.TOOL_CALL_ARGS, toolCallId: e.callId, delta: JSON.stringify(e.input ?? {}), metadata: meta } as BaseEvent);
      this.send({ type: EventType.TOOL_CALL_END, toolCallId: e.callId, metadata: meta } as BaseEvent);
      const agent = e.agent as AgentKey;
      if (this.state.agents[agent]) {
        this.state.agents[agent].tools += 1;
        this.patch([{ op: 'replace', path: `/agents/${agent}/tools`, value: this.state.agents[agent].tools }]);
      }
    } else {
      this.openTools.delete(e.callId);
      this.send({
        type: EventType.TOOL_CALL_RESULT,
        messageId: randomUUID(),
        toolCallId: e.callId,
        role: 'tool',
        content: e.preview ?? '',
        metadata: { ...meta, ok: e.ok ?? true, durationMs: e.durationMs ?? 0 },
      } as BaseEvent);
    }
  }

  /** Closes the run: final state snapshot, streamed assistant reply, RUN_FINISHED with its outcome. */
  async finish(
    reply: string,
    tripId: string,
    plan: TravelPlan | null,
    booking: BookingRecord | null,
    result: Record<string, unknown>,
    outcome: RunOutcome = { type: 'success' },
  ) {
    this.closeDangling();
    const waiting = outcome.type === 'interrupt';
    if (waiting) this.state.agents.booking = { ...this.state.agents.booking, status: 'waiting', message: 'Waiting for your approval' };
    Object.assign(this.state, { status: waiting ? 'awaiting_approval' : 'done', tripId, plan, booking });
    this.send({ type: EventType.STATE_SNAPSHOT, snapshot: this.state } as BaseEvent);
    if (reply) {
      const messageId = randomUUID();
      this.send({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
      // Stream the reply in small chunks for a typing effect.
      for (const chunk of reply.match(/\S+\s*/g) ?? [reply]) {
        this.send({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: chunk } as BaseEvent);
        await new Promise((r) => setTimeout(r, 12));
      }
      this.send({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    }
    this.send({ type: EventType.RUN_FINISHED, threadId: this.threadId, runId: this.runId, result, outcome } as BaseEvent);
  }

  /** Ends a run that was stopped by the user (cancel endpoint, Socket.IO, or another tab). */
  cancelled() {
    this.closeDangling();
    this.state.status = 'cancelled';
    this.send({ type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: '/status', value: 'cancelled' }] } as BaseEvent);
    this.send({ type: EventType.RUN_FINISHED, threadId: this.threadId, runId: this.runId, outcome: { type: 'cancelled' } } as BaseEvent);
  }

  fail(message: string) {
    this.send({ type: EventType.RUN_ERROR, message } as BaseEvent);
  }

  /** AG-UI clients reject RUN_FINISHED while steps/tool calls are open — close anything left over. */
  private closeDangling() {
    for (const step of this.openSteps) this.send({ type: EventType.STEP_FINISHED, stepName: step } as BaseEvent);
    this.openSteps.clear();
    this.openTools.clear();
  }
}
