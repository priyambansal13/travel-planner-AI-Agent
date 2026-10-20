import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApprovalInputDoc, PlanInputSchemaDoc, PlanResultDoc, TripDoc, TripSummaryDoc } from '../common/openapi.js';
import { ApprovalInputSchema, PlanInputSchema, RunCancelledError, TripsService } from './trips.service.js';

@ApiTags('Trips')
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @ApiOperation({ summary: 'List saved trips', description: 'Latest 100 trips, newest first (without plan/trace payloads).' })
  @ApiOkResponse({ schema: { type: 'array', items: TripSummaryDoc } })
  list() {
    return this.trips.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a trip', description: 'Full trip incl. plan, conversation and per-run agent traces. Accepts the trip id or the threadId.' })
  @ApiParam({ name: 'id', description: 'Trip UUID or threadId' })
  @ApiOkResponse({ schema: TripDoc })
  @ApiNotFoundResponse({ description: 'Trip not found' })
  get(@Param('id') id: string) {
    return this.trips.get(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a trip' })
  @ApiParam({ name: 'id', description: 'Trip UUID or threadId' })
  @ApiOkResponse({ schema: { type: 'object', properties: { deleted: { type: 'boolean' } } } })
  remove(@Param('id') id: string) {
    return this.trips.remove(id);
  }

  /** Synchronous planning endpoint (the web UI uses the AG-UI SSE endpoint for live progress). */
  @Post('plan')
  @ApiOperation({
    summary: 'Plan or refine a trip (synchronous)',
    description: 'Runs one conversational turn through the LangGraph multi-agent workflow and returns when finished (~30–90 s). ' +
      'Reuse threadId to refine. For live progress use POST /api/agui (AG-UI SSE) or the Socket.IO `trip:plan` event.',
  })
  @ApiBody({ schema: PlanInputSchemaDoc })
  @ApiOkResponse({ schema: PlanResultDoc, description: 'Plan result, or `{ threadId, cancelled: true }` if the run was cancelled' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiConflictResponse({ description: 'This thread is already being planned' })
  async plan(@Body() body: unknown) {
    const parsed = PlanInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const threadId = parsed.data.threadId ?? randomUUID();
    const out = await this.trips.plan({ ...parsed.data, threadId }).catch((e) => {
      if (e instanceof RunCancelledError) return null;
      throw e;
    });
    if (!out) return { threadId, cancelled: true };
    const { trip, result } = out;
    return { tripId: trip.id, threadId: trip.threadId, reply: result.reply, intent: result.intent, agentsRun: result.agentsRun, errors: result.errors, interrupt: result.interrupt, trip };
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel the running planning turn',
    description: 'Stops the agents working on this trip, whichever channel started the run (AG-UI, REST or Socket.IO). The previous plan is kept.',
  })
  @ApiParam({ name: 'id', description: 'Trip UUID or threadId' })
  @ApiOkResponse({ schema: { type: 'object', properties: { threadId: { type: 'string' }, cancelled: { type: 'boolean', description: 'false when no run was active' } } } })
  async cancel(@Param('id') id: string) {
    const threadId = this.trips.isRunning(id) ? id : (await this.trips.get(id)).threadId;
    return { threadId, cancelled: this.trips.cancel(threadId) };
  }

  @Post(':id/approval')
  @ApiOperation({
    summary: 'Approve or reject the pending booking (synchronous)',
    description: 'Answers the human-in-the-loop booking approval created by a "book this trip" request. ' +
      'AG-UI clients resume with RunAgentInput.resume instead; Socket.IO clients emit `trip:resume`.',
  })
  @ApiParam({ name: 'id', description: 'Trip UUID or threadId' })
  @ApiBody({ schema: ApprovalInputDoc })
  @ApiOkResponse({ schema: PlanResultDoc })
  @ApiBadRequestResponse({ description: 'No booking awaiting approval, or invalid body' })
  async approval(@Param('id') id: string, @Body() body: unknown) {
    const parsed = ApprovalInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { threadId } = await this.trips.get(id);
    const out = await this.trips.resume(threadId, { approved: parsed.data.approved, comment: parsed.data.comment ?? null }).catch((e) => {
      if (e instanceof RunCancelledError) return null;
      throw e;
    });
    if (!out) return { threadId, cancelled: true };
    const { trip, result } = out;
    return { tripId: trip.id, threadId, reply: result.reply, intent: result.intent, agentsRun: result.agentsRun, errors: result.errors, interrupt: result.interrupt, trip };
  }
}
