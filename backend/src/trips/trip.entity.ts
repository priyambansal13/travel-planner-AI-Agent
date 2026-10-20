import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { BookingRecord, TravelPlan, TripRequest } from '../agents/schemas.js';
import type { AgentEvent } from '../agents/state.js';

export interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface RunRecord {
  runId: string;
  intent: string;
  agentsRun: string[];
  durationMs: number;
  errors: { agent: string; error: string }[];
  events: AgentEvent[];
  at: string;
}

export type TripStatus = 'planning' | 'ready' | 'needs_input' | 'awaiting_approval' | 'error';

@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  threadId: string;

  @Column({ type: 'varchar', default: 'New trip' })
  title: string;

  @Column({ type: 'varchar', nullable: true })
  destination: string | null;

  @Column({ type: 'varchar', default: 'planning' })
  status: TripStatus;

  @Column({ type: 'jsonb', nullable: true })
  request: TripRequest | null;

  @Column({ type: 'jsonb', nullable: true })
  plan: TravelPlan | null;

  @Column({ type: 'jsonb', nullable: true })
  booking: BookingRecord | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  conversation: ChatEntry[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  runs: RunRecord[];

  @Column({ type: 'int', default: 0 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
