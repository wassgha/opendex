import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SettingsApp } from "./components/settings/settings-view";
import "./styles/globals.css";

// Both windows load this same bundle; the settings window is launched with a
// `#settings` hash so it mounts the settings experience instead of the main one.
const isSettings = window.location.hash.replace(/^#\/?/, "") === "settings";

// Expose host platform + which window this is so CSS can adapt the chrome to the
// frameless title bar (only the main window is frameless; settings keeps a frame).
document.documentElement.dataset.platform = window.opendex.platform;
document.documentElement.dataset.window = isSettings ? "settings" : "main";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSettings ? <SettingsApp /> : <App />}</StrictMode>,
);
