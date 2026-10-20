import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Command, END, interrupt, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatOpenAI } from '@langchain/openai';
import { todayIST } from '../common/geo.js';
import { GeoService } from '../integrations/geo.service.js';
import { ImdWarningsService } from '../integrations/imd-warnings.service.js';
import { NewsService } from '../integrations/news.service.js';
import { PlacesService } from '../integrations/places.service.js';
import { TransportService } from '../integrations/transport.service.js';
import { WeatherService } from '../integrations/weather.service.js';
import {
  ACCOMMODATION_PROMPT, AGGREGATOR_PROMPT, ITINERARY_PROMPT, RESEARCH_PROMPT, SUPERVISOR_PROMPT, TRANSPORT_PROMPT,
} from './prompts.js';
import {
  AccommodationSchema, AGENT_IDS, AgentId, AggregateSchema, BookingItem, BookingRecord, BookingSummary, Itinerary, ItinerarySchema,
  Research, ResearchSchema, SupervisorDecisionSchema, Transport, TransportSchema, TravelPlan,
} from './schemas.js';
import { runSpecialist } from './specialist.js';
import { AgentEvent, RESULT_KEY, TravelState, TravelStateType, TravelStateUpdate } from './state.js';
import { buildTools } from './tools.js';

export type Emit = (e: AgentEvent) => void;

export interface RunResult {
  runId: string;
  intent: string;
  agentsRun: AgentId[];
  reply: string;
  plan: TravelPlan | null;
  planUpdated: boolean;
  errors: { agent: string; error: string }[];
  /** Set when the run paused for human approval (LangGraph interrupt / AG-UI interrupt outcome). */
  interrupt: { id: string; summary: BookingSummary } | null;
  booking: BookingRecord | null;
}

/** Payload sent when the user answers the booking approval. */
export interface BookingDecision {
  approved: boolean;
  comment?: string | null;
}

export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

const SPECIALISTS = {
  destination_research: { prompt: RESEARCH_PROMPT, schema: ResearchSchema, maxSteps: 5 },
  accommodation: { prompt: ACCOMMODATION_PROMPT, schema: AccommodationSchema, maxSteps: 4 },
  transport: { prompt: TRANSPORT_PROMPT, schema: TransportSchema, maxSteps: 4 },
  itinerary_planner: { prompt: ITINERARY_PROMPT, schema: ItinerarySchema, maxSteps: 6 },
} as const;

const text = (m: BaseMessage) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const now = () => new Date().toISOString();
const isHuman = (m: BaseMessage) => m.getType() === 'human';
const isAi = (m: BaseMessage) => m.getType() === 'ai';
const isAbort = (e: unknown, signal?: AbortSignal) => !!signal?.aborted || (e as Error)?.name === 'AbortError';

/**
 * LangGraph multi-agent workflow (see HLD):
 *
 *   START → supervisor ─┬─► destination_research ─┐
 *                       ├─► accommodation ────────┼─► supervisor ─► itinerary_planner ─► supervisor ─► aggregator → END
 *                       ├─► transport ────────────┘
 *                       └─► booking_approval (intent "book": interrupt() → wait for the user → resume) → END
 *
 * The supervisor plans the turn, then acts as a router: independent specialists fan out in
 * parallel, the itinerary planner runs once its inputs exist, and the aggregator composes the
 * final plan. Question/clarification turns end at the supervisor. State is checkpointed in
 * Postgres per thread, so refinements only re-run the agents that are affected.
 */
@Injectable()
export class TravelGraphService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TravelGraphService.name);
  private checkpointer!: PostgresSaver;
  private graph!: ReturnType<TravelGraphService['build']>;
  private readonly emitters = new Map<string, Emit>();
  private readonly tools;

  constructor(
    private readonly config: ConfigService,
    geo: GeoService,
    places: PlacesService,
    weather: WeatherService,
    transport: TransportService,
    news: NewsService,
    private readonly imd: ImdWarningsService,
  ) {
    this.tools = buildTools({ geo, places, weather, transport, news });
  }

  async onModuleInit() {
    this.checkpointer = PostgresSaver.fromConnString(this.config.getOrThrow<string>('DATABASE_URL'));
    await this.checkpointer.setup();
    this.graph = this.build();
    this.log.log('LangGraph travel workflow compiled with Postgres checkpointer');
  }

  async onModuleDestroy() {
    await this.checkpointer?.end();
  }

  get modelName() {
    return this.config.get<string>('OPENAI_MODEL') || 'gpt-4.1';
  }

  private model() {
    return new ChatOpenAI({ model: this.modelName, maxRetries: 2, timeout: 120_000 });
  }

  private emit(runId: string, e: AgentEvent) {
    this.emitters.get(runId)?.(e);
  }

  // --------------------------------------------------------------------------- graph
  private build() {
    return new StateGraph(TravelState)
      // `config.signal` carries run cancellation into every node and LLM call.
      .addNode('supervisor', (s: TravelStateType, c: LangGraphRunnableConfig) => this.supervisor(s, c.signal))
      .addNode('destination_research', (s: TravelStateType, c: LangGraphRunnableConfig) => this.specialist('destination_research', s, c.signal))
      .addNode('accommodation', (s: TravelStateType, c: LangGraphRunnableConfig) => this.specialist('accommodation', s, c.signal))
      .addNode('transport', (s: TravelStateType, c: LangGraphRunnableConfig) => this.specialist('transport', s, c.signal))
      .addNode('itinerary_planner', (s: TravelStateType, c: LangGraphRunnableConfig) => this.specialist('itinerary_planner', s, c.signal))
      .addNode('aggregator', (s: TravelStateType, c: LangGraphRunnableConfig) => this.aggregator(s, c.signal))
      .addNode('booking_approval', (s: TravelStateType) => this.bookingApproval(s))
      .addEdge(START, 'supervisor')
      .addConditionalEdges('supervisor', (s: TravelStateType) => this.route(s), [...AGENT_IDS, 'aggregator', 'booking_approval', END])
      .addEdge('destination_research', 'supervisor')
      .addEdge('accommodation', 'supervisor')
      .addEdge('transport', 'supervisor')
      .addEdge('itinerary_planner', 'supervisor')
      .addEdge('aggregator', END)
      .addEdge('booking_approval', END)
      .compile({ checkpointer: this.checkpointer });
  }

  /** Router: which node(s) run next for the current runId. Returning an array fans out in parallel. */
  private route(s: TravelStateType): string | string[] {
    const d = s.decision;
    if (d?.intent === 'book') return 'booking_approval';
    if (!d || !d.agentsToRun.length) return END;
    const pending = d.agentsToRun.filter((a) => s[RESULT_KEY[a]]?.runId !== s.runId);
    const independent = pending.filter((a) => a !== 'itinerary_planner');
    if (independent.length) return independent;
    if (pending.includes('itinerary_planner')) return 'itinerary_planner';
    return 'aggregator';
  }

  // --------------------------------------------------------------------------- supervisor
  private async supervisor(s: TravelStateType, signal?: AbortSignal): Promise<TravelStateUpdate> {
    if (s.decision?.runId === s.runId) return {}; // already planned this turn → just route
    const started = Date.now();
    this.emit(s.runId, { type: 'agent', agent: 'supervisor', status: 'running', at: now() });

    const latest = [...s.messages].reverse().find(isHuman);
    const recent = s.messages.slice(-7, -1).map((m) => `${m.getType()}: ${text(m).slice(0, 400)}`);
    const context = {
      previousRequest: s.request,
      hasExistingPlan: !!s.plan,
      existingPlanTitle: s.plan?.title ?? null,
      recentConversation: recent,
    };
    const d = await this.model()
      .withStructuredOutput(SupervisorDecisionSchema, { name: 'supervisor_decision' })
      .invoke([
        new SystemMessage(SUPERVISOR_PROMPT(todayIST())),
        new HumanMessage(`Context:\n${JSON.stringify(context, null, 1)}\n\nLatest user message:\n${latest ? text(latest) : ''}`),
      ], { signal });

    // Deterministic guard-rails on top of the LLM's routing.
    let intent = d.intent;
    let agents = new Set<AgentId>(d.agentsToRun);
    if ((intent === 'new_trip' || intent === 'refine') && !d.request.destination) intent = 'clarify';
    if (intent === 'book' && !s.plan) intent = 'clarify';
    const prev = s.request;
    const changedCore =
      !prev ||
      prev.destination?.toLowerCase() !== d.request.destination?.toLowerCase() ||
      prev.startDate !== d.request.startDate ||
      prev.endDate !== d.request.endDate ||
      prev.adults !== d.request.adults ||
      prev.children !== d.request.children;
    if (intent === 'new_trip' || (intent === 'refine' && (changedCore || !s.plan))) agents = new Set(AGENT_IDS);
    if (intent === 'refine' && agents.size === 0) agents.add('itinerary_planner');
    if (agents.size && !s.itineraryResult?.data) agents.add('itinerary_planner');
    if (agents.has('itinerary_planner') && !s.researchResult?.data) agents.add('destination_research');
    if (intent === 'question' || intent === 'clarify' || intent === 'book') agents.clear();

    const agentsToRun = AGENT_IDS.filter((a) => agents.has(a));
    this.emit(s.runId, { type: 'supervisor', intent, reasoning: d.reasoning, agents: agentsToRun, at: now() });
    this.emit(s.runId, { type: 'agent', agent: 'supervisor', status: 'done', durationMs: Date.now() - started, at: now() });
    for (const a of AGENT_IDS.filter((x) => !agents.has(x))) {
      this.emit(s.runId, { type: 'agent', agent: a, status: 'skipped', at: now() });
    }

    const reply =
      intent === 'book'
        ? null // the booking_approval node replies
        : !agentsToRun.length
          ? (intent === 'clarify' && d.intent === 'book'
              ? 'There is no plan to book yet. Tell me where and when you want to travel, and I will plan it first.'
              : d.reply ?? 'Could you tell me where in India you would like to go, and roughly when?')
          : null;
    return {
      decision: { ...d, intent, agentsToRun, runId: s.runId },
      request: d.request,
      ...(reply ? { messages: [new AIMessage(reply)] } : {}),
    };
  }

  // --------------------------------------------------------------------------- specialists
  private async specialist(agent: AgentId, s: TravelStateType, signal?: AbortSignal): Promise<TravelStateUpdate> {
    const key = RESULT_KEY[agent];
    const started = Date.now();
    const spec = SPECIALISTS[agent];
    this.emit(s.runId, { type: 'agent', agent, status: 'running', at: now() });
    try {
      const data = await runSpecialist({
        agent,
        model: this.model(),
        tools: this.tools[agent],
        systemPrompt: spec.prompt,
        task: this.taskFor(agent, s),
        schema: spec.schema,
        maxSteps: spec.maxSteps,
        emit: (e) => this.emit(s.runId, e),
        signal,
      });
      const durationMs = Date.now() - started;
      if (agent === 'itinerary_planner') this.mergeItinerary(data as Itinerary, s.itineraryResult?.data ?? null);
      if (agent === 'destination_research') await this.attachImdAlerts(data as Research, s);
      this.emit(s.runId, { type: 'agent', agent, status: 'done', durationMs, at: now() });
      this.log.log(`${agent} finished in ${durationMs} ms`);
      return { [key]: { runId: s.runId, data, error: null, durationMs } } as TravelStateUpdate;
    } catch (e) {
      if (isAbort(e, signal)) throw e; // cancellation must stop the whole run, not degrade one agent
      const error = (e as Error).message;
      this.log.error(`${agent} failed: ${error}`);
      this.emit(s.runId, { type: 'agent', agent, status: 'error', message: error, durationMs: Date.now() - started, at: now() });
      // Keep the previous result (if any) so downstream agents can still work.
      return { [key]: { runId: s.runId, data: s[key]?.data ?? null, error, durationMs: Date.now() - started } } as TravelStateUpdate;
    }
  }

  /** Official IMD warnings are attached by code (not copied by the LLM) so they are always exact. */
  private async attachImdAlerts(r: Research, s: TravelStateType) {
    const req = s.request;
    if (!req || !r.destination) return;
    const w = await this.imd.forLocation(r.destination.lat, r.destination.lon);
    const days = w?.days.filter((d) => d.date >= req.startDate && d.date <= req.endDate) ?? [];
    r.weather.alerts = days;
    r.weather.alertsSource = w && days.length ? `IMD district-wise warnings — ${w.district}, issued ${w.issuedOn}` : null;
  }

  /**
   * Guard-rail for refinements: if the planner returned only the days it changed, keep the
   * untouched days from the previous itinerary (matched by day number) so no day is lost.
   */
  private mergeItinerary(next: Itinerary, prev: Itinerary | null) {
    if (!prev || next.days.length >= prev.days.length) return;
    const changed = new Map(next.days.map((d) => [d.day, d]));
    next.days = prev.days.map((d) => changed.get(d.day) ?? d);
    for (const d of changed.values()) if (!prev.days.some((p) => p.day === d.day)) next.days.push(d);
    next.days.sort((a, b) => a.day - b.day);
  }

  private taskFor(agent: AgentId, s: TravelStateType): string {
    const instruction = s.decision?.instructions[agent] ?? null;
    const base: Record<string, unknown> = { today: todayIST(), tripRequest: s.request, supervisorInstruction: instruction };
    const research = s.researchResult?.data;
    if (agent === 'accommodation' && research) {
      base.destinationBrief = {
        destination: research.destination,
        neighbourhoods: research.neighbourhoods,
        topAttractions: research.attractions.slice(0, 8).map((a) => ({ name: a.name, lat: a.lat, lon: a.lon })),
      };
    }
    if (agent === 'itinerary_planner') {
      base.research = research
        ? {
            destination: research.destination,
            weather: research.weather,
            attractions: research.attractions,
            cuisine: research.cuisine,
            localTips: research.localTips,
          }
        : null;
      const stay = s.stayResult?.data;
      const recommended = stay?.options.find((o) => o.name === stay.recommendedOption) ?? stay?.options[0];
      base.stay = recommended ? { name: recommended.name, area: recommended.area, lat: recommended.lat, lon: recommended.lon } : null;
      const t = s.transportResult?.data;
      base.transport = t
        ? {
            outbound: t.outbound.find((o) => o.recommended) ?? t.outbound[0] ?? null,
            return: t.returnJourney.find((o) => o.recommended) ?? t.returnJourney[0] ?? null,
            localTransport: t.localTransport,
          }
        : null;
      if (s.itineraryResult?.data && s.decision?.intent === 'refine') base.previousItinerary = s.itineraryResult.data;
    }
    const latest = [...s.messages].reverse().find(isHuman);
    base.latestUserMessage = latest ? text(latest) : null;
    return `Task context (JSON):\n${JSON.stringify(base, null, 1)}`;
  }

  // --------------------------------------------------------------------------- aggregator
  private async aggregator(s: TravelStateType, signal?: AbortSignal): Promise<TravelStateUpdate> {
    const started = Date.now();
    this.emit(s.runId, { type: 'agent', agent: 'aggregator', status: 'running', at: now() });
    const r = s.researchResult?.data;
    const acc = s.stayResult?.data;
    const tr = s.transportResult?.data;
    const it = s.itineraryResult?.data;
    const input = {
      isRefinement: s.decision?.intent === 'refine',
      agentsRunThisTurn: s.decision?.agentsToRun,
      latestUserMessage: text([...s.messages].reverse().find(isHuman) ?? new HumanMessage('')),
      request: s.request,
      research: r && { destination: r.destination, overview: r.overview, weather: r.weather, safety: r.safety, permits: r.permitsAndEntry, localTips: r.localTips },
      accommodation: acc && { recommended: acc.recommendedOption, areaAdvice: acc.areaAdvice, roomsNeeded: acc.roomsNeeded, estimatedTotalINR: acc.estimatedTotalINR },
      transport: tr && {
        recommendation: tr.recommendation,
        outbound: tr.outbound.filter((o) => o.recommended),
        return: tr.returnJourney.filter((o) => o.recommended),
        estimatedTotalINR: tr.estimatedTotalINR,
      },
      itinerary: it && { days: it.days.map((d) => ({ day: d.day, date: d.date, theme: d.theme })), estimatedActivitiesAndFoodINR: it.estimatedActivitiesAndFoodINR },
      agentErrors: AGENT_IDS.map((a) => s[RESULT_KEY[a]]?.runId === s.runId && s[RESULT_KEY[a]]?.error ? `${a}: ${s[RESULT_KEY[a]]?.error}` : null).filter(Boolean),
    };
    const agg = await this.model()
      .withStructuredOutput(AggregateSchema, { name: 'final_travel_plan' })
      .invoke([new SystemMessage(AGGREGATOR_PROMPT), new HumanMessage(JSON.stringify(input, null, 1))], { signal });

    const plan: TravelPlan = {
      ...agg,
      request: s.request!,
      research: r ?? null,
      accommodation: acc ?? null,
      transport: tr ?? null,
      itinerary: it ?? null,
      generatedAt: now(),
    };
    this.emit(s.runId, { type: 'agent', agent: 'aggregator', status: 'done', durationMs: Date.now() - started, at: now() });
    return { plan, messages: [new AIMessage(agg.chatReply)] };
  }

  // --------------------------------------------------------------------------- booking approval (human in the loop)
  /**
   * Builds the booking request from the current plan and pauses the graph with interrupt().
   * When the user answers, LangGraph re-runs this node and interrupt() returns their decision.
   * No live booking/payment API exists for these providers, so approval produces a confirmed
   * booking checklist with the booking links rather than placing orders.
   */
  private async bookingApproval(s: TravelStateType): Promise<TravelStateUpdate> {
    const started = Date.now();
    this.emit(s.runId, { type: 'agent', agent: 'booking', status: 'running', message: 'Waiting for your approval', at: now() });
    const summary = this.bookingSummary(s.plan!);
    const decision = interrupt({ kind: 'booking_approval', summary }) as BookingDecision;

    const approved = !!decision?.approved;
    const record: BookingRecord = {
      status: approved ? 'approved' : 'rejected',
      interruptId: null,
      summary,
      requestedAt: s.booking?.requestedAt ?? now(),
      decidedAt: now(),
      comment: decision?.comment ?? null,
    };
    this.emit(s.runId, { type: 'agent', agent: 'booking', status: 'done', message: approved ? 'Approved' : 'Not approved', durationMs: Date.now() - started, at: now() });
    const lines = summary.items.map((i) => `- **${i.title}** — ${i.details}${i.amountINR ? ` · ₹${i.amountINR.toLocaleString('en-IN')}` : ''}${i.bookingUrl ? ` · [book](${i.bookingUrl})` : ''}`);
    const reply = approved
      ? `✅ **Booking approved** (${summary.dates}, ${summary.travellers} travellers, est. ₹${summary.totalINR.toLocaleString('en-IN')}).\n\n${lines.join('\n')}\n\n${summary.note}`
      : `Booking not approved${decision?.comment ? ` (“${decision.comment}”)` : ''}. Your plan is unchanged — tell me what to adjust, or ask to book again.`;
    return { booking: record, messages: [new AIMessage(reply)] };
  }

  private bookingSummary(plan: TravelPlan): BookingSummary {
    const r = plan.request;
    const pax = r.adults + r.children;
    const items: BookingItem[] = [];
    const acc = plan.accommodation;
    const stay = acc?.options.find((o) => o.name === acc.recommendedOption) ?? acc?.options[0];
    if (stay && acc) {
      items.push({
        kind: 'stay', title: stay.name,
        details: `${stay.area} · ${r.nights} night(s) × ${acc.roomsNeeded} room(s)`,
        amountINR: acc.estimatedTotalINR || null, bookingUrl: stay.bookingUrl,
      });
    }
    const leg = (kind: 'outbound' | 'return', list?: Transport['outbound']) => {
      const o = list?.find((x) => x.recommended) ?? list?.[0];
      if (!o) return;
      items.push({
        kind, title: `${kind === 'outbound' ? 'Outbound' : 'Return'}: ${o.title}`,
        details: `${o.mode} · ${o.durationText} · ${pax} traveller(s)${o.isLiveData ? '' : ' · estimated fare'}`,
        amountINR: o.pricePerPersonINR != null ? o.pricePerPersonINR * pax : null, bookingUrl: o.bookingUrl,
      });
    };
    leg('outbound', plan.transport?.outbound);
    leg('return', plan.transport?.returnJourney);
    return {
      tripTitle: plan.title,
      dates: `${r.startDate} → ${r.endDate}`,
      travellers: pax,
      items,
      totalINR: items.reduce((t, i) => t + (i.amountINR ?? 0), 0),
      note: 'Prices are estimates or indicative fares. Complete each booking and payment on the linked site — this planner does not charge you or place orders.',
    };
  }

  // --------------------------------------------------------------------------- public API
  private runConfig(threadId: string, runId: string, signal?: AbortSignal) {
    return {
      configurable: { thread_id: threadId }, recursionLimit: 30, runName: 'travel-planner', tags: ['travel-planner'],
      metadata: { threadId, runId }, signal,
    };
  }

  /** One conversational turn. Throws RunCancelledError if `signal` aborts. */
  async run(threadId: string, message: string, emit: Emit, signal?: AbortSignal): Promise<RunResult> {
    const runId = randomUUID();
    this.emitters.set(runId, emit);
    try {
      const final = (await this.graph.invoke(
        { messages: [new HumanMessage(message)], runId, booking: null },
        this.runConfig(threadId, runId, signal),
      )) as TravelStateType & { __interrupt__?: { id: string; value: any }[] };
      return this.toResult(runId, final);
    } catch (e) {
      if (isAbort(e, signal)) throw new RunCancelledError();
      throw e;
    } finally {
      this.emitters.delete(runId);
    }
  }

  /** Answers a pending booking approval (LangGraph Command({ resume })). */
  async resume(threadId: string, decision: BookingDecision, emit: Emit, signal?: AbortSignal): Promise<RunResult> {
    const config = { configurable: { thread_id: threadId } };
    const snapshot = await this.graph.getState(config);
    const pending = snapshot.tasks.flatMap((t) => t.interrupts ?? []);
    if (!pending.length) throw new Error('There is no booking waiting for approval on this trip.');
    const runId = (snapshot.values as TravelStateType).runId;
    this.emitters.set(runId, emit);
    try {
      const final = (await this.graph.invoke(new Command({ resume: decision }) as any, this.runConfig(threadId, runId, signal))) as TravelStateType & {
        __interrupt__?: { id: string; value: any }[];
      };
      return this.toResult(runId, final);
    } catch (e) {
      if (isAbort(e, signal)) throw new RunCancelledError();
      throw e;
    } finally {
      this.emitters.delete(runId);
    }
  }

  private toResult(runId: string, final: TravelStateType & { __interrupt__?: { id: string; value: any }[] }): RunResult {
    const agentsRun = final.decision?.agentsToRun ?? [];
    const lastAi = [...final.messages].reverse().find(isAi);
    const pending = final.__interrupt__?.[0];
    const intr = pending ? { id: pending.id, summary: pending.value?.summary as BookingSummary } : null;
    const booking: BookingRecord | null = intr
      ? { status: 'awaiting_approval', interruptId: intr.id, summary: intr.summary, requestedAt: now(), decidedAt: null, comment: null }
      : final.booking;
    return {
      runId,
      intent: final.decision?.intent ?? 'unknown',
      agentsRun,
      reply: intr ? 'Please review the bookings below and approve or reject them.' : lastAi ? text(lastAi) : '',
      plan: final.plan,
      planUpdated: agentsRun.length > 0,
      errors: AGENT_IDS.filter((a) => final[RESULT_KEY[a]]?.runId === runId && final[RESULT_KEY[a]]?.error).map((a) => ({
        agent: a,
        error: final[RESULT_KEY[a]]!.error!,
      })),
      interrupt: intr,
      booking,
    };
  }
}
