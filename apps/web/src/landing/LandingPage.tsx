import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatedBrand } from '../brand/AnimatedBrand';
import { HERO_PHRASE } from '../brand/constants';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { ScrollRevealSection } from './ScrollRevealSection';
import { TypewriterQuote } from './TypewriterQuote';
import './landing.css';

/** Phrase typing starts after the brand has opened (the design spec §9). */
const PHRASE_START_MS = 1750;

export function LandingPage() {
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    document.title = 'DISMODO';
    // Start on the next frame so the initial state paints first and the intro plays exactly once per load.
    const frame = requestAnimationFrame(() => setPlaying(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="landing">
      <nav className="landing__nav" aria-label="Main">
        <Link to="/docs" className="landing__nav-link">
          Documentation
        </Link>
      </nav>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <h1 id="hero-title" className="hero__title">
            <span className="sr-only">DISMODO</span>
            <AnimatedBrand state={reducedMotion ? 'final' : playing ? 'playing' : 'pending'} />
          </h1>
          <TypewriterQuote text={HERO_PHRASE} startDelayMs={PHRASE_START_MS} reducedMotion={reducedMotion} />
          {/* Founder's request (takes precedence over the design spec §8): the documentation is where DISMODO is explained. */}
          <Link to="/docs" className="button button--primary hero__cta">
            View documentation
          </Link>
          <a href="#intro" className="hero__scroll-cue" aria-label="Scroll to the introduction">
            <span className="hero__scroll-line" />
          </a>
        </section>

        <ScrollRevealSection id="intro">
          <section className="intro" aria-labelledby="intro-title">
            <h2 id="intro-title" className="intro__title">
              Your content. Their way of learning.
            </h2>
            <p className="intro__text">
              An adaptive learning engine for the experiences you want to build. Bring your content, keep your
              interface, and adapt the support to each learner.
            </p>
            <Link to="/docs" className="intro__link">
              Explore the documentation
            </Link>
          </section>
          <footer className="landing__footer">
            <span className="landing__footer-name">DISMODO</span>
            <nav aria-label="Integrations" className="landing__footer-nav">
              <Link to="/docs/api">API</Link>
              <Link to="/docs/mcp">MCP</Link>
              <Link to="/docs/sdk">SDK</Link>
            </nav>
          </footer>
        </ScrollRevealSection>
      </main>
    </div>
  );
}
