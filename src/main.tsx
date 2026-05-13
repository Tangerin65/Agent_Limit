import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import WidgetApp from "./WidgetApp";
import "./styles.css";

function Root() {
  const [windowLabel, setWindowLabel] = React.useState("main");

  React.useEffect(() => {
    try {
      setWindowLabel(getCurrentWebviewWindow().label);
    } catch {
      setWindowLabel("main");
    }
  }, []);

  return windowLabel === "desktop-widget" ? <WidgetApp /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
