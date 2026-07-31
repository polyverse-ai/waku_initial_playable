import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installViewportScale } from "./lib/viewport-scale";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found. Ensure index.html contains <div id=\"root\"></div>.");
}

// Scale the whole playable as one piece when the host shrinks the webview frame
// proportionally (edit/card mode), instead of letting it reflow. See the module.
installViewportScale(rootElement);

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
