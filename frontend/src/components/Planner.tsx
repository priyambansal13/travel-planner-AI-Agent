'use client';

import { HttpAgent, type AgentSubscriber, type RunAgentParameters } from '@ag-ui/client';
import { BadgeCheck, CircleAlert, CircleStop, MessagesSquare, PlusCircle, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { API_URL, api } from '@/lib/api';
import type { AgentKey, AgentStatus, BookingRecord, BookingSummary, ChatEntry, Health, TravelPlan } from '@/lib/types';
import { ActivityFeed, type ToolActivity } from './ActivityFeed';
import { AgentFlow, type AgentRuntime } from './AgentFlow';
import { ApprovalCard } from './ApprovalCard';
import { ChatPanel } from './ChatPanel';
import { PlanView } from './plan/PlanView';
import { EXAMPLES, TripForm } from './TripForm';

const AGENTS: AgentKey[] = ['supervisor', 'destination_research', 'itinerary_planner', 'accommodation', 'transport', 'aggregator', 'booking'];
const idleRuntime = () => Object.fromEntries(AGENTS.map((a) => [a, { status: 'idle', tools: 0 }])) as Record<AgentKey, AgentRuntime>;

const REFINEMENTS = ['Make day 2 more relaxed', 'Show cheaper stays', 'What if we go by train?', 'Add a food walk'];

/** Shared state streamed by the backend's AG-UI endpoint (STATE_SNAPSHOT / STATE_DELTA). */
interface TripAgentState {
  threadId: string;
  tripId: string | null;
  status: 'running' | 'done' | 'awaiting_approval' | 'cancelled' | 'error';
  intent: string | null;
  reasoning: string | null;
  agents: Record<AgentKey, { status: AgentStatus; durationMs: number | null; tools: number; message: string | null }>;
  plan: TravelPlan | null;
  booking: BookingRecord | null;
}

/** An open AG-UI interrupt (booking approval) that the next run must answer. */
interface PendingApproval { interruptId: string; summary: BookingSummary }

const newAgent = (threadId?: string) => new HttpAgent({ url: `${API_URL}/api/agui`, threadId: threadId ?? crypto.randomUUID() });

export function Planner() {
  const params = useSearchParams();
  const [threadId, setThreadId] = useState<string | null>(params.get('thread'));
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [plan, setPlan] = useState<TravelPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState(idleRuntime);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [supervisor, setSupervisor] = useState<{ intent: string; reasoning: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [mode, setMode] = useState<'form' | 'chat'>('form');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const agentRef = useRef<HttpAgent | null>(null);
  const stoppingRef = useRef(false);

  // Restore an existing trip when opened via /?thread=…
  useEffect(() => {
    api.health().then(setHealth).catch(() => setError(`Backend not reachable at ${API_URL}. Start the NestJS API.`));
    const t = params.get('thread');
    if (t) {
      agentRef.current = newAgent(t);
      api.trip(t).then((trip) => {
        setMessages(trip.conversation);
        setPlan(trip.plan);
        setBooking(trip.booking);
        if (trip.booking?.status === 'awaiting_approval' && trip.booking.interruptId) {
          setPendingApproval({ interruptId: trip.booking.interruptId, summary: trip.booking.summary });
        }
        setMode('chat');
      }).catch(() => setThreadId(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** AG-UI event subscriber: maps protocol events onto the UI. */
  const subscriber: AgentSubscriber = {
    onStateChanged: ({ state }) => {
      const s = state as TripAgentState;
      if (!s?.agents) return;
      setRuntime(Object.fromEntries(AGENTS.map((a) => [a, {
        status: s.agents[a].status, tools: s.agents[a].tools, durationMs: s.agents[a].durationMs ?? undefined, message: s.agents[a].message ?? undefined,
      }])) as Record<AgentKey, AgentRuntime>);
      setSupervisor(s.intent ? { intent: s.intent, reasoning: s.reasoning ?? '' } : null);
      if (s.plan) setPlan(s.plan);
      setBooking(s.booking ?? null);
    },
    onToolCallStartEvent: ({ event }) => {
      setTools((t) => [...t, { id: event.toolCallId, agent: (event.metadata?.agent ?? 'supervisor') as AgentKey, tool: event.toolCallName, status: 'running' }]);
    },
    onToolCallEndEvent: ({ event, toolCallArgs }) => {
      setTools((t) => t.map((x) => (x.id === event.toolCallId ? { ...x, input: toolCallArgs } : x)));
    },
    onToolCallResultEvent: ({ event }) => {
      const ok = event.metadata?.ok !== false;
      setTools((t) => t.map((x) => (x.id === event.toolCallId
        ? { ...x, status: ok ? 'ok' : 'error', durationMs: event.metadata?.durationMs, preview: typeof event.content === 'string' ? event.content : '' }
        : x)));
    },
    onTextMessageContentEvent: ({ textMessageBuffer }) => {
      // Streamed assistant reply: grow the last assistant bubble as chunks arrive.
      setMessages((m) => {
        const last = m.at(-1);
        if (last?.role === 'assistant' && last.at === 'streaming') return [...m.slice(0, -1), { ...last, content: textMessageBuffer }];
        return [...m, { role: 'assistant', content: textMessageBuffer, at: 'streaming' }];
      });
    },
    onTextMessageEndEvent: () => {
      setMessages((m) => m.map((x) => (x.at === 'streaming' ? { ...x, at: new Date().toISOString() } : x)));
    },
    onRunFinishedEvent: ({ event }) => {
      const r = event.result as { errors?: { agent: string; error: string }[] } | undefined;
      if (r?.errors?.length) setError(`Some agents had problems: ${r.errors.map((x) => `${x.agent} (${x.error.slice(0, 120)})`).join('; ')}`);
      const outcome = event.outcome;
      if (outcome?.type === 'interrupt') {
        // Human in the loop: the booking_approval node paused the graph and is waiting for an answer.
        const intr = outcome.interrupts[0];
        setPendingApproval({ interruptId: intr.id, summary: intr.metadata?.summary as BookingSummary });
      } else if (outcome?.type === 'cancelled') {
        addNote('⏹ Planning stopped. Your previous plan is unchanged.');
      }
      setMode('chat');
    },
    onRunErrorEvent: ({ event }) => {
      if (!stoppingRef.current) setError(event.message); // abortRun() emits a local RUN_ERROR when the user presses Stop
    },
    onRunFailed: ({ error: err }) => {
      if (!stoppingRef.current) setError(`AG-UI run failed: ${err.message}`);
    },
  };

  const addNote = (content: string) => setMessages((m) => [...m, { role: 'assistant', content, at: new Date().toISOString() }]);

  /** Starts one AG-UI run (a new message and/or answers to open interrupts). */
  const runTurn = async (params: RunAgentParameters, userText: string | null) => {
    if (!agentRef.current) agentRef.current = newAgent(threadId ?? undefined);
    const agent = agentRef.current;
    setThreadId(agent.threadId);
    window.history.replaceState(null, '', `/?thread=${agent.threadId}`);
    setError(null);
    setBusy(true);
    stoppingRef.current = false;
    setRuntime(idleRuntime());
    setTools([]);
    setSupervisor(null);
    // The server keeps the authoritative conversation in its LangGraph checkpoint, so only the plain
    // user/assistant text history is sent back — not the previous runs' tool-call messages.
    agent.setMessages(agent.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content));
    if (userText) {
      setMessages((m) => [...m, { role: 'user', content: userText, at: new Date().toISOString() }]);
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: userText });
    }
    try {
      await agent.runAgent(params, subscriber);
    } catch (e) {
      if (!stoppingRef.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (message: string) => {
    // AG-UI requires every open interrupt to be answered: a new message dismisses a pending approval.
    const resume = pendingApproval ? [{ interruptId: pendingApproval.interruptId, status: 'cancelled' as const }] : undefined;
    setPendingApproval(null);
    await runTurn(resume ? { resume } : {}, message);
  };

  /** Answers the booking approval interrupt (AG-UI resume). */
  const decide = async (approved: boolean, comment: string) => {
    if (!pendingApproval) return;
    const { interruptId } = pendingApproval;
    setPendingApproval(null);
    setMessages((m) => [...m, { role: 'user', content: approved ? '✅ Approve booking' : `✖️ Reject booking${comment ? `: ${comment}` : ''}`, at: new Date().toISOString() }]);
    await runTurn({ resume: [{ interruptId, status: 'resolved', payload: { approved, comment: comment || undefined } }] }, null);
  };

  /** Stops the agents: aborts the SSE request (server cancels on disconnect) and calls the cancel endpoint. */
  const stop = () => {
    stoppingRef.current = true;
    agentRef.current?.abortRun();
    if (threadId) void api.cancelRun(threadId);
    setBusy(false);
    setRuntime((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status === 'running' ? { ...v, status: 'error', message: 'Stopped' } : v])) as Record<AgentKey, AgentRuntime>);
    addNote('⏹ Planning stopped. Your previous plan is unchanged.');
  };

  const newTrip = () => {
    if (busy) stop();
    agentRef.current = null;
    setThreadId(null);
    setPendingApproval(null);
    setBooking(null);
    setMessages([]);
    setPlan(null);
    setRuntime(idleRuntime());
    setTools([]);
    setSupervisor(null);
    setMode('form');
    window.history.replaceState(null, '', '/');
  };

  const showFlow = busy || tools.length > 0 || supervisor;

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[380px_1fr]">
      {/* Left: input */}
      <aside className="lg:sticky lg:top-[72px] lg:h-[calc(100vh-92px)]">
        <div className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-1 rounded-lg bg-stone-100 p-1 text-sm">
            <button onClick={() => setMode('form')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium ${mode === 'form' ? 'bg-white shadow-sm' : 'text-stone-500'}`}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Trip details
            </button>
            <button onClick={() => setMode('chat')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium ${mode === 'chat' ? 'bg-white shadow-sm' : 'text-stone-500'}`}>
              <MessagesSquare className="h-3.5 w-3.5" /> Chat {messages.length > 0 && <span className="text-[10px] text-stone-400">({messages.length})</span>}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {mode === 'form' ? (
              <TripForm onSubmit={send} disabled={busy} />
            ) : (
              <ChatPanel messages={messages} busy={busy} onSend={send} suggestions={plan ? REFINEMENTS : messages.length ? [] : EXAMPLES} />
            )}
          </div>
          {threadId && (
            <button onClick={newTrip} className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
              <PlusCircle className="h-3.5 w-3.5" /> Start a new trip
            </button>
          )}
        </div>
      </aside>

      {/* Right: orchestration + plan */}
      <section className="min-w-0 space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {!plan && !showFlow && (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Plan your next Indian journey with a team of AI agents</h1>
            <p className="mt-2 max-w-2xl text-stone-600">
              A LangGraph supervisor coordinates specialist agents for destination research, stays, transport and day-wise itineraries,
              calling live Indian data sources, then an aggregator assembles a personalised, budgeted plan you can refine by chat.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {EXAMPLES.map((ex) => (
                <button key={ex} disabled={busy} onClick={() => send(ex)} className="rounded-xl border border-stone-200 p-3 text-left text-[13px] text-stone-700 transition hover:border-saffron-400 hover:bg-saffron-50/40">
                  {ex}
                </button>
              ))}
            </div>
            {health && (
              <div className="mt-6 rounded-xl bg-stone-50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-stone-700">Data sources</span>
                  <span className={`rounded-full px-2 py-0.5 ${health.llm.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {health.llm.provider} {health.llm.model} {health.llm.configured ? '✓' : '— OPENAI_API_KEY missing'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${health.observability.langsmith ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-600'}`}>
                    LangSmith {health.observability.langsmith ? 'tracing on' : 'off'}
                  </span>
                </div>
                <div className="grid gap-x-6 gap-y-1 text-[12px] text-stone-600 sm:grid-cols-2">
                  {Object.entries(health.providers).map(([k, v]) => (
                    <div key={k}><span className="font-medium capitalize text-stone-800">{k.replace(/([A-Z])/g, ' $1')}:</span> {v}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {busy && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
            <span>Agents are working on your trip — live over AG-UI.</span>
            <button onClick={stop} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1 font-medium text-blue-700 hover:bg-blue-100">
              <CircleStop className="h-4 w-4" /> Stop
            </button>
          </div>
        )}

        {pendingApproval && <ApprovalCard summary={pendingApproval.summary} busy={busy} onDecide={decide} />}

        {showFlow && (
          <div className="grid gap-4 2xl:grid-cols-[1.5fr_1fr]">
            <AgentFlow runtime={runtime} intent={supervisor?.intent} reasoning={supervisor?.reasoning} compact={!busy && !!plan} />
            <ActivityFeed items={tools} />
          </div>
        )}

        {plan && !busy && !pendingApproval && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm">
            {booking?.status === 'approved' ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <BadgeCheck className="h-4 w-4" /> Booking approved {booking.decidedAt ? `on ${new Date(booking.decidedAt).toLocaleString('en-IN')}` : ''} — complete payment via the links in the chat.
              </span>
            ) : (
              <span className="text-stone-600">Happy with this plan? Review the bookings and approve them before anything is booked.</span>
            )}
            {booking?.status !== 'approved' && (
              <button onClick={() => send('Book this trip')} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700">
                Book this trip
              </button>
            )}
          </div>
        )}

        {plan && <PlanView plan={plan} />}
      </section>
    </div>
  );
}
