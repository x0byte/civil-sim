import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import "./ui/system.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dissolve the opening screen (in index.html) once the first frame of the app is on screen.
requestAnimationFrame(() => requestAnimationFrame(() => (window as { __splashReady?: () => void }).__splashReady?.()));
