import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module.js';
import { Trip } from './trip.entity.js';
import { TripsController } from './trips.controller.js';
import { TripsGateway } from './trips.gateway.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Trip]), AgentsModule],
  controllers: [TripsController],
  providers: [TripsService, TripsGateway],
  exports: [TripsService],
})
export class TripsModule {}
