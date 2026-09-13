import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getEnv } from "./lib/env";
import "./index.css";

getEnv();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
