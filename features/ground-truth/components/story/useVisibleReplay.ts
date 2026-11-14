import { useEffect, useRef } from 'react';

/** Keep an offscreen replay pending until that scene can actually reset. */
export function useVisibleReplay(token: number, visible: boolean, reset: () => void) {
  const seen = useRef(token);
  useEffect(() => {
    if (!visible || seen.current === token) return;
    seen.current = token;
    reset();
  }, [token, visible, reset]);
}
