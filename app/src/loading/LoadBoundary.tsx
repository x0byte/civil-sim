import { Component, Fragment, type ReactNode } from "react";

export class LoadBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="loading-skeleton" role="alert">
          <p>{this.props.label ?? "Couldn't prepare this view. Your building is still saved."}</p>
          <button onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>Retry</button>
          <p>You can keep using the other views and menus.</p>
        </section>
      );
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
