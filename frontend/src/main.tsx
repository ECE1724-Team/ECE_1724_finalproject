import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from "react-router";
import './global.css'
import Dashboard from './routes/Dashboard'
import Applications from './routes/Applications'
import Interview from './routes/Interview';
import Application from './routes/Application';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/application/:id" element={<Application />} />
        <Route path="/interview" element={<Interview />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
