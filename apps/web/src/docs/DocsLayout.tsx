import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { BrandLockup } from '../brand/AnimatedBrand';
import { DOC_PAGES } from './content';
import './docs.css';

const EXTRA_LINKS = [{ to: '/docs/playground', label: 'Playground' }];

/** Compact header, side navigation (a closed-by-default drawer on mobile) and the reading column. */
export function DocsLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="docs">
      <header className="docs__header">
        <button
          className="docs__menu"
          aria-expanded={open}
          aria-controls="docs-nav"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <Link to="/" className="docs__home" aria-label="DISMODO home">
          <BrandLockup size={22} />
        </Link>
        <span className="docs__area">Documentation</span>
      </header>
      <div className="docs__body">
        <nav id="docs-nav" className={`docs__nav${open ? ' is-open' : ''}`} aria-label="Documentation">
          <ul>
            {DOC_PAGES.map((page) => (
              <li key={page.slug}>
                <NavLink to={page.slug ? `/docs/${page.slug}` : '/docs'} end>
                  {page.nav}
                  {page.status && (
                    <span className={`docs__status docs__status--${page.status.toLowerCase()}`}>
                      {page.status}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
          <ul className="docs__nav-extra">
            {EXTRA_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to}>{link.label}</NavLink>
              </li>
            ))}
            <li>
              <a href="/llms.txt">llms.txt</a>
            </li>
          </ul>
        </nav>
        {open && <div className="docs__scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
        <main className="docs__main">{children}</main>
      </div>
    </div>
  );
}
