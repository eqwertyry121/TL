import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    console.error("Kitchen render error");
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-error">
        <section className="fatal-error__panel">
          <h1>Кухня не загрузилась</h1>
          <p>Обновите страницу. Если ошибка повторится, сообщите разработчику.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Обновить
          </button>
        </section>
      </main>
    );
  }
}
