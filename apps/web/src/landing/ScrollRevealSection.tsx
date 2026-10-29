import { useEffect, useRef, useState, type ReactNode } from 'react';

const MIN_SCROLL_PX = 8;

/**
 * Reveals its content only after a real downward scroll brings it into the top 91% of the viewport
 * (DESIGN.md §10). Time, the intro or an initial intersection on a tall screen never reveal it.
 * Once revealed it stays visible for the rest of the visit.
 */
export function ScrollRevealSection({ children, id }: { children: ReactNode; id?: string }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (revealed || !wrapper.current) return;
    const startY = window.scrollY;
    let scrolledDown = false;
    let intersecting = false;
    const tryReveal = () => {
      if (scrolledDown && intersecting) setRevealed(true);
    };
    const onScroll = () => {
      if (window.scrollY - startY > MIN_SCROLL_PX) {
        scrolledDown = true;
        tryReveal();
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = !!entry?.isIntersecting;
        tryReveal();
      },
      { rootMargin: '0px 0px -9% 0px' },
    );
    observer.observe(wrapper.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [revealed]);

  return (
    <div ref={wrapper} id={id} className="reveal-wrapper">
      <div
        className={`scroll-reveal${revealed ? ' is-visible' : ''}`}
        {...(revealed ? {} : { inert: true, 'aria-hidden': true })}
      >
        {children}
      </div>
    </div>
  );
}
