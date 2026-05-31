/**
 * App shell: tabbed navigation across Map, List, Report, My Reports, and
 * Moderation. Map and List share one filtered dataset so they are always in
 * parity (accessibility gate), and a background sync loop drains the offline
 * queue whenever the device is online.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Hazard, HazardFilters } from '../shared/types.ts';
import { useHazards } from './hooks/useHazards.ts';
import { useOnline } from './hooks/useOnline.ts';
import { startSync } from './lib/sync.ts';
import { confirmHazard } from './lib/api.ts';
import { Filters } from './components/Filters.tsx';
import { ListView } from './components/ListView.tsx';
import { ReportForm } from './components/ReportForm.tsx';
import { MyReports } from './components/MyReports.tsx';
import { ModerationPanel } from './components/ModerationPanel.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';

// Leaflet is the heaviest dependency; keep it out of the initial bundle so the
// report flow is fast on mobile data.
const MapView = lazy(() =>
  import('./components/MapView.tsx').then((m) => ({ default: m.MapView })),
);

type Tab = 'map' | 'list' | 'report' | 'mine' | 'moderate';

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'list', label: 'List' },
  { id: 'report', label: 'Report' },
  { id: 'mine', label: 'My reports' },
  { id: 'moderate', label: 'Moderate' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('map');
  const [filters, setFilters] = useState<HazardFilters>({});
  const [focusHazard, setFocusHazard] = useState<Hazard | null>(null);
  const [statusKey, setStatusKey] = useState(0);
  const online = useOnline();

  const { hazards, loading, error, refresh } = useHazards(filters);

  // Drain the offline queue in the background; refresh the map on any success.
  useEffect(() => {
    return startSync((result) => {
      if (result.synced > 0) {
        void refresh();
        setStatusKey((k) => k + 1);
      }
    });
  }, [refresh]);

  const onConfirm = useCallback(
    async (id: string) => {
      try {
        await confirmHazard(id);
        await refresh();
      } catch {
        // Confirmation is best-effort; the next refresh will reconcile.
      }
    },
    [refresh],
  );

  const showOnMap = useCallback((hazard: Hazard) => {
    setFocusHazard(hazard);
    setTab('map');
  }, []);

  const onSubmitted = useCallback(() => {
    setStatusKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span aria-hidden="true">🚲</span> Davis Bike Hazard Map
        </h1>
        <p className="tagline">See it, flag it, route around it.</p>
      </header>

      <nav className="tabs" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <StatusBanner refreshKey={statusKey} />

      <main className="app-main">
        {(tab === 'map' || tab === 'list') && (
          <Filters value={filters} onChange={setFilters} resultCount={hazards.length} />
        )}

        {tab === 'map' && (
          <Suspense fallback={<p className="hint">Loading map…</p>}>
            <MapView hazards={hazards} onConfirm={onConfirm} focusHazard={focusHazard} />
          </Suspense>
        )}

        {tab === 'list' && (
          <div id="list-panel">
            <ListView
              hazards={hazards}
              loading={loading}
              error={error}
              onConfirm={onConfirm}
              onFocusOnMap={showOnMap}
            />
          </div>
        )}

        {tab === 'report' && (
          <>
            {!online && (
              <p className="hint offline-hint">
                You're offline — your report will be saved and synced later.
              </p>
            )}
            <ReportForm onSubmitted={onSubmitted} />
          </>
        )}

        {tab === 'mine' && <MyReports onChange={() => setStatusKey((k) => k + 1)} />}

        {tab === 'moderate' && <ModerationPanel />}
      </main>

      <footer className="app-footer">
        <p>
          Open data · Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>{' '}
          contributors. Community-reported hazards are not verified by the city.
        </p>
      </footer>
    </div>
  );
}
