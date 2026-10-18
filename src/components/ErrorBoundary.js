import { Component } from 'react';
import { reportError } from '../utils/monitoring';

// Catches a render crash in one part of the page (a row, a route) so the
// rest keeps working. `fallback` is a node or ({ retry }) => node;
// `resetKey` changing (e.g. the route) clears the error.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.retry();
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV !== 'production') console.error(error); // eslint-disable-line no-console
    reportError(error, { componentStack: info?.componentStack, boundary: this.props.name || 'unnamed' });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { fallback = null } = this.props;
    return typeof fallback === 'function' ? fallback({ retry: this.retry, error: this.state.error }) : fallback;
  }
}

export function PageError({ retry }) {
  return (
    <div className="app-layout">
      <div className="page-content st-page-error" role="alert">
        <h1>Something went wrong on this page</h1>
        <p>The rest of binge. is fine. Try again, or head home.</p>
        <div>
          <button type="button" className="st-btn st-btn--primary" onClick={retry}>Try again</button>
          <a className="st-btn st-btn--ghost" href="/home">Go home</a>
        </div>
      </div>
    </div>
  );
}
