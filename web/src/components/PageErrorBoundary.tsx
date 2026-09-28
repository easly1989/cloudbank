import { Component, type ErrorInfo, type ReactNode } from "react";

import { PageError } from "./PageError";

type Props = {
  children: ReactNode;
  /** When this changes, a caught error is cleared and the children render
   *  again: the layouts pass the path, so leaving the broken page ends it. */
  resetKey?: string;
  /** The last net, around the whole app: no shell is left to keep, so the
   *  message fills the screen and its links load the app afresh. */
  fullPage?: boolean;
};

type State = { error: unknown; failed: boolean };

/**
 * Catches an error thrown while a page renders and shows {@link PageError} in
 * its place, instead of React unmounting the whole app to a blank page (#518).
 *
 * A class because React still has no hook for this: only a component with
 * `getDerivedStateFromError` can catch a render error below it.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The console keeps the stack for whoever reports it; the page shows only
    // the message.
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <PageError error={this.state.error} fullPage={this.props.fullPage} />;
    }
    return this.props.children;
  }
}
