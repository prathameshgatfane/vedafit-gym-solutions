import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getEnv } from "./lib/env";
import "./index.css";

// Fail fast, with a clear message, if required env vars are missing — before we ever
// try to render anything that depends on them.
const env = getEnv();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App apiUrl={env.VITE_API_URL} />
  </StrictMode>,
);
