// client/src/schedule/MonitorErrorBoundary.tsx -- REQ-0285.
//
// The Watch view (Monitor.tsx) had NO error boundary around it. REQ-0284's own
// root-cause note recorded that "there is no error boundary anywhere in the
// client, so [an] uncaught throw tears down the React root -- the entire Watch
// view goes blank (the 'freeze')". REQ-0284 patched the ONE throw site it found
// (the unit-less BP seatCell deref); this boundary closes the CLASS so that any
// not-yet-enumerated uncaught throw in the Monitor subtree degrades to a
// localized, retryable card while the rest of the schedule keeps working -- it
// can never again blank/freeze the whole app.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';
import type { Locale } from '../store';

interface Props { locale: Locale; children: ReactNode; }
interface State { error: Error | null; }

export class MonitorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[backpack_ragnarok] Monitor render error (contained by MonitorErrorBoundary)', error, info.componentStack);
  }

  private reset = (): void => { this.setState({ error: null }); };

  render(): ReactNode {
    if (this.state.error) {
      const { locale } = this.props;
      return (
        <div className="panel ornate schedule-monitor schedule-monitor-error" data-testid="schedule-monitor-error" role="alert">
          <div className="schedule-monitor-error-title">{t(locale, 'schedule.monitor.renderError.title')}</div>
          <div className="schedule-monitor-error-body">{t(locale, 'schedule.monitor.renderError.body')}</div>
          <button type="button" className="btn btn-ghost schedule-monitor-error-retry" data-testid="schedule-monitor-error-retry" onClick={this.reset}>
            {t(locale, 'schedule.monitor.renderError.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
