import { createRoot, type Root } from 'react-dom/client';
import { SessionPage } from './session/SessionPage';
import tokens from './styles/tokens.css?inline';
import components from './styles/components.css?inline';
import brand from './brand/brand.css?inline';
import session from './session/session.css?inline';

/** Tokens are declared on :root for the site; inside a shadow root they belong on :host. */
const STYLES = [
  tokens.replace(':root', ':host'),
  `:host { display: block; color: var(--color-text); font-family: var(--font-body); line-height: 1.7;
     background: var(--color-background); border-radius: var(--radius-card); padding: 0 var(--space-5); }
   :host *, :host *::before, :host *::after { box-sizing: border-box; }
   h1, h2, h3 { font-family: var(--font-display); font-weight: 500; margin: 0; }`,
  components,
  brand,
  session,
].join('\n');

/**
 * <dismodo-session token="…" api="https://dismodo.example"></dismodo-session>
 *
 * Embeds a learner session in any page. Styles live in a shadow root so the host page's CSS and DISMODO's
 * never mix. The token is the part of the learner link after "#".
 */
class DismodoSessionElement extends HTMLElement {
  static observedAttributes = ['token', 'api'];
  private root: Root | null = null;

  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      const mount = document.createElement('div');
      mount.dataset.mount = '';
      shadow.append(style, mount);
    }
    // Moving the element in the DOM disconnects and reconnects it: recreate the React root each time.
    if (!this.root) this.root = createRoot(this.shadowRoot!.querySelector('[data-mount]')!);
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = null;
  }

  private render() {
    const token = this.getAttribute('token') ?? '';
    if (!this.root || !token) return;
    this.root.render(
      <SessionPage
        key={token}
        token={token}
        embedded
        apiBase={this.getAttribute('api') ?? undefined}
        onChange={() =>
          this.dispatchEvent(new CustomEvent('dismodo:change', { bubbles: true, composed: true }))
        }
      />,
    );
  }
}

if (!customElements.get('dismodo-session')) customElements.define('dismodo-session', DismodoSessionElement);
