import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen w-screen bg-[var(--bg-primary)] text-[var(--error)] p-8 flex flex-col gap-4 overflow-auto">
                    <h1 className="text-2xl font-bold">Something went wrong.</h1>
                    <div className="bg-[var(--bg-secondary)] p-4 rounded border border-[var(--error)]/30">
                        <h2 className="font-mono text-lg mb-2">{this.state.error?.toString()}</h2>
                        <pre className="font-mono text-xs text-[var(--text-muted)] whitespace-pre-wrap">
                            {this.state.errorInfo?.componentStack}
                        </pre>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-[var(--error)] text-[var(--text-primary)] rounded hover:opacity-90 w-fit"
                    >
                        Reload Window
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
