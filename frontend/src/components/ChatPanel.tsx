'use client';

import { Bot, Loader2, SendHorizontal, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatEntry } from '@/lib/types';

export function ChatPanel({
  messages, busy, onSend, suggestions,
}: { messages: ChatEntry[]; busy: boolean; onSend: (m: string) => void; suggestions: string[] }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  const send = (m: string) => {
    if (!m.trim() || busy) return;
    onSend(m.trim());
    setText('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={ref} className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${m.role === 'user' ? 'bg-stone-800 text-white' : 'bg-saffron-100 text-saffron-600'}`}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            </span>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${m.role === 'user' ? 'bg-stone-800 text-white' : 'border border-stone-200 bg-white'}`}>
              {m.role === 'assistant' ? (
                <div className="space-y-1.5 [&_a]:text-saffron-600 [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Agents are working on it…
          </div>
        )}
      </div>
      {suggestions.length > 0 && !busy && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-stone-600 hover:border-saffron-400 hover:text-saffron-600">
              {s}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="mt-2 flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-2 py-1.5 focus-within:border-saffron-500">
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
          placeholder={messages.length ? 'Refine: "make day 2 relaxed", "cheaper hotels", "go by train"…' : 'Describe your trip in your own words…'}
          className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none" />
        <button disabled={busy || !text.trim()} className="grid h-8 w-8 place-items-center rounded-lg bg-saffron-500 text-white disabled:opacity-40">
          <SendHorizontal className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
