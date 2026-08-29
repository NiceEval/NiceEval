import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import i18n from "./i18n.ts";
import { createViewRouter } from "./router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("NiceEval View root is missing");

void createViewRouter().then((router) => {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}).catch((cause: unknown) => {
  void cause;
  root.replaceChildren(document.createTextNode(i18n.t("app.failed")));
});
