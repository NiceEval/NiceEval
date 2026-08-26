import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { router } from "./router.tsx";
import "./i18n.ts";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("NiceEval View root is missing");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
