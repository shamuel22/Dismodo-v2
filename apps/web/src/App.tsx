import { BrowserRouter, Route, Routes } from 'react-router';
import { LandingPage } from './landing/LandingPage';
import { SessionPage } from './session/SessionPage';
import { DocPageView } from './docs/DocPageView';
import { DocsLayout } from './docs/DocsLayout';
import { PlaygroundPage } from './docs/PlaygroundPage';
import { ConsolePage } from './docs/ConsolePage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/s" element={<SessionPage />} />
        <Route
          path="/docs/playground"
          element={
            <DocsLayout>
              <PlaygroundPage />
            </DocsLayout>
          }
        />
        <Route
          path="/docs/console"
          element={
            <DocsLayout>
              <ConsolePage />
            </DocsLayout>
          }
        />
        <Route
          path="/docs/:slug?"
          element={
            <DocsLayout>
              <DocPageView />
            </DocsLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
