import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    console.error("Client render error");
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-error">
        <section className="fatal-error__panel">
          <h1>Приложение не загрузилось</h1>
          <p>Обновите страницу или сообщите разработчику.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Обновить
          </button>
        </section>
      </main>
    );
  }
}
