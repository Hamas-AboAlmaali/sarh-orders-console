import { useEffect, useState } from "react";

/** Whole seconds since `running` became true; 0 while it is false. */
export function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [running]);

  return running ? seconds : 0;
}
