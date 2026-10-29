import { BrowserRouter, Route, Routes } from 'react-router';
import { LandingPage } from './landing/LandingPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
