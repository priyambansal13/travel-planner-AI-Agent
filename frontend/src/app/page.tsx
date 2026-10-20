import { Suspense } from 'react';
import { Planner } from '@/components/Planner';

export default function Home() {
  // Planner reads ?thread= via useSearchParams, which needs a Suspense boundary under cacheComponents.
  return (
    <Suspense fallback={<div className="p-10 text-center text-sm text-stone-500">Loading planner…</div>}>
      <Planner />
    </Suspense>
  );
}
