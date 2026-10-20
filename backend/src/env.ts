// Loaded first by main.ts so decorators and LangSmith auto-tracing see .env values at import time.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
