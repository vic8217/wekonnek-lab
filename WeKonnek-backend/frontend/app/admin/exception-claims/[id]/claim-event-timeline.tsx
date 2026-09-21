'use client';

import { displayServerField } from '@/lib/authoritative-domain-presentation';

export function ClaimEventTimeline({
  events,
}: {
  events: Array<Record<string, unknown>>;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="events-heading">
      <h2 id="events-heading" className="text-lg font-semibold text-gray-900">Domain events</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">No domain events.</p>
      ) : (
        <ol className="mt-3 space-y-1 text-sm text-gray-800">
          {events.map((row, index) => (
            <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `event-${index}`}>
              {displayServerField(row.eventType ?? row.type)} · {displayServerField(row.createdAt)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
