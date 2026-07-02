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
import { FormattedMessage, useIntl } from 'react-intl';
import type { GeoPoint } from '../../shared/types.ts';
import type { RoutePlan } from '../../shared/routing.ts';
import { fetchRoute } from '../lib/api.ts';
import { DAVIS_LANDMARKS, landmarkByName } from '../lib/landmarks.ts';
import { getCurrentLocation, GeolocationError } from '../lib/geolocation.ts';
import { formatDistance, formatDuration, formatLatLng } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';

const RouteMap = lazy(() => import('./RouteMap.tsx').then((m) => ({ default: m.RouteMap })));

interface Endpoint {
  label: string;
  point: GeoPoint;
}

const DEFAULT_START: Endpoint = { label: DAVIS_LANDMARKS[0].name, point: DAVIS_LANDMARKS[0].point };
const DEFAULT_END: Endpoint = { label: DAVIS_LANDMARKS[1].name, point: DAVIS_LANDMARKS[1].point };

export function RoutePlanner() {
  const intl = useIntl();
  const labels = useLabels();
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
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'route.error.plan', defaultMessage: 'Could not plan a route.' }),
      );
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
      const ep = {
        label: intl.formatMessage({ id: 'route.myLocation', defaultMessage: 'My location' }),
        point,
      };
      if (which === 'start') setStart(ep);
      else setEnd(ep);
    } catch (err) {
      setError(
        err instanceof GeolocationError
          ? intl.formatMessage(
              {
                id: 'route.error.location',
                defaultMessage: "Couldn't use your location: {reason}",
              },
              { reason: err.message },
            )
          : intl.formatMessage({
              id: 'route.error.locationUnavailable',
              defaultMessage: 'Location is unavailable.',
            }),
      );
    } finally {
      setLocating(null);
    }
  };

  const hazardsOnRoute = plan?.nearby.length ?? 0;

  return (
    <section
      className="route-planner"
      aria-label={intl.formatMessage({ id: 'route.aria', defaultMessage: 'Bike route planner' })}
    >
      <form className="route-form" onSubmit={onPlan}>
        {(['start', 'end'] as const).map((which) => {
          const ep = which === 'start' ? start : end;
          return (
            <div className="route-endpoint" key={which}>
              <label htmlFor={`route-${which}`}>
                {which === 'start' ? (
                  <FormattedMessage id="route.start" defaultMessage="Start" />
                ) : (
                  <FormattedMessage id="route.destination" defaultMessage="Destination" />
                )}
              </label>
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
                {locating === which ? (
                  <FormattedMessage id="common.locating" defaultMessage="Locating…" />
                ) : (
                  <FormattedMessage id="common.useMyLocation" defaultMessage="Use my location" />
                )}
              </button>
              <span className="route-endpoint-coord">{formatLatLng(ep.point.lat, ep.point.lng)}</span>
            </div>
          );
        })}

        <button type="submit" className="btn" disabled={loading}>
          {loading ? (
            <FormattedMessage id="route.planning" defaultMessage="Planning…" />
          ) : (
            <FormattedMessage id="route.plan" defaultMessage="Plan a safer route" />
          )}
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
          <h3>
            <FormattedMessage id="route.result.heading" defaultMessage="Your route" />
          </h3>
          <dl className="route-summary">
            <div>
              <dt>
                <FormattedMessage id="route.summary.distance" defaultMessage="Distance" />
              </dt>
              <dd>{formatDistance(plan.route.distanceMeters)}</dd>
            </div>
            <div>
              <dt>
                <FormattedMessage id="route.summary.time" defaultMessage="Est. time" />
              </dt>
              <dd>{formatDuration(plan.route.durationSeconds)}</dd>
            </div>
            <div>
              <dt>
                <FormattedMessage id="route.summary.hazards" defaultMessage="Hazards on route" />
              </dt>
              <dd>{hazardsOnRoute}</dd>
            </div>
          </dl>

          <p className="route-honesty hint">
            {plan.fastestAlternative ? (
              <FormattedMessage
                id="route.honesty.delta"
                defaultMessage="The fastest route is {distance} / {time} but passes {count, plural, one {# reported hazard} other {# reported hazards}}; this route adds {extraDistance} to avoid them."
                values={{
                  distance: formatDistance(plan.fastestAlternative.distanceMeters),
                  time: formatDuration(plan.fastestAlternative.durationSeconds),
                  count: plan.fastestAlternative.hazardCount,
                  extraDistance: formatDistance(
                    Math.max(0, plan.route.distanceMeters - plan.fastestAlternative.distanceMeters),
                  ),
                }}
              />
            ) : (
              <FormattedMessage
                id="route.honesty.fastest"
                defaultMessage="This is also the fastest route found."
              />
            )}
          </p>

          {plan.source === 'fallback' ? (
            <p className="hint">
              <FormattedMessage
                id="route.fallbackNote"
                defaultMessage="Showing a <strong>direct line</strong> — live turn-by-turn routing is unavailable (offline or the routing service is down). The hazard list below still reflects what's been reported near this line."
                values={{ strong: (chunks) => <strong>{chunks}</strong> }}
              />
            </p>
          ) : (
            <p className="hint">
              <FormattedMessage
                id="route.candidates"
                defaultMessage="{count, plural, one {Chosen from # candidate route to avoid reported hazards.} other {Chosen from # candidate routes to avoid reported hazards.}}"
                values={{ count: plan.alternativesConsidered }}
              />
            </p>
          )}

          {hazardsOnRoute > 0 && (
            <>
              <h4>
                <FormattedMessage
                  id="route.hazards.heading"
                  defaultMessage="Hazards still on this route"
                />
              </h4>
              <ul className="route-hazards">
                {plan.nearby.map((n) => (
                  <li key={n.hazard.id} className={`route-hazard severity-text-${n.hazard.severity}`}>
                    <FormattedMessage
                      id="route.hazards.item"
                      defaultMessage="{category} · {severity} · {distance} m from your route · costs ~{penalty} m equivalent detour"
                      values={{
                        category: labels.category(n.hazard.category),
                        severity: labels.severity(n.hazard.severity),
                        distance: Math.round(n.distanceMeters),
                        penalty: Math.round(n.penalty),
                      }}
                    />
                  </li>
                ))}
              </ul>
              <p className="hint">
                <FormattedMessage
                  id="route.hazards.warning"
                  defaultMessage="No hazard-free route was found — ride these stretches with extra care."
                />
              </p>
            </>
          )}

          <h4>
            <FormattedMessage id="route.steps.heading" defaultMessage="Turn-by-turn directions" />
          </h4>
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
            <p className="hint">
              <FormattedMessage
                id="route.steps.unavailable"
                defaultMessage="Turn-by-turn directions are unavailable for this route."
              />
            </p>
          )}

          <Suspense
            fallback={
              <p className="hint">
                <FormattedMessage id="common.loadingMap" defaultMessage="Loading map…" />
              </p>
            }
          >
            <RouteMap route={plan.route} from={plan.from} to={plan.to} nearby={plan.nearby} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
