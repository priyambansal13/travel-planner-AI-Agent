import { Body, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { BaseEvent } from '@ag-ui/core';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import { EventEncoder } from '@ag-ui/encoder';
import type { Request, Response } from 'express';
import type { RunResult } from '../agents/travel-graph.service.js';
import { AguiStreamDoc, RunAgentInputDoc } from '../common/openapi.js';
import type { Trip } from '../trips/trip.entity.js';
import { RunCancelledError, TripsService } from '../trips/trips.service.js';
import { AguiRun, initialState, RunOutcome } from './agui-run.js';

/** JSON schema the client should answer a booking interrupt with (sent in Interrupt.responseSchema). */
const BOOKING_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['approved'],
  properties: { approved: { type: 'boolean' }, comment: { type: 'string' } },
};

/**
 * AG-UI (Agent–User Interaction protocol) endpoint.
 * POST /api/agui with a RunAgentInput → Server-Sent Events stream of AG-UI events.
 *
 *  - Normal run: the last user message is planned/refined on the thread (`threadId`).
 *  - Human in the loop: a "book" request ends with RUN_FINISHED outcome `interrupt`; the client answers with
 *    `resume: [{ interruptId, status: 'resolved', payload: { approved, comment } }]` in the next run.
 *    `status: 'cancelled'` dismisses the approval (and plans the new user message, if one was sent).
 *  - Cancellation: closing the request (client abort) or POST /api/trips/{id}/cancel stops the agents;
 *    the stream ends with RUN_FINISHED outcome `cancelled` when it is still open.
 */
@ApiTags('AG-UI')
@Controller('agui')
export class AguiController {
  private readonly log = new Logger(AguiController.name);
  constructor(private readonly trips: TripsService) {}

  @Post()
  @ApiOperation({
    summary: 'Run the travel agents over the AG-UI protocol (SSE)',
    description:
      'Accepts an AG-UI RunAgentInput and streams AG-UI events (text/event-stream). The AG-UI threadId is the trip thread. ' +
      'Supports interrupts (booking approval → resume) and cancellation (client abort or POST /api/trips/{id}/cancel). ' +
      'Swagger UI cannot render streams — use curl -N or an AG-UI client such as @ag-ui/client HttpAgent.',
  })
  @ApiBody({ schema: RunAgentInputDoc })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: AguiStreamDoc, content: { 'text/event-stream': { schema: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid RunAgentInput or no user message' })
  async run(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const parsed = RunAgentInputSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid RunAgentInput', issues: parsed.error.issues.slice(0, 5) });
      return;
    }
    const input = parsed.data;
    const resumeEntry = input.resume?.[0];
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const content = lastUser && 'content' in lastUser ? lastUser.content : undefined;
    const text = (typeof content === 'string' ? content : (content ?? []).map((p: any) => (p.type === 'text' ? p.text : '')).join('\n')).trim();
    if (!resumeEntry && !text) {
      res.status(400).json({ error: 'RunAgentInput.messages must end with a user message (or include resume entries)' });
      return;
    }

    const encoder = new EventEncoder({ accept: req.headers.accept });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Client disconnect (e.g. HttpAgent.abortRun()) cancels the agents.
    const abort = new AbortController();
    let finished = false;
    let closed = false;
    res.on('close', () => {
      closed = true;
      if (!finished) abort.abort();
    });
    const send = (e: BaseEvent) => {
      if (!closed) res.write(encoder.encode(e));
    };
    // SSE comment lines keep proxies from timing out during long agent steps; AG-UI clients ignore them.
    const keepalive = setInterval(() => !closed && res.write(': keepalive\n\n'), 15_000);

    const existing = await this.trips.findByThread(input.threadId);
    const run = new AguiRun(send, input.threadId, input.runId, initialState(input.threadId, existing?.id ?? null, existing?.plan ?? null, existing?.booking ?? null));
    run.start();
    try {
      const emit = (e: Parameters<AguiRun['onAgentEvent']>[0]) => run.onAgentEvent(e);
      let out: { trip: Trip; result: RunResult } | null = null;

      if (resumeEntry?.status === 'resolved') {
        const p = (resumeEntry.payload ?? {}) as { approved?: boolean; comment?: string };
        out = await this.trips.resume(input.threadId, { approved: !!p.approved, comment: p.comment ?? null }, emit, abort.signal);
      } else if (resumeEntry?.status === 'cancelled') {
        const lastSaved = existing?.conversation.filter((c) => c.role === 'user').at(-1)?.content;
        if (text && text !== lastSaved) {
          // New message alongside a dismissed interrupt: plan it (LangGraph drops the pending interrupt).
          out = await this.trips.plan({ threadId: input.threadId, message: text.slice(0, 4000) }, emit, abort.signal);
        } else {
          const trip = await this.trips.dismissApproval(input.threadId);
          finished = true;
          await run.finish('Booking approval dismissed. Your plan is unchanged.', trip?.id ?? '', trip?.plan ?? null, trip?.booking ?? null, { dismissed: true });
          return;
        }
      } else {
        out = await this.trips.plan({ threadId: input.threadId, message: text.slice(0, 4000) }, emit, abort.signal);
      }

      const { trip, result } = out;
      const outcome: RunOutcome = result.interrupt
        ? {
            type: 'interrupt',
            interrupts: [{
              id: result.interrupt.id,
              reason: 'booking_approval',
              message: `Approve bookings for “${result.interrupt.summary.tripTitle}” (est. ₹${result.interrupt.summary.totalINR.toLocaleString('en-IN')})?`,
              responseSchema: BOOKING_RESPONSE_SCHEMA,
              metadata: { summary: result.interrupt.summary },
            }],
          }
        : { type: 'success' };
      finished = true;
      await run.finish(result.reply, trip.id, trip.plan, trip.booking, {
        tripId: trip.id, intent: result.intent, agentsRun: result.agentsRun, errors: result.errors, version: trip.version, status: trip.status,
      }, outcome);
    } catch (e) {
      finished = true;
      if (e instanceof RunCancelledError) {
        this.log.log(`AG-UI run ${input.runId} cancelled`);
        run.cancelled();
      } else {
        this.log.error(`AG-UI run ${input.runId} failed: ${(e as Error).message}`);
        run.fail((e as Error).message);
      }
    } finally {
      clearInterval(keepalive);
      if (!closed) res.end();
    }
  }
}
