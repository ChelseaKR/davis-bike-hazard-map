/**
 * App shell: tabbed navigation across Map, List, Report, My Reports, and
 * Moderation. Map and List share one filtered dataset so they are always in
 * parity (accessibility gate), and a background sync loop drains the offline
 * queue whenever the device is online.
 */
import { lazy, Suspense, useCallback, useEffect } from 'react';
import type { Hazard } from '../shared/types.ts';
import { useHazards } from './hooks/useHazards.ts';
import { useOnline } from './hooks/useOnline.ts';
import { useRefreshOnReconnect } from './hooks/useRefreshOnReconnect.ts';
import { useViewState, type Tab } from './hooks/useViewState.ts';
import { startSync } from './lib/sync.ts';
import { confirmHazard } from './lib/api.ts';
import { Filters } from './components/Filters.tsx';
import { ListView } from './components/ListView.tsx';
import { ReportForm } from './components/ReportForm.tsx';
import { MyReports } from './components/MyReports.tsx';
import { ModerationPanel } from './components/ModerationPanel.tsx';
import { CoverageView } from './components/CoverageView.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FeedFreshness } from './components/FeedFreshness.tsx';
import { SkeletonMap } from './components/Skeleton.tsx';

// Leaflet is the heaviest dependency; keep it out of the initial bundle so the
// report flow is fast on mobile data.
const MapView = lazy(() =>
  import('./components/MapView.tsx').then((m) => ({ default: m.MapView })),
);

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'list', label: 'List' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'report', label: 'Report' },
  { id: 'mine', label: 'My reports' },
  { id: 'moderate', label: 'Moderate' },
];

export default function App() {
  const [{ tab, filters, focusHazard, statusKey }, dispatch] = useViewState();
  const online = useOnline();

  const { hazards, all, loading, error, lastUpdatedAt, refresh } = useHazards(filters);

  // Drain the offline queue in the background; refresh the map on any success.
  useEffect(() => {
    return startSync((result) => {
      if (result.synced > 0) {
        void refresh();
        dispatch({ type: 'bumpStatus' });
      }
    });
  }, [refresh, dispatch]);

  // Also pull a fresh feed whenever we reconnect or the app is foregrounded,
  // so the map isn't stuck on data cached from before we went offline.
  useRefreshOnReconnect(refresh);

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

  const showOnMap = useCallback(
    (hazard: Hazard) => dispatch({ type: 'focusOnMap', hazard }),
    [dispatch],
  );

  const onSubmitted = useCallback(() => {
    dispatch({ type: 'bumpStatus' });
    void refresh();
  }, [refresh, dispatch]);

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
            onClick={() => dispatch({ type: 'setTab', tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <StatusBanner refreshKey={statusKey} />

      <main className="app-main">
        {/* Keyed by tab so a crash in one view is contained and auto-clears
            when the user navigates to another tab — the shell stays usable. */}
        <ErrorBoundary key={tab} source={`view:${tab}`}>
          {(tab === 'map' || tab === 'list') && (
            <>
              <Filters
                value={filters}
                onChange={(filters) => dispatch({ type: 'setFilters', filters })}
                resultCount={hazards.length}
              />
              <FeedFreshness
                updatedAt={lastUpdatedAt}
                loading={loading}
                onRefresh={() => void refresh()}
              />
            </>
          )}

          {tab === 'map' && (
            <Suspense fallback={<SkeletonMap />}>
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
                onRetry={() => void refresh()}
              />
            </div>
          )}

          {tab === 'coverage' && <CoverageView hazards={all} />}

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

          {tab === 'mine' && <MyReports onChange={() => dispatch({ type: 'bumpStatus' })} />}

          {tab === 'moderate' && <ModerationPanel />}
        </ErrorBoundary>
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
