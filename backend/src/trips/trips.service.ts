import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import type { AgentEvent } from '../agents/state.js';
import { BookingDecision, Emit, RunCancelledError, RunResult, TravelGraphService } from '../agents/travel-graph.service.js';
import { Trip } from './trip.entity.js';

export const PlanInputSchema = z.object({
  threadId: z.string().min(8).max(64).optional(),
  message: z.string().trim().min(2).max(4000),
});
export type PlanInput = z.infer<typeof PlanInputSchema>;

export const ApprovalInputSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(1000).nullish(),
});

const MAX_EVENTS_PER_RUN = 400;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export { RunCancelledError };

/**
 * Persists trips and runs graph turns for every channel (AG-UI, REST, Socket.IO).
 * One run per thread at a time; each run gets an AbortController so any channel can cancel it.
 */
@Injectable()
export class TripsService {
  private readonly log = new Logger(TripsService.name);
  private readonly running = new Map<string, AbortController>();

  constructor(
    @InjectRepository(Trip) private readonly repo: Repository<Trip>,
    private readonly graph: TravelGraphService,
  ) {}

  list() {
    return this.repo.find({
      select: { id: true, threadId: true, title: true, destination: true, status: true, version: true, request: true, createdAt: true, updatedAt: true },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  async get(id: string) {
    const trip = await this.repo.findOne({ where: isUuid(id) ? [{ id }, { threadId: id }] : { threadId: id } });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  findByThread(threadId: string) {
    return this.repo.findOne({ where: { threadId } });
  }

  async remove(id: string) {
    const trip = await this.get(id);
    this.cancel(trip.threadId);
    await this.repo.remove(trip);
    return { deleted: true };
  }

  isRunning(threadId: string) {
    return this.running.has(threadId);
  }

  /** Stops the active run on a thread (any channel). Returns whether a run was cancelled. */
  cancel(threadId: string): boolean {
    const ctrl = this.running.get(threadId);
    if (!ctrl) return false;
    ctrl.abort();
    this.log.log(`thread ${threadId}: cancellation requested`);
    return true;
  }

  /** Runs one conversational turn through the multi-agent graph and persists the outcome. */
  plan(input: PlanInput, emit: Emit = () => {}, signal?: AbortSignal) {
    const threadId = input.threadId ?? randomUUID();
    return this.execute(threadId, input.message, emit, signal, (s, e) => this.graph.run(threadId, input.message, e, s));
  }

  /** Answers the pending booking approval of a trip (human in the loop). */
  async resume(threadId: string, decision: BookingDecision, emit: Emit = () => {}, signal?: AbortSignal) {
    const trip = await this.findByThread(threadId);
    if (!trip || trip.booking?.status !== 'awaiting_approval') {
      throw new BadRequestException('This trip has no booking waiting for approval.');
    }
    const note = decision.approved ? 'Approve booking' : `Reject booking${decision.comment ? `: ${decision.comment}` : ''}`;
    return this.execute(threadId, note, emit, signal, (s, e) => this.graph.resume(threadId, decision, e, s));
  }

  /** Marks a pending approval as dismissed without running the graph (e.g. an AG-UI client cancelled the interrupt). */
  async dismissApproval(threadId: string) {
    const trip = await this.findByThread(threadId);
    if (trip?.booking?.status === 'awaiting_approval') {
      trip.booking = { ...trip.booking, status: 'dismissed', decidedAt: new Date().toISOString() };
      trip.status = trip.plan ? 'ready' : 'needs_input';
      await this.repo.save(trip);
    }
    return trip;
  }

  private async execute(
    threadId: string,
    userText: string,
    emit: Emit,
    externalSignal: AbortSignal | undefined,
    runGraph: (signal: AbortSignal, emit: Emit) => Promise<RunResult>,
  ): Promise<{ trip: Trip; result: RunResult }> {
    if (this.running.has(threadId)) throw new ConflictException('This trip is already being planned — please wait or cancel it.');
    const ctrl = new AbortController();
    const onExternalAbort = () => ctrl.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    if (externalSignal?.aborted) ctrl.abort();
    this.running.set(threadId, ctrl);

    const started = Date.now();
    const events: AgentEvent[] = [];
    const at = () => new Date().toISOString();
    let trip = (await this.repo.findOne({ where: { threadId } })) ?? this.repo.create({ threadId, conversation: [], runs: [] });
    try {
      trip.conversation = [...trip.conversation, { role: 'user', content: userText, at: at() }];
      trip.status = 'planning';
      trip = await this.repo.save(trip);

      let result: RunResult;
      try {
        result = await runGraph(ctrl.signal, (e) => {
          if (events.length < MAX_EVENTS_PER_RUN) events.push(e);
          emit(e);
        });
      } catch (e) {
        const cancelled = e instanceof RunCancelledError;
        trip.status = !cancelled ? 'error' : trip.booking?.status === 'awaiting_approval' ? 'awaiting_approval' : trip.plan ? 'ready' : 'needs_input';
        trip.conversation = [...trip.conversation, { role: 'assistant', content: cancelled ? '⏹ Planning stopped. Your previous plan is unchanged.' : `⚠️ ${(e as Error).message}`, at: at() }];
        trip.runs = [...trip.runs, {
          runId: 'n/a', intent: cancelled ? 'cancelled' : 'error', agentsRun: [], durationMs: Date.now() - started,
          errors: cancelled ? [] : [{ agent: 'graph', error: (e as Error).message }], events, at: at(),
        }];
        await this.repo.save(trip);
        throw e;
      }

      trip.conversation = [...trip.conversation, { role: 'assistant', content: result.reply, at: at() }];
      trip.runs = [...trip.runs, {
        runId: result.runId, intent: result.intent, agentsRun: result.agentsRun, durationMs: Date.now() - started,
        errors: result.errors, events, at: at(),
      }];
      if (result.planUpdated && result.plan) {
        trip.plan = result.plan;
        trip.request = result.plan.request;
        trip.title = result.plan.title;
        trip.destination = result.plan.research?.destination.name ?? result.plan.request.destination;
        trip.version += 1;
        trip.booking = null; // an approval refers to the previous version of the plan
      }
      if (result.booking) trip.booking = result.booking;
      else if (trip.booking?.status === 'awaiting_approval') {
        // A new message on an interrupted thread supersedes the pending approval (LangGraph drops the interrupt).
        trip.booking = { ...trip.booking, status: 'dismissed', decidedAt: at() };
      }
      trip.status = result.interrupt ? 'awaiting_approval' : trip.plan ? 'ready' : 'needs_input';
      trip = await this.repo.save(trip);
      this.log.log(`thread ${threadId}: ${result.intent} [${result.agentsRun.join(', ')}]${result.interrupt ? ' → awaiting approval' : ''} in ${Date.now() - started} ms`);
      return { trip, result };
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.running.delete(threadId);
    }
  }
}
