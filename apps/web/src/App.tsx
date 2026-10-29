import { BrowserRouter, Route, Routes } from 'react-router';
import { LandingPage } from './landing/LandingPage';
import { SessionPage } from './session/SessionPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/s" element={<SessionPage />} />
      </Routes>
    </BrowserRouter>
  );
}
