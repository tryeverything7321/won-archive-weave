import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { failed: boolean };

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route rendering failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="route-recovery section-frame" role="alert">
        <span>연결이 잠시 끊겼어요</span>
        <h1>위브를 다시 불러와 주세요</h1>
        <p>
          새 버전이 배포되는 순간 이전 화면을 열고 있으면 연결이 잠시 끊길 수
          있어요.
        </p>
        <button
          className="button button-primary"
          type="button"
          onClick={() => window.location.reload()}
        >
          새로 불러오기
        </button>
      </section>
    );
  }
}
