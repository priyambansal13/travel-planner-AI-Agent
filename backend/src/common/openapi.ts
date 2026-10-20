/**
 * OpenAPI (Swagger) schemas. Request validation is done with zod at runtime; these schemas
 * document the same shapes for Swagger UI at /api/docs.
 */
// @nestjs/swagger does not export its SchemaObject type from the package root.
type SchemaObject = Record<string, any>;

export const PlanInputSchemaDoc: SchemaObject = {
  type: 'object',
  required: ['message'],
  properties: {
    threadId: {
      type: 'string',
      description: 'Conversation/trip thread id (8–64 chars). Omit to start a new trip; reuse to refine an existing one.',
      example: '2302ad5c-64df-4566-92ad-8064825648b4',
    },
    message: {
      type: 'string',
      description: 'Natural-language request (2–4000 chars).',
      example: 'Plan 3 nights in Jaipur from Delhi starting 2026-11-20 for 2 adults, mid-range, heritage and food.',
    },
  },
};

export const ApprovalInputDoc: SchemaObject = {
  type: 'object',
  required: ['approved'],
  properties: {
    approved: { type: 'boolean', example: true },
    comment: { type: 'string', nullable: true, example: 'Looks good, go ahead.' },
  },
};

export const RunAgentInputDoc: SchemaObject = {
  type: 'object',
  description: 'AG-UI RunAgentInput (https://docs.ag-ui.com). The last message must have role "user".',
  required: ['threadId', 'runId', 'messages', 'tools', 'context'],
  properties: {
    threadId: { type: 'string', example: '153b8e4e-7f18-4ffc-a83a-9202c1e2bbec' },
    runId: { type: 'string', example: '9c1d0b4e-2f6a-4c55-9d0e-1f2a3b4c5d6e' },
    state: { type: 'object', description: 'Client copy of shared state (ignored — the server state is authoritative)' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          role: { type: 'string', enum: ['user', 'assistant', 'system', 'developer', 'tool'] },
          content: { type: 'string' },
        },
      },
      example: [{ id: 'm1', role: 'user', content: 'Weekend in Rishikesh from Delhi by train for 3 friends, budget ₹15,000.' }],
    },
    tools: { type: 'array', items: { type: 'object' }, example: [] },
    context: { type: 'array', items: { type: 'object' }, example: [] },
    forwardedProps: { type: 'object' },
    resume: {
      type: 'array',
      description: 'Answers to interrupts from the previous run (booking approval).',
      items: {
        type: 'object',
        properties: {
          interruptId: { type: 'string' },
          status: { type: 'string', enum: ['resolved', 'cancelled'] },
          payload: { type: 'object', example: { approved: true, comment: 'Go ahead' } },
        },
      },
    },
  },
};

export const AguiStreamDoc =
  'Server-Sent Events stream of AG-UI events: RUN_STARTED → STATE_SNAPSHOT → (STEP_STARTED/FINISHED per agent, ' +
  'TOOL_CALL_START/ARGS/END/RESULT per API call, STATE_DELTA JSON-Patch updates)* → STATE_SNAPSHOT (final plan) → ' +
  'TEXT_MESSAGE_START/CONTENT…/END (reply) → RUN_FINISHED {result, outcome: success | interrupt (booking approval) | cancelled} | RUN_ERROR. ' +
  'Each event is framed as `data: <json>\\n\\n`.';

export const TripSummaryDoc: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    threadId: { type: 'string' },
    title: { type: 'string', example: '3-Night Heritage & Food Immersion in Jaipur' },
    destination: { type: 'string', nullable: true, example: 'Jaipur' },
    status: { type: 'string', enum: ['planning', 'ready', 'needs_input', 'awaiting_approval', 'error'] },
    version: { type: 'integer', example: 2 },
    request: { type: 'object', description: 'Structured trip request (origin, destination, dates, travellers, budget, interests…)' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const TripDoc: SchemaObject = {
  type: 'object',
  properties: {
    ...TripSummaryDoc.properties,
    plan: {
      type: 'object',
      nullable: true,
      description:
        'Final travel plan: title, summary, highlights, budget{totalINR, perPersonINR, breakdown[]}, packingList, finalTips, ' +
        'request, research{destination, weather{days, alerts (IMD)}, attractions, …}, accommodation{options[]}, ' +
        'transport{outbound[], returnJourney[], localTransport[]}, itinerary{days[{items[]}]}',
    },
    booking: {
      type: 'object',
      nullable: true,
      description: 'Booking approval: status (awaiting_approval | approved | rejected | dismissed), interruptId, summary{items[], totalINR}, decidedAt, comment',
    },
    conversation: {
      type: 'array',
      items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' }, at: { type: 'string' } } },
    },
    runs: {
      type: 'array',
      description: 'One record per agent run: intent, agents run, duration, errors and the full agent/tool event trace',
      items: { type: 'object' },
    },
  },
};

export const PlanResultDoc: SchemaObject = {
  type: 'object',
  properties: {
    tripId: { type: 'string', format: 'uuid' },
    threadId: { type: 'string' },
    reply: { type: 'string', description: 'Markdown chat reply from the Response Aggregator' },
    intent: { type: 'string', enum: ['new_trip', 'refine', 'question', 'clarify', 'book'] },
    interrupt: { type: 'object', nullable: true, description: 'Set when the run paused for booking approval: {id, summary}' },
    agentsRun: { type: 'array', items: { type: 'string' }, example: ['destination_research', 'itinerary_planner', 'accommodation', 'transport'] },
    errors: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, error: { type: 'string' } } } },
    trip: TripDoc,
  },
};

export const HealthDoc: SchemaObject = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    database: { type: 'string', enum: ['up', 'down'] },
    llm: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' }, configured: { type: 'boolean' } } },
    observability: { type: 'object', properties: { langsmith: { type: 'boolean' } } },
    providers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Which external data provider is active per capability' },
  },
};
