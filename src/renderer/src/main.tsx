import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { OverlayApp } from "./OverlayApp";
import { PermissionApp } from "./PermissionApp";
import { SettingsApp } from "./components/settings/settings-view";
import "./styles/globals.css";

// All windows load this same bundle; the URL hash selects which experience
// mounts: `#settings` → settings, `#overlay` → the always-on-top action HUD,
// `#permission` → the sensitive-tool prompt popup, otherwise the main voice
// experience.
const route = window.location.hash.replace(/^#\/?/, "");
const isSettings = route === "settings";
const isOverlay = route === "overlay";
const isPermission = route === "permission";

// Expose host platform + which window this is so CSS can adapt the chrome (the
// frameless main window's traffic lights; the transparent overlay/popup bodies).
document.documentElement.dataset.platform = window.opendex.platform;
document.documentElement.dataset.window = isSettings
  ? "settings"
  : isOverlay
    ? "overlay"
    : isPermission
      ? "permission"
      : "main";

const Root = isSettings
  ? SettingsApp
  : isOverlay
    ? OverlayApp
    : isPermission
      ? PermissionApp
      : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
