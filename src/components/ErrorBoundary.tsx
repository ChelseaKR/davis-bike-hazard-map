/**
 * Top-level error boundary: a render error in any view shows a recovery card
 * instead of white-screening the whole PWA. The error is reported via
 * telemetry, and the user can retry (re-mount the subtree) without a reload —
 * their offline-queued reports live in IndexedDB and are never at risk here.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { FormattedMessage } from 'react-intl';
import { reportError } from '../lib/telemetry.ts';

interface Props {
  children: ReactNode;
  /** Label so telemetry records which boundary tripped. */
  source?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      source: this.props.source ?? 'react-error-boundary',
      // First non-empty line of the component stack — a component name, no PII.
      detail: info.componentStack?.split('\n').find((l) => l.trim())?.trim() ?? null,
    });
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <h2>
            <FormattedMessage id="error.heading" defaultMessage="Something went wrong" />
          </h2>
          <p>
            <FormattedMessage
              id="error.body"
              defaultMessage="This view hit an unexpected error. Anything you saved on this device is safe. You can try again, or switch to another tab."
            />
          </p>
          <button type="button" className="btn btn-primary" onClick={this.reset}>
            <FormattedMessage id="error.retry" defaultMessage="Try again" />
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
