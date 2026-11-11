import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { useApp } from "./state/app";
import { usePlayer } from "./state/player";
import { sidPlayer } from "./lib/audio";

if (import.meta.env.DEV) {
  // Debug hook used by the automated smoke test (dev builds only).
  (window as unknown as Record<string, unknown>).__sid = {
    app: useApp,
    player: usePlayer,
    audio: sidPlayer,
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
