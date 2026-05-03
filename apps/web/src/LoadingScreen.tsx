import { useState, type TransitionEvent } from "react";

export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);

  const handleTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && fadeOut) {
      onComplete();
    }
  };

  return (
    <div
      className={`loading-screen${fadeOut ? " fade-out" : ""}`}
      onTransitionEnd={handleTransitionEnd}
    >
      <iframe src="/loading.html" title="Loading animation" />
      {!fadeOut && (
        <div
          className="loading-click-catcher"
          onClick={() => setFadeOut(true)}
        />
      )}
    </div>
  );
}
