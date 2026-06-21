import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SettingsApp } from "./components/settings/settings-view";
import "./styles/globals.css";

// Both windows load this same bundle; the settings window is launched with a
// `#settings` hash so it mounts the settings experience instead of the main one.
const isSettings = window.location.hash.replace(/^#\/?/, "") === "settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSettings ? <SettingsApp /> : <App />}</StrictMode>,
);
