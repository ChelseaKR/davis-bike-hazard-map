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
 *
 * Rider preference (issue #178): a radio group over the profiles in
 * `shared/routing.ts`, each described by the weights it applies. Those sentences
 * are composed from the profile table (`routeProfileWeightLines`), so the copy
 * cannot drift from the numbers. The result names the preference the SERVER says
 * it planned with (`plan.profile`), not whatever the picker shows now, and says
 * in each of `profileApplied`'s states what that preference actually did --
 * including "nothing", which is the true answer for a direct line or for a road
 * network that offered one route.
 */
import { lazy, Suspense, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  DEFAULT_ROUTE_PROFILE_ID,
  ROUTE_PROFILE_IDS,
  type GeoPoint,
  type RouteProfileId,
} from '../../shared/types.ts';
import type { RoutePlan } from '../../shared/routing.ts';
import { fetchRoute } from '../lib/api.ts';
import { PLACE_LANDMARKS, landmarkByName } from '../lib/landmarks.ts';
import { getCurrentLocation, GeolocationError } from '../lib/geolocation.ts';
import { geolocationErrorLabel } from '../i18n/labels.ts';
import { formatDistance, formatDuration, formatLatLng } from '../lib/format.ts';
import { useLabels } from '../i18n/labels.ts';

const RouteMap = lazy(() => import('./RouteMap.tsx').then((m) => ({ default: m.RouteMap })));

interface Endpoint {
  label: string;
  point: GeoPoint;
}

const DEFAULT_START: Endpoint = { label: PLACE_LANDMARKS[0].name, point: PLACE_LANDMARKS[0].point };
const DEFAULT_END: Endpoint = { label: PLACE_LANDMARKS[1].name, point: PLACE_LANDMARKS[1].point };

interface RoutePlannerProps {
  /**
   * The selected rider preference. App passes the permalink's value (see
   * `ViewState.routeProfile`); when absent the planner keeps its own.
   */
  profile?: RouteProfileId;
  onProfileChange?: (profile: RouteProfileId) => void;
}

/**
 * The preference a plan says it was made with, or null when it names nothing
 * this build recognises. A plan is a network response -- or a service-worker
 * cached one, and a plan cached before profiles existed (#199) carries no
 * `profile` at all -- so its type is a claim about what some server wrote, not a
 * fact about what arrived. Null renders as "not recorded", never as a preference.
 */
function plannedProfileOf(plan: RoutePlan): RouteProfileId | null {
  const value: unknown = plan.profile;
  return typeof value === 'string' && (ROUTE_PROFILE_IDS as readonly string[]).includes(value)
    ? (value as RouteProfileId)
    : null;
}

/**
 * What the preference did, in the words the result can support. Mirrors
 * `profileApplied`'s three states, plus `unrecorded` for a plan that does not
 * say -- because the one thing this panel must never do is fill that silence
 * with a claim.
 */
type ProfileOutcome = 'applied' | 'onlyRoute' | 'noSearch' | 'unrecorded';

function profileOutcomeOf(plan: RoutePlan, planned: RouteProfileId | null): ProfileOutcome {
  if (planned === null) return 'unrecorded';
  if (plan.profileApplied === true) return 'applied';
  if (plan.profileApplied === false) return 'onlyRoute';
  if (plan.profileApplied === null && plan.source === 'fallback') return 'noSearch';
  return 'unrecorded';
}

export function RoutePlanner({
  profile: controlledProfile,
  onProfileChange,
}: RoutePlannerProps = {}) {
  const intl = useIntl();
  const labels = useLabels();
  const [localProfile, setLocalProfile] = useState<RouteProfileId>(DEFAULT_ROUTE_PROFILE_ID);
  const profile = controlledProfile ?? localProfile;
  const chooseProfile = (next: RouteProfileId) => {
    if (controlledProfile === undefined) setLocalProfile(next);
    onProfileChange?.(next);
  };
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
      setPlan(await fetchRoute(start.point, end.point, profile));
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
              // NOT `err.message` (issue #173): that was the browser's own
              // English, interpolated into a translated wrapper, so the
              // sentence came out half-translated under a live catalog.
              { reason: geolocationErrorLabel(intl, err.code) },
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
  const plannedProfile = plan ? plannedProfileOf(plan) : null;
  const profileOutcome: ProfileOutcome = plan ? profileOutcomeOf(plan, plannedProfile) : 'unrecorded';

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
                {PLACE_LANDMARKS.map((l) => (
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

        <fieldset className="route-profile">
          <legend>
            <FormattedMessage id="route.profile.legend" defaultMessage="Route preference" />
          </legend>
          <p className="hint route-profile-note">
            <FormattedMessage
              id="route.profile.note"
              defaultMessage="Each preference weighs the hazards riders have reported differently. None of them makes a route safe: the map only knows what has been reported."
            />
          </p>
          {ROUTE_PROFILE_IDS.map((id) => (
            <div className="route-profile-option" key={id}>
              <label
                className={`route-profile-chip${profile === id ? ' route-profile-chip-on' : ''}`}
              >
                <input
                  type="radio"
                  name="route-profile"
                  value={id}
                  checked={profile === id}
                  onChange={() => chooseProfile(id)}
                  aria-describedby={`route-profile-weights-${id}`}
                />
                {labels.routeProfile(id)}
              </label>
              <ul className="route-profile-weights" id={`route-profile-weights-${id}`}>
                {labels.routeProfileWeights(id).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </fieldset>

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
        {plannedProfile !== null && plannedProfile !== profile && (
          <p className="route-profile-stale">
            <FormattedMessage
              id="route.profile.stale"
              defaultMessage="The route below was planned with the <strong>{planned}</strong> preference. You have chosen <strong>{selected}</strong> since: plan again to use it."
              values={{
                planned: labels.routeProfile(plannedProfile),
                selected: labels.routeProfile(profile),
                strong: (chunks) => <strong>{chunks}</strong>,
              }}
            />
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

          <div className="route-profile-result">
            <p className="hint">
              {profileOutcome === 'unrecorded' || plannedProfile === null ? (
                <FormattedMessage
                  id="route.profile.result.unrecorded"
                  defaultMessage="This plan does not record what its route preference did. It may have been saved on this device before preferences existed; plan again to use one."
                />
              ) : profileOutcome === 'applied' ? (
                <FormattedMessage
                  id="route.profile.result.applied"
                  defaultMessage="Chosen with the <strong>{profile}</strong> preference."
                  values={{
                    profile: labels.routeProfile(plannedProfile),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  }}
                />
              ) : profileOutcome === 'onlyRoute' ? (
                <FormattedMessage
                  id="route.profile.result.onlyRoute"
                  defaultMessage="Planned with the <strong>{profile}</strong> preference, but the road network offered only this one route, so the preference had nothing to choose between: every preference would give you this route."
                  values={{
                    profile: labels.routeProfile(plannedProfile),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  }}
                />
              ) : (
                <FormattedMessage
                  id="route.profile.result.noSearch"
                  defaultMessage="The <strong>{profile}</strong> preference did not choose this: it is a direct line, not a route search."
                  values={{
                    profile: labels.routeProfile(plannedProfile),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  }}
                />
              )}
            </p>
            {profileOutcome !== 'unrecorded' && plannedProfile !== null && (
              <>
                <p className="route-profile-weights-heading" id="route-profile-result-weights">
                  <FormattedMessage
                    id="route.profile.result.weightsHeading"
                    defaultMessage="How {profile} weighs reported hazards:"
                    values={{ profile: labels.routeProfile(plannedProfile) }}
                  />
                </p>
                <ul className="route-profile-weights" aria-labelledby="route-profile-result-weights">
                  {labels.routeProfileWeights(plannedProfile).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {plan.fastestAlternative && (
            <p className="hint route-comparison">
              <FormattedMessage
                id="route.comparison.tradeoff"
                defaultMessage="This route adds {extraDistance} and {extraTime} versus the fastest option, which would pass near {count, plural, one {# reported hazard} other {# reported hazards}}."
                values={{
                  extraDistance: formatDistance(
                    Math.max(0, plan.route.distanceMeters - plan.fastestAlternative.distanceMeters),
                  ),
                  extraTime: formatDuration(
                    Math.max(0, plan.route.durationSeconds - plan.fastestAlternative.durationSeconds),
                  ),
                  count: plan.fastestAlternative.nearby.length,
                }}
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
                      defaultMessage="{category} · {severity} · {distance} m from your route · adds {penalty} m to this route's score"
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
              {/*
                Issue #163: this used to read "No hazard-free route was found"
                off `nearby.length > 0` on the CHOSEN route alone — a claim about
                the whole search made from one candidate. `plan.nearby` is only
                `ranked[0].nearby`; every other candidate's hazard list is
                discarded server-side, so the client had no evidence either way,
                and the claim rendered even in the straight-line fallback where
                nothing was searched. It now says only what the server measured.
              */}
              <p className="hint">
                {plan.hazardFreeCandidate === null ? (
                  <FormattedMessage
                    id="route.hazards.warning.noSearch"
                    defaultMessage="This is a direct line, not a route search, so no hazard-free alternative was looked for — ride these stretches with extra care."
                  />
                ) : plan.hazardFreeCandidate ? (
                  <FormattedMessage
                    id="route.hazards.warning.tradedAway"
                    defaultMessage="A route clear of reported hazards was considered, but it was longer — this one scored better on distance and hazards together. Ride these stretches with extra care."
                  />
                ) : (
                  <FormattedMessage
                    id="route.hazards.warning.noneClear"
                    defaultMessage="{count, plural, one {The only route considered was not clear of reported hazards} other {None of the # routes considered was clear of reported hazards}} — ride these stretches with extra care."
                    values={{ count: plan.alternativesConsidered }}
                  />
                )}
              </p>
            </>
          )}

          <h4>
            <FormattedMessage id="route.steps.heading" defaultMessage="Turn-by-turn directions" />
          </h4>
          {plan.route.steps.length > 0 && plannedProfile !== null && profileOutcome !== 'unrecorded' && (
            <p className="hint route-steps-profile" id="route-steps-profile">
              {profileOutcome === 'applied' ? (
                <FormattedMessage
                  id="route.steps.profile.applied"
                  defaultMessage="For the route the <strong>{profile}</strong> preference chose."
                  values={{
                    profile: labels.routeProfile(plannedProfile),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  }}
                />
              ) : profileOutcome === 'onlyRoute' ? (
                <FormattedMessage
                  id="route.steps.profile.onlyRoute"
                  defaultMessage="For the only route the road network offered; no preference chose between routes."
                />
              ) : (
                <FormattedMessage
                  id="route.steps.profile.noSearch"
                  defaultMessage="For a direct line; no route preference chose it."
                />
              )}
            </p>
          )}
          {plan.route.steps.length > 0 ? (
            <ol
              className="route-steps"
              aria-describedby={
                plannedProfile !== null && profileOutcome !== 'unrecorded'
                  ? 'route-steps-profile'
                  : undefined
              }
            >
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
