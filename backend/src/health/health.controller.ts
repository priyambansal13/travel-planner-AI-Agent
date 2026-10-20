import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthDoc } from '../common/openapi.js';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/** Health + which external providers are live vs. running on keyless fallbacks. */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service health', description: 'Database / LLM status and which external data provider is active for each capability.' })
  @ApiOkResponse({ schema: HealthDoc })
  async health() {
    const has = (k: string) => !!this.config.get<string>(k);
    let database = 'up';
    try {
      await this.db.query('SELECT 1');
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' && has('OPENAI_API_KEY') ? 'ok' : 'degraded',
      database,
      llm: { provider: 'OpenAI', model: this.config.get('OPENAI_MODEL') || 'gpt-4.1', configured: has('OPENAI_API_KEY') },
      observability: { langsmith: this.config.get('LANGSMITH_TRACING') === 'true' && has('LANGSMITH_API_KEY') },
      providers: {
        mapsPlacesDirections: has('OLA_MAPS_API_KEY') ? 'Ola Maps (live)' : 'OpenStreetMap Nominatim/Overpass + OSRM (fallback)',
        weather: (has('IMD_API_KEY') && has('IMD_JWT') ? 'IMD city forecast (keyed) + ' : 'Open-Meteo forecast + ') + 'IMD district warnings (official, keyless)',
        trains: has('RAPIDAPI_KEY') ? 'IRCTC via RapidAPI (live)' : this.config.get('ERAIL_ENABLED') !== 'false' ? 'erail.in public timetable (live, keyless, unofficial) + IRCTC link' : 'Indian Railways fare model (estimate) + IRCTC link',
        flights: 'Domestic fare model (estimate) + MakeMyTrip / ixigo deep links',
        buses: 'Fare model (estimate) + redBus deep link',
        hotels: has('OLA_MAPS_API_KEY') ? 'Ola Maps Places (live)' : 'OpenStreetMap hotels (live) + tariff bands',
        news: has('NEWSDATA_API_KEY') ? 'NewsData.io India (live)' : 'Google News India RSS (live)',
      },
    };
  }
}
