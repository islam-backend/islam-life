import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Last-resort catch so one throwing component can't leave the whole app
 * as a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
        <p className="text-[14px] font-semibold text-text">حصل خطأ غير متوقع</p>
        <p className="max-w-md text-[12.5px] text-text-muted">{this.state.error.message}</p>
        <button
          onClick={() => {
            this.setState({ error: null })
            window.location.href = import.meta.env.BASE_URL
          }}
          className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white"
        >
          الرجوع للرئيسية
        </button>
      </div>
    )
  }
}
