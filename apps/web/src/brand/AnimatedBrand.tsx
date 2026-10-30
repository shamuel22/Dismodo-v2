import { LOGO_URL } from './constants';
import './brand.css';

/**
 * Horizontal brand (the design spec §6, §9): the approved logo PNG used as an atlas. Both book pages are the same
 * symbol crop with complementary masks around the spine; the wordmark slides out from behind the book.
 * Purely decorative: the accessible name is the surrounding h1 text.
 */
export function AnimatedBrand({ state }: { state: 'pending' | 'playing' | 'final' }) {
  return (
    <div className={`brand brand--${state}`} aria-hidden="true">
      <div className="brand__book">
        <span className="brand__page brand__page--left" style={{ backgroundImage: `url(${LOGO_URL})` }} />
        <span className="brand__page brand__page--right" style={{ backgroundImage: `url(${LOGO_URL})` }} />
      </div>
      <div className="brand__word-mask">
        <span className="brand__word" style={{ backgroundImage: `url(${LOGO_URL})` }} />
      </div>
    </div>
  );
}

/** Static horizontal logo for headers (no animation). */
export function BrandLockup({ size = 28 }: { size?: number }) {
  return (
    <span
      className="brand brand--static"
      style={{ '--S': `${size}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="brand__book">
        <span className="brand__page brand__page--left" style={{ backgroundImage: `url(${LOGO_URL})` }} />
        <span className="brand__page brand__page--right" style={{ backgroundImage: `url(${LOGO_URL})` }} />
      </span>
      <span className="brand__word-mask">
        <span className="brand__word" style={{ backgroundImage: `url(${LOGO_URL})` }} />
      </span>
    </span>
  );
}
