import { useState } from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App";
import { LoadingScreen } from "./LoadingScreen";

function Root() {
  const [loading, setLoading] = useState(true);
  return (
    <>
      {loading && <LoadingScreen onComplete={() => setLoading(false)} />}
      <App />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Root />,
);
