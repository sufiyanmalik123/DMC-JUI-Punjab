import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : 'An unexpected error occurred.';
    let friendly = 'Something went wrong while loading this section.';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.error === 'string') {
        friendly = parsed.error.includes('permission')
          ? 'You do not have permission to perform this action.'
          : parsed.error;
      }
    } catch {
      if (raw && raw.length < 180) {
        friendly = raw;
      }
    }
    return { hasError: true, message: friendly };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-6">
          <div className="max-w-md w-full bg-white border border-[#E4E7E2] rounded-2xl p-8 text-center">
            <h2 className="text-xl font-bold text-[#141D18] tracking-tight">
              Unable to complete request
            </h2>
            <p className="mt-2 text-sm text-[#5C6660] leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="mt-6 inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-[#064E3B] rounded-lg hover:bg-[#053D2E] transition-colors whitespace-nowrap"
            >
              Reload Studio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
