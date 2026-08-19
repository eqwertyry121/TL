import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void error;
    void info;
    console.error("Admin render error");
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatal-error">
        <section className="fatal-error__panel">
          <h1>Админка не загрузилась</h1>
          <p>Обновите страницу. Если ошибка повторится, сообщите разработчику.</p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Обновить
          </button>
        </section>
      </main>
    );
  }
}
