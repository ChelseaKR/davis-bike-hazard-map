/**
 * App shell: tabbed navigation across Map, List, Report, My Reports, and
 * Moderation. Map and List share one filtered dataset so they are always in
 * parity (accessibility gate), and a background sync loop drains the offline
 * queue whenever the device is online.
 */
import { lazy, Suspense, useCallback, useEffect } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import type { Hazard } from '../shared/types.ts';
import { useHazards } from './hooks/useHazards.ts';
import { useOnline } from './hooks/useOnline.ts';
import { useRefreshOnReconnect } from './hooks/useRefreshOnReconnect.ts';
import { useViewState, type Tab } from './hooks/useViewState.ts';
import { startSync } from './lib/sync.ts';
import { confirmHazard } from './lib/api.ts';
import { config } from './config.ts';
import { Filters } from './components/Filters.tsx';
import { ListView } from './components/ListView.tsx';
import { ReportForm } from './components/ReportForm.tsx';
import { MyReports } from './components/MyReports.tsx';
import { ModerationPanel } from './components/ModerationPanel.tsx';
import { CoverageView } from './components/CoverageView.tsx';
import { RoutePlanner } from './components/RoutePlanner.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FeedFreshness } from './components/FeedFreshness.tsx';
import { SkeletonMap } from './components/Skeleton.tsx';

// Leaflet is the heaviest dependency; keep it out of the initial bundle so the
// report flow is fast on mobile data.
const MapView = lazy(() =>
  import('./components/MapView.tsx').then((m) => ({ default: m.MapView })),
);

/** Read-only views available in the public dashboard. */
const PUBLIC_TABS: Tab[] = ['map', 'list', 'coverage', 'route'];

const ALL_TABS: Tab[] = ['map', 'list', 'coverage', 'route', 'report', 'mine', 'moderate'];

const tabMessages = defineMessages({
  map: { id: 'nav.tab.map', defaultMessage: 'Map' },
  list: { id: 'nav.tab.list', defaultMessage: 'List' },
  coverage: { id: 'nav.tab.coverage', defaultMessage: 'Coverage' },
  route: { id: 'nav.tab.route', defaultMessage: 'Route' },
  report: { id: 'nav.tab.report', defaultMessage: 'Report' },
  mine: { id: 'nav.tab.mine', defaultMessage: 'My reports' },
  moderate: { id: 'nav.tab.moderate', defaultMessage: 'Moderate' },
});

// In public-dashboard mode the report/my-reports/moderation tabs are removed.
const TABS = config.publicDashboard
  ? ALL_TABS.filter((t) => PUBLIC_TABS.includes(t))
  : ALL_TABS;

export default function App() {
  const intl = useIntl();
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
          <span aria-hidden="true">🚲</span>{' '}
          <FormattedMessage id="app.title" defaultMessage="Davis Bike Hazard Map" />
        </h1>
        <p className="tagline">
          <FormattedMessage id="app.tagline" defaultMessage="See it, flag it, route around it." />
        </p>
      </header>

      <nav className="tabs" aria-label={intl.formatMessage({ id: 'nav.aria', defaultMessage: 'Views' })}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tab ${tab === t ? 'tab-active' : ''}`}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => dispatch({ type: 'setTab', tab: t })}
          >
            {intl.formatMessage(tabMessages[t])}
          </button>
        ))}
      </nav>

      {config.publicDashboard && (
        <p className="public-banner" role="note">
          <FormattedMessage
            id="app.publicBanner"
            defaultMessage="Public read-only view — reporting and moderation are disabled. See the <link>city's 311</link> to file an official request."
            values={{
              link: (chunks) => (
                <a href="https://www.cityofdavis.org/city-hall/public-works-utilities-and-operations">
                  {chunks}
                </a>
              ),
            }}
          />
        </p>
      )}

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

          {tab === 'route' && <RoutePlanner />}

          {!config.publicDashboard && tab === 'report' && (
            <>
              {!online && (
                <p className="hint offline-hint">
                  <FormattedMessage
                    id="report.offlineHint"
                    defaultMessage="You're offline — your report will be saved and synced later."
                  />
                </p>
              )}
              <ReportForm
                onSubmitted={onSubmitted}
                nearbyHazards={all}
                onConfirmExisting={onConfirm}
              />
            </>
          )}

          {!config.publicDashboard && tab === 'mine' && (
            <MyReports onChange={() => dispatch({ type: 'bumpStatus' })} />
          )}

          {!config.publicDashboard && tab === 'moderate' && <ModerationPanel />}
        </ErrorBoundary>
      </main>

      <footer className="app-footer">
        <p>
          <FormattedMessage
            id="footer.attribution"
            defaultMessage="Map data © <link>OpenStreetMap</link> contributors. Community-reported hazards are not verified by the city."
            values={{
              link: (chunks) => (
                <a href="https://www.openstreetmap.org/copyright">{chunks}</a>
              ),
            }}
          />
        </p>
        <p className="footer-links">
          <a href="/privacy.html">
            <FormattedMessage id="footer.privacy" defaultMessage="Privacy" />
          </a>{' '}
          ·{' '}
          <a href="/accessibility.html">
            <FormattedMessage id="footer.accessibility" defaultMessage="Accessibility" />
          </a>{' '}
          ·{' '}
          <a href="/api/hazards/export">
            <FormattedMessage id="footer.openData" defaultMessage="Open data (GeoJSON)" />
          </a>
        </p>
      </footer>
    </div>
  );
}
