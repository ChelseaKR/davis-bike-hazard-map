/**
 * Hazard-avoiding bike route planner.
 *
 * Pick a start and end (from Davis landmark presets, "use my location", or — as
 * an enhancement — by tapping the map) and the server plans a cycling route that
 * steers around reported hazards, weighted by severity and recency.
 *
 * Accessibility: the turn-by-turn <ol> and the hazards-on-route list are the
 * primary, map-free output (parity gate). The map is a lazy enhancement and
 * never the only way to read the route.
 */
import { lazy, Suspense, useState } from 'react';
import type { GeoPoint } from '../../shared/types.ts';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '../../shared/types.ts';
import type { RoutePlan } from '../../shared/routing.ts';
import { fetchRoute } from '../lib/api.ts';
import { DAVIS_LANDMARKS, landmarkByName } from '../lib/landmarks.ts';
import { getCurrentLocation, GeolocationError } from '../lib/geolocation.ts';
import { formatDistance, formatDuration, formatLatLng } from '../lib/format.ts';

const RouteMap = lazy(() => import('./RouteMap.tsx').then((m) => ({ default: m.RouteMap })));

interface Endpoint {
  label: string;
  point: GeoPoint;
}

const DEFAULT_START: Endpoint = { label: DAVIS_LANDMARKS[0].name, point: DAVIS_LANDMARKS[0].point };
const DEFAULT_END: Endpoint = { label: DAVIS_LANDMARKS[1].name, point: DAVIS_LANDMARKS[1].point };

export function RoutePlanner() {
  const [start, setStart] = useState<Endpoint>(DEFAULT_START);
  const [end, setEnd] = useState<Endpoint>(DEFAULT_END);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState<'start' | 'end' | null>(null);

  const onPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setPlan(await fetchRoute(start.point, end.point));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not plan a route.');
      setPlan(null);
    } finally {
      setLoading(false);
    }
  };

  const onSelect = (which: 'start' | 'end', name: string) => {
    const point = landmarkByName(name);
    if (!point) return;
    const ep = { label: name, point };
    if (which === 'start') setStart(ep);
    else setEnd(ep);
  };

  const pickMyLocation = async (which: 'start' | 'end') => {
    setLocating(which);
    setError(null);
    try {
      const point = await getCurrentLocation();
      const ep = { label: 'My location', point };
      if (which === 'start') setStart(ep);
      else setEnd(ep);
    } catch (err) {
      setError(
        err instanceof GeolocationError
          ? `Couldn't use your location: ${err.message}`
          : 'Location is unavailable.',
      );
    } finally {
      setLocating(null);
    }
  };

  const hazardsOnRoute = plan?.nearby.length ?? 0;

  return (
    <section className="route-planner" aria-label="Bike route planner">
      <form className="route-form" onSubmit={onPlan}>
        {(['start', 'end'] as const).map((which) => {
          const ep = which === 'start' ? start : end;
          return (
            <div className="route-endpoint" key={which}>
              <label htmlFor={`route-${which}`}>{which === 'start' ? 'Start' : 'Destination'}</label>
              <select
                id={`route-${which}`}
                value={landmarkByName(ep.label) ? ep.label : ''}
                onChange={(e) => onSelect(which, e.target.value)}
              >
                {!landmarkByName(ep.label) && <option value="">{ep.label}</option>}
                {DAVIS_LANDMARKS.map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void pickMyLocation(which)}
                disabled={locating === which}
              >
                {locating === which ? 'Locating…' : 'Use my location'}
              </button>
              <span className="route-endpoint-coord">{formatLatLng(ep.point.lat, ep.point.lng)}</span>
            </div>
          );
        })}

        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Planning…' : 'Plan a safer route'}
        </button>
      </form>

      <div aria-live="polite" className="route-status">
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>

      {plan && (
        <div className="route-result">
          <h3>Your route</h3>
          <dl className="route-summary">
            <div>
              <dt>Distance</dt>
              <dd>{formatDistance(plan.route.distanceMeters)}</dd>
            </div>
            <div>
              <dt>Est. time</dt>
              <dd>{formatDuration(plan.route.durationSeconds)}</dd>
            </div>
            <div>
              <dt>Hazards on route</dt>
              <dd>{hazardsOnRoute}</dd>
            </div>
          </dl>

          {plan.source === 'fallback' ? (
            <p className="hint">
              Showing a <strong>direct line</strong> — live turn-by-turn routing is
              unavailable (offline or the routing service is down). The hazard list
              below still reflects what's been reported near this line.
            </p>
          ) : (
            <p className="hint">
              Chosen from {plan.alternativesConsidered} candidate route
              {plan.alternativesConsidered === 1 ? '' : 's'} to avoid reported hazards.
            </p>
          )}

          {hazardsOnRoute > 0 && (
            <>
              <h4>Hazards still on this route</h4>
              <ul className="route-hazards">
                {plan.nearby.map((n) => (
                  <li key={n.hazard.id} className={`route-hazard severity-text-${n.hazard.severity}`}>
                    {CATEGORY_LABELS[n.hazard.category]} · {SEVERITY_LABELS[n.hazard.severity]} ·{' '}
                    {Math.round(n.distanceMeters)} m from your route
                  </li>
                ))}
              </ul>
              <p className="hint">
                No hazard-free route was found — ride these stretches with extra care.
              </p>
            </>
          )}

          <h4>Turn-by-turn directions</h4>
          {plan.route.steps.length > 0 ? (
            <ol className="route-steps">
              {plan.route.steps.map((step, i) => (
                <li key={i}>
                  <span className="route-step-instruction">{step.instruction}</span>
                  {step.distanceMeters > 0 && (
                    <span className="route-step-distance"> ({formatDistance(step.distanceMeters)})</span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">Turn-by-turn directions are unavailable for this route.</p>
          )}

          <Suspense fallback={<p className="hint">Loading map…</p>}>
            <RouteMap route={plan.route} from={plan.from} to={plan.to} nearby={plan.nearby} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
