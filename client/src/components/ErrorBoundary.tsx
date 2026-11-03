import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui'

interface State {
  error: Error | null
}

// A bug on one page must not blank the whole app: show a message and let the user go back.
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // moving to another page clears the error
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="state state--error" role="alert">
        <h3>This page ran into a problem</h3>
        <p>The rest of the app is fine. Reload the page, or go back to the inventory.</p>
        <div className="row">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <a className="btn" href="/">Go to inventory</a>
        </div>
      </div>
    )
  }
}
