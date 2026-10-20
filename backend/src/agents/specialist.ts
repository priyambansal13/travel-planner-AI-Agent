import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import type { AgentEvent } from './state.js';

export interface SpecialistArgs<S extends z.ZodTypeAny> {
  agent: string;
  model: ChatOpenAI;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  task: string;
  schema: S;
  emit: (e: AgentEvent) => void;
  maxSteps?: number;
  /** Aborts in-flight LLM calls and stops the loop when the run is cancelled. */
  signal?: AbortSignal;
}

/**
 * A specialist agent = ReAct loop (LLM ⇄ tools) followed by a structured-output pass.
 * Tool calls requested in one LLM turn run in parallel; each start/end is emitted so the
 * UI can show live tool activity per agent.
 */
export async function runSpecialist<S extends z.ZodTypeAny>(a: SpecialistArgs<S>): Promise<z.infer<S>> {
  const byName = new Map(a.tools.map((t) => [t.name, t]));
  const llm = a.model.bindTools(a.tools);
  const messages: BaseMessage[] = [new SystemMessage(a.systemPrompt), new HumanMessage(a.task)];

  for (let step = 0; step < (a.maxSteps ?? 6); step++) {
    a.signal?.throwIfAborted();
    const ai = (await llm.invoke(messages, { signal: a.signal })) as AIMessage;
    messages.push(ai);
    const calls = ai.tool_calls ?? [];
    if (!calls.length) break;

    const results = await Promise.all(
      calls.map(async (call) => {
        const started = Date.now();
        const callId = call.id ?? `${a.agent}-${call.name}-${started}`;
        a.emit({ type: 'tool', agent: a.agent, callId, tool: call.name, phase: 'start', input: call.args, at: new Date().toISOString() });
        let content: string;
        let ok = true;
        const t = byName.get(call.name);
        try {
          content = t ? String(await t.invoke(call.args)) : JSON.stringify({ error: `Unknown tool ${call.name}` });
          ok = !!t && !content.startsWith('{"error"');
        } catch (e) {
          ok = false;
          content = JSON.stringify({ error: (e as Error).message });
        }
        a.emit({
          type: 'tool', agent: a.agent, callId, tool: call.name, phase: 'end', ok,
          durationMs: Date.now() - started, preview: content.slice(0, 280), at: new Date().toISOString(),
        });
        return new ToolMessage({ content, tool_call_id: callId, name: call.name });
      }),
    );
    messages.push(...results);
  }

  a.signal?.throwIfAborted();
  const structured = a.model.withStructuredOutput(a.schema, { name: `${a.agent}_result` });
  return structured.invoke(
    [...messages, new HumanMessage('Now return your final result in the required structured format, using only the information gathered above.')],
    { signal: a.signal },
  ) as Promise<z.infer<S>>;
}
