import { useCallback, useEffect, useRef, useState, type TransitionEvent } from "react";

export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const frameWindowRef = useRef<Window | null>(null);

  const requestComplete = useCallback(() => {
    setFadeOut(true);
  }, []);

  const removeFrameHandlers = useCallback(() => {
    const frameWindow = frameWindowRef.current;
    if (!frameWindow) {
      return;
    }

    frameWindow.removeEventListener("click", requestComplete, true);
    frameWindow.removeEventListener("pointerup", requestComplete, true);
    frameWindow.removeEventListener("touchend", requestComplete, true);
    frameWindowRef.current = null;
  }, [requestComplete]);

  const attachFrameHandlers = useCallback(() => {
    removeFrameHandlers();
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) {
      return;
    }

    frameWindowRef.current = frameWindow;
    frameWindow.addEventListener("click", requestComplete, true);
    frameWindow.addEventListener("pointerup", requestComplete, true);
    frameWindow.addEventListener("touchend", requestComplete, true);
  }, [removeFrameHandlers, requestComplete]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as { type?: string };
      if (data.type === "loading-screen-complete") {
        requestComplete();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [requestComplete]);

  useEffect(() => removeFrameHandlers, [removeFrameHandlers]);

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
      <iframe ref={iframeRef} src="/loading.html" title="Loading animation" onLoad={attachFrameHandlers} />
    </div>
  );
}
