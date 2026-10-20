import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { TravelGraphService } from './travel-graph.service.js';

@Module({
  imports: [IntegrationsModule],
  providers: [TravelGraphService],
  exports: [TravelGraphService],
})
export class AgentsModule {}
