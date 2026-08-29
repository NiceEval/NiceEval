import { Component, StrictMode, Suspense, use, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import i18n from "./i18n.ts";
import { createViewRouter } from "./router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("NiceEval View root is missing");

// Bootstrap is application-owned. StrictMode may replay components, but it
// cannot create a second Worker or repository.
const bootstrap = createViewRouter();

function ViewRoot() {
  const router = use(bootstrap);
  return <RouterProvider router={router} />;
}

class RootErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { readonly failed: true } { return { failed: true }; }
  componentDidCatch(_error: unknown, _info: ErrorInfo): void {}
  render() {
    return this.state.failed
      ? <main className="niceeval-view-main" role="alert"><h1>{i18n.t("app.failed")}</h1></main>
      : this.props.children;
  }
}

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <Suspense fallback={null}><ViewRoot /></Suspense>
    </RootErrorBoundary>
  </StrictMode>,
);
