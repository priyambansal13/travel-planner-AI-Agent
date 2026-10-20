/**
 * AG-UI event-sequence contract test.
 *
 * Replays realistic agent/tool progress through AguiRun and validates the resulting stream with
 * the official AG-UI client verifier (`verifyEvents` from @ag-ui/client) — the same checks a
 * browser HttpAgent applies. Re-run on every @ag-ui/* upgrade:  pnpm test:agui
 */
import { verifyEvents } from '@ag-ui/client';
import { type BaseEvent, EventType } from '@ag-ui/core';
import { from, lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../agents/state.js';
import type { BookingRecord, BookingSummary } from '../agents/schemas.js';
import { AguiRun, initialState } from './agui-run.js';

const at = () => new Date().toISOString();
const agent = (a: string, status: 'running' | 'done' | 'error' | 'skipped', extra: Partial<AgentEvent> = {}): AgentEvent =>
  ({ type: 'agent', agent: a, status, at: at(), ...extra }) as AgentEvent;
const toolStart = (a: string, callId: string, tool: string): AgentEvent =>
  ({ type: 'tool', agent: a, callId, tool, phase: 'start', input: { q: tool }, at: at() }) as AgentEvent;
const toolEnd = (a: string, callId: string, tool: string, ok = true): AgentEvent =>
  ({ type: 'tool', agent: a, callId, tool, phase: 'end', ok, durationMs: 12, preview: '{"ok":true}', at: at() }) as AgentEvent;

const SUMMARY: BookingSummary = {
  tripTitle: 'Weekend in Rishikesh', dates: '2026-10-23 → 2026-10-25', travellers: 3, totalINR: 9000,
  items: [{ kind: 'stay', title: 'Riverside Homestay', details: 'Tapovan · 2 nights', amountINR: 6000, bookingUrl: null }],
  note: 'Estimates only.',
};

function newRun() {
  const events: BaseEvent[] = [];
  const run = new AguiRun((e) => events.push(e), 'thread-1', 'run-1', initialState('thread-1', null, null));
  run.start();
  return { run, events };
}

/** Emits a full planning turn: supervisor, three parallel specialists with parallel tools, itinerary, aggregator. */
function planningTurn(run: AguiRun) {
  const e = (x: AgentEvent) => run.onAgentEvent(x);
  e(agent('supervisor', 'running'));
  e({ type: 'supervisor', intent: 'new_trip', reasoning: 'New trip', agents: ['destination_research', 'accommodation', 'transport', 'itinerary_planner'], at: at() });
  e(agent('supervisor', 'done', { durationMs: 900 }));
  for (const a of ['destination_research', 'accommodation', 'transport']) e(agent(a, 'running'));
  // interleaved, parallel tool calls across agents
  e(toolStart('transport', 't1', 'search_trains'));
  e(toolStart('transport', 't2', 'search_flights'));
  e(toolStart('destination_research', 'r1', 'geocode_place'));
  e(toolEnd('transport', 't2', 'search_flights'));
  e(toolStart('accommodation', 'a1', 'search_hotels'));
  e(toolEnd('destination_research', 'r1', 'geocode_place'));
  e(toolEnd('transport', 't1', 'search_trains'));
  e(agent('transport', 'done', { durationMs: 1000 }));
  e(toolEnd('accommodation', 'a1', 'search_hotels', false)); // a failed tool call is still a valid sequence
  e(agent('accommodation', 'done', { durationMs: 1200 }));
  e(agent('destination_research', 'done', { durationMs: 1500 }));
  e(agent('itinerary_planner', 'running'));
  e(toolStart('itinerary_planner', 'i1', 'optimize_day_route'));
  e(toolEnd('itinerary_planner', 'i1', 'optimize_day_route'));
  e(agent('itinerary_planner', 'done', { durationMs: 800 }));
  e(agent('aggregator', 'running'));
  e(agent('aggregator', 'done', { durationMs: 400 }));
}

const verify = (events: BaseEvent[]) => lastValueFrom(from(events).pipe(verifyEvents(false), toArray()));
const types = (events: BaseEvent[]) => events.map((e) => e.type);
const last = (events: BaseEvent[]) => events.at(-1) as BaseEvent & { outcome?: { type: string } };

describe('AG-UI event sequence (AguiRun → @ag-ui/client verifyEvents)', () => {
  it('full planning run with parallel agents and tool calls is valid', async () => {
    const { run, events } = newRun();
    planningTurn(run);
    await run.finish('Here is your plan.', 'trip-1', null, null, { tripId: 'trip-1' });
    await expect(verify(events)).resolves.toHaveLength(events.length);
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(last(events).type).toBe(EventType.RUN_FINISHED);
    expect(last(events).outcome?.type).toBe('success');
    expect(types(events).filter((t) => t === EventType.STEP_STARTED)).toHaveLength(6);
    expect(types(events).filter((t) => t === EventType.STEP_FINISHED)).toHaveLength(6);
    expect(types(events).filter((t) => t === EventType.TOOL_CALL_RESULT)).toHaveLength(5);
    expect(types(events)).toContain(EventType.TEXT_MESSAGE_CONTENT);
  });

  it('refinement with skipped agents is valid', async () => {
    const { run, events } = newRun();
    run.onAgentEvent(agent('supervisor', 'running'));
    run.onAgentEvent(agent('supervisor', 'done'));
    for (const a of ['destination_research', 'accommodation', 'transport']) run.onAgentEvent(agent(a, 'skipped'));
    run.onAgentEvent(agent('itinerary_planner', 'running'));
    run.onAgentEvent(agent('itinerary_planner', 'done'));
    await run.finish('Updated day 2.', 'trip-1', null, null, {});
    await expect(verify(events)).resolves.toBeDefined();
  });

  it('an agent error mid-run still produces a valid stream', async () => {
    const { run, events } = newRun();
    run.onAgentEvent(agent('supervisor', 'running'));
    run.onAgentEvent(agent('supervisor', 'done'));
    run.onAgentEvent(agent('transport', 'running'));
    run.onAgentEvent(toolStart('transport', 't1', 'search_trains'));
    run.onAgentEvent(toolEnd('transport', 't1', 'search_trains', false));
    run.onAgentEvent(agent('transport', 'error', { message: 'LLM timeout' }));
    await run.finish('Partial plan.', 'trip-1', null, null, { errors: [{ agent: 'transport' }] });
    await expect(verify(events)).resolves.toBeDefined();
  });

  it('booking approval ends with an interrupt outcome (open step is closed first)', async () => {
    const { run, events } = newRun();
    run.onAgentEvent(agent('supervisor', 'running'));
    run.onAgentEvent(agent('supervisor', 'done'));
    run.onAgentEvent(agent('booking', 'running', { message: 'Waiting for your approval' })); // node paused by interrupt()
    const booking: BookingRecord = {
      status: 'awaiting_approval', interruptId: 'int-1', summary: SUMMARY, requestedAt: at(), decidedAt: null, comment: null,
    };
    await run.finish('Please approve.', 'trip-1', null, booking, {}, {
      type: 'interrupt',
      interrupts: [{ id: 'int-1', reason: 'booking_approval', message: 'Approve?', metadata: { summary: SUMMARY } }],
    });
    await expect(verify(events)).resolves.toBeDefined();
    expect(last(events).outcome?.type).toBe('interrupt');
    const snapshot = [...events].reverse().find((e) => e.type === EventType.STATE_SNAPSHOT) as any;
    expect(snapshot.snapshot.status).toBe('awaiting_approval');
    expect(snapshot.snapshot.agents.booking.status).toBe('waiting');
  });

  it('cancellation mid-run ends with a cancelled outcome', async () => {
    const { run, events } = newRun();
    run.onAgentEvent(agent('supervisor', 'running'));
    run.onAgentEvent(agent('supervisor', 'done'));
    run.onAgentEvent(agent('destination_research', 'running'));
    run.onAgentEvent(toolStart('destination_research', 'r1', 'get_weather_forecast')); // result never arrives
    run.cancelled();
    await expect(verify(events)).resolves.toBeDefined();
    expect(last(events).outcome?.type).toBe('cancelled');
  });

  it('a failed run ends with RUN_ERROR', async () => {
    const { run, events } = newRun();
    run.onAgentEvent(agent('supervisor', 'running'));
    run.fail('OpenAI unavailable');
    await expect(verify(events)).resolves.toBeDefined();
    expect(last(events).type).toBe(EventType.RUN_ERROR);
  });

  it('control: the verifier rejects a malformed stream', async () => {
    const bad = [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'x', delta: '{}' }, // ARGS without START
    ] as BaseEvent[];
    await expect(verify(bad)).rejects.toThrow();
  });
});
