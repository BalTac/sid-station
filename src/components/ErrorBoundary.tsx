import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Keeps a rendering error inside a page from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="panel max-w-lg p-6 text-sm">
            <div className="text-base font-medium text-white">Errore nell'interfaccia</div>
            <p className="mt-2 text-muted">{this.state.error.message}</p>
            <button className="btn mt-4" onClick={() => this.setState({ error: null })}>
              Riprova
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
