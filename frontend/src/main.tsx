import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";

localStorage.setItem("hunter_theme", "light");
document.documentElement.dataset.theme = "light";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TooltipProvider delayDuration={150}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </BrowserRouter>
  </React.StrictMode>
);
