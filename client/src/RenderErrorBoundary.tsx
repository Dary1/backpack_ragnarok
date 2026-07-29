// client/src/RenderErrorBoundary.tsx -- REQ-0336.
//
// The generalization of REQ-0285's MonitorErrorBoundary. That REQ closed the
// "an uncaught throw tears down the React root" class *for the Monitor subtree
// only*, which is where the freeze had been reported. The class itself stayed
// open everywhere else: before this file, a grep for componentDidCatch /
// getDerivedStateFromError found exactly one hit in the whole client, and it
// was Monitor-shaped (its copy, its testids, its CSS classes), so nothing else
// could reuse it.
//
// The freeze has now been diagnosed four times, from three different
// mechanisms, and two of them were this one:
//
//   REQ-0031 Phase A #2  WebGL context destroy/recreate race (tab switch)
//   REQ-0041 #4          monitor event-shape crash-loop (raw [row,col] vs "M9")
//   REQ-0284             `bp.unit.id` on a unit-less BP -> uncaught throw ->
//                        React root torn down -> blank view ("the freeze")
//   REQ-0285             boundary added -- Monitor subtree only
//
// REQ-0284's own post-mortem is the reason this exists: *"There is no error
// boundary anywhere in the client, so the uncaught throw tears down the React
// root."* One throw site was patched, then one subtree was wrapped. The BOARDS
// -- the app's primary surface, 1800 lines of BoardRenderer with six per-item
// draw loops -- had neither.
//
// Contract: a throw inside `children` degrades to a contained, retryable card.
// It NEVER blanks the app, and siblings keep working. `resetKey` re-arms the
// boundary when the thing being drawn changes, so a user who navigates away and
// back is not stuck looking at a stale error card.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './i18n';
import type { Locale } from './store';

interface Props {
  locale: Locale;
  /** Names the failing surface in the console line, e.g. 'canvas board'. */
  surface: string;
  /** data-testid on the fallback card, so e2e can assert containment. */
  testId: string;
  /** Change this to re-arm after a contained error (route, squad, run id, …). */
  resetKey?: string | number;
  children: ReactNode;
}
interface State { error: Error | null; resetKey?: string | number }

export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  // Re-arm when the caller says the subject changed. Doing this in
  // getDerivedStateFromProps (rather than an effect) means the recovered
  // children render on the SAME commit as the key change -- no flash of the
  // error card on a route the user just navigated to.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (state.error && state.resetKey !== props.resetKey) return { error: null, resetKey: props.resetKey };
    if (state.resetKey !== props.resetKey) return { resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      '[backpack_ragnarok] ' + this.props.surface + ' render error (contained by RenderErrorBoundary)',
      error, info.componentStack,
    );
  }

  private reset = (): void => { this.setState({ error: null }); };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { locale, testId } = this.props;
    return (
      <div className="panel ornate render-error-card" data-testid={testId} role="alert">
        <div className="render-error-title">{t(locale, 'render.error.title')}</div>
        <div className="render-error-body">{t(locale, 'render.error.body')}</div>
        <button
          type="button"
          className="btn btn-ghost render-error-retry"
          data-testid={testId + '-retry'}
          onClick={this.reset}
        >
          {t(locale, 'render.error.retry')}
        </button>
      </div>
    );
  }
}
