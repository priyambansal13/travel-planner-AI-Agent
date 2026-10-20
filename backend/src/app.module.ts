import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AguiModule } from './agui/agui.module.js';
import { HealthController } from './health/health.controller.js';
import { Trip } from './trips/trip.entity.js';
import { TripsModule } from './trips/trips.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [Trip],
        synchronize: true, // dev convenience; use migrations in production
      }),
    }),
    TripsModule,
    AguiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
