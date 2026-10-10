import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; label: string; page?: boolean };

/** Keeps one broken section from blanking the page: it renders a short notice in its place. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={this.props.page ? "mx-auto max-w-3xl px-6 py-24" : "mx-auto max-w-7xl px-4 py-8 sm:px-6"}>
        <p className="text-sm text-muted-foreground">
          ◌ {this.props.label} could not be shown. The rest of the page is unaffected.
        </p>
      </div>
    );
  }
}
