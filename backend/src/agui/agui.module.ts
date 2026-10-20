import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { AguiController } from './agui.controller.js';

@Module({
  imports: [TripsModule],
  controllers: [AguiController],
})
export class AguiModule {}
