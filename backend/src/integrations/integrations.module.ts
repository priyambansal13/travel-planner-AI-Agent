import { Module } from '@nestjs/common';
import { GeoService } from './geo.service.js';
import { ImdWarningsService } from './imd-warnings.service.js';
import { NewsService } from './news.service.js';
import { PlacesService } from './places.service.js';
import { TransportService } from './transport.service.js';
import { WeatherService } from './weather.service.js';

@Module({
  providers: [GeoService, PlacesService, WeatherService, TransportService, NewsService, ImdWarningsService],
  exports: [GeoService, PlacesService, WeatherService, TransportService, NewsService, ImdWarningsService],
})
export class IntegrationsModule {}
