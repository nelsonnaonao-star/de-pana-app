import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

// @ts-ignore - React 19 types + useDefineForClassFields:false incompatibility
export default class ErrorBoundary extends Component<Props, State> {
  // @ts-ignore
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ERROR BOUNDARY]", error, errorInfo);
  }

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center p-6">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-red-500 to-red-700 mx-auto flex items-center justify-center">
              <span className="text-2xl font-black text-white">!</span>
            </div>
            <h2 className="text-white text-lg font-bold">Algo salio mal</h2>
            <p className="text-slate-400 text-sm">
              La app encontro un error inesperado. Puedes intentar de nuevo.
            </p>
            {/* @ts-ignore */}
            {this.state.error && (
              <p className="text-red-400 text-xs font-mono break-all max-h-24 overflow-auto bg-red-950/30 p-2 rounded-lg">
                {/* @ts-ignore */}
                {this.state.error.message}
              </p>
            )}
            <button
              // @ts-ignore
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-6 py-3 bg-gradient-to-r from-teal-400 to-[#0a4d52] text-white font-bold rounded-xl active:scale-95 transition-transform"
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}
