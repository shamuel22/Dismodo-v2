import { useEffect, useState } from 'react';

const CHAR_MS = 24;
const AFTER_SPACE_MS = 39;
const CURSOR_LINGER_MS = 4000;

/**
 * Types the phrase once (the design spec §9). Screen readers get the full phrase immediately; the typing layer is
 * hidden from them. A hidden duplicate reserves the final size so nothing below moves while it grows.
 */
export function TypewriterQuote({
  text,
  startDelayMs,
  reducedMotion,
}: {
  text: string;
  startDelayMs: number;
  reducedMotion: boolean;
}) {
  const [count, setCount] = useState(reducedMotion ? text.length : 0);
  const [cursor, setCursor] = useState<'hidden' | 'typing' | 'resting'>('hidden');

  useEffect(() => {
    if (reducedMotion) {
      setCount(text.length);
      setCursor('hidden');
      return;
    }
    setCount(0);
    setCursor('hidden');
    const timers: number[] = [window.setTimeout(() => setCursor('typing'), startDelayMs)];
    let at = startDelayMs;
    for (let i = 1; i <= text.length; i++) {
      timers.push(window.setTimeout(() => setCount(i), at));
      at += text[i - 1] === ' ' ? AFTER_SPACE_MS : CHAR_MS;
    }
    timers.push(window.setTimeout(() => setCursor('resting'), at));
    timers.push(window.setTimeout(() => setCursor('hidden'), at + CURSOR_LINGER_MS));
    // Cancel everything on unmount or replay so two typings can never overlap.
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [text, startDelayMs, reducedMotion]);

  return (
    <p className="quote">
      <span className="sr-only">{text}</span>
      <span className="quote__measure" aria-hidden="true">
        {text}
      </span>
      <span className="quote__typed" aria-hidden="true">
        {text.slice(0, count)}
        {cursor !== 'hidden' && <span className={`quote__cursor quote__cursor--${cursor}`} />}
      </span>
    </p>
  );
}
