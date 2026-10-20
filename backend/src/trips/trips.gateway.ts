import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { RunResult } from '../agents/travel-graph.service.js';
import type { Trip } from './trip.entity.js';
import { ApprovalInputSchema, PlanInputSchema, RunCancelledError, TripsService } from './trips.service.js';

/**
 * Socket.IO channel — an alternative to the AG-UI endpoint with the same capabilities.
 * Client → `trip:plan` {threadId?, message} · `trip:cancel` {threadId} · `trip:resume` {threadId, approved, comment?}
 * Server → `trip:accepted`, many `trip:event` (agent/tool/supervisor progress), then
 *          `trip:result` (may carry `interrupt` = booking approval) | `trip:cancelled` | `trip:error`.
 * Runs started by a socket are cancelled when that socket disconnects.
 */
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? '*' } })
export class TripsGateway implements OnGatewayDisconnect {
  private readonly log = new Logger(TripsGateway.name);
  constructor(private readonly trips: TripsService) {}

  private threadsOf(client: Socket): Set<string> {
    return (client.data.threads ??= new Set<string>());
  }

  handleDisconnect(client: Socket) {
    for (const threadId of this.threadsOf(client)) {
      if (this.trips.cancel(threadId)) this.log.log(`socket ${client.id} disconnected — cancelled ${threadId}`);
    }
  }

  private async runAndReport(client: Socket, threadId: string, job: () => Promise<{ trip: Trip; result: RunResult }>) {
    const threads = this.threadsOf(client);
    threads.add(threadId);
    try {
      const { trip, result } = await job();
      client.emit('trip:result', {
        threadId, tripId: trip.id, reply: result.reply, intent: result.intent, agentsRun: result.agentsRun,
        errors: result.errors, interrupt: result.interrupt, trip,
      });
    } catch (e) {
      if (e instanceof RunCancelledError) client.emit('trip:cancelled', { threadId });
      else {
        this.log.error(`Socket run failed for ${threadId}: ${(e as Error).message}`);
        client.emit('trip:error', { threadId, message: (e as Error).message });
      }
    } finally {
      threads.delete(threadId);
    }
  }

  @SubscribeMessage('trip:plan')
  async plan(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const parsed = PlanInputSchema.safeParse(body);
    if (!parsed.success) {
      client.emit('trip:error', { message: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    const threadId = parsed.data.threadId ?? randomUUID();
    client.emit('trip:accepted', { threadId });
    await this.runAndReport(client, threadId, () =>
      this.trips.plan({ ...parsed.data, threadId }, (e) => client.emit('trip:event', { threadId, ...e })),
    );
  }

  @SubscribeMessage('trip:resume')
  async resume(@ConnectedSocket() client: Socket, @MessageBody() body: { threadId?: string; approved?: unknown; comment?: unknown }) {
    const parsed = ApprovalInputSchema.safeParse(body);
    if (!body?.threadId || !parsed.success) {
      client.emit('trip:error', { threadId: body?.threadId, message: 'trip:resume needs { threadId, approved: boolean, comment? }' });
      return;
    }
    const threadId = body.threadId;
    client.emit('trip:accepted', { threadId });
    await this.runAndReport(client, threadId, () =>
      this.trips.resume(threadId, { approved: parsed.data.approved, comment: parsed.data.comment ?? null }, (e) =>
        client.emit('trip:event', { threadId, ...e }),
      ),
    );
  }

  @SubscribeMessage('trip:cancel')
  cancel(@ConnectedSocket() client: Socket, @MessageBody() body: { threadId?: string }) {
    const cancelled = !!body?.threadId && this.trips.cancel(body.threadId);
    client.emit('trip:cancel:ack', { threadId: body?.threadId, cancelled });
  }
}
