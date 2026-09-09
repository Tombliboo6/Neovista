import React from "react";
import ReactDOM from "react-dom/client";

const pathname = window.location.pathname.replace(/\/+$/u, "") || "/";
const root = ReactDOM.createRoot(document.getElementById("root")!);

async function mount() {
  if (pathname === "/prompt-master") {
    const [{ PromptMaster }] = await Promise.all([import("./PromptMaster"), import("./prompt-master.css")]);
    root.render(<React.StrictMode><PromptMaster /></React.StrictMode>);
    return;
  }
  const [{ App }] = await Promise.all([import("./App"), import("./styles.css")]);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

void mount();
