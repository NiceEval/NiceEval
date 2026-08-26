import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { createViewRouter } from "./router.tsx";
import "./styles.css";
import "./enhance.js";

const root = document.getElementById("root");
if (root === null) throw new Error("NiceEval View root is missing");

void createViewRouter().then((router) => {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}).catch((cause: unknown) => {
  root.replaceChildren(document.createTextNode(
    cause instanceof Error ? cause.message : "NiceEval View could not open this RecordSnapshot.",
  ));
});
