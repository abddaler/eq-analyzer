import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/**
 * Catches a render error and shows it.
 *
 * Without this, one bad render unmounts the tree and leaves the dark
 * background - which on a phone in a dark room is indistinguishable from the
 * app never having started.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' });
    // Also surface it where a remote debugger would see it.
    console.error('EQ Scope render error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="screen">
        <h1>Ошибка в интерфейсе</h1>
        <div className="note note--bad">{error.message}</div>
        <pre>{error.stack ?? ''}{stack}</pre>
        <div className="row">
          <button className="btn--primary" onClick={() => this.setState({ error: null, stack: '' })}>
            Попробовать снова
          </button>
          <button className="btn--ghost" onClick={() => location.reload()}>
            Перезагрузить
          </button>
        </div>
        <div className="faint small">{navigator.userAgent}</div>
      </div>
    );
  }
}
