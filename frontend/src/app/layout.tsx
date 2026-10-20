import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const fraunces = Fraunces({ variable: '--font-fraunces', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Yatra AI — Multi-Agent India Travel Planner',
  description: 'LangGraph multi-agent system that researches, plans, and budgets personalised trips across India.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-[1000] border-b border-stone-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-saffron-500 to-rose-500 text-white font-bold">य</span>
              <span className="font-display text-lg font-semibold tracking-tight">Yatra AI</span>
              <span className="hidden rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500 sm:inline">LangGraph multi-agent</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 font-medium text-stone-700 hover:bg-stone-100">Plan a trip</Link>
              <Link href="/trips" className="rounded-md px-3 py-1.5 font-medium text-stone-700 hover:bg-stone-100">My trips</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
