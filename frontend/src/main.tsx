import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from "react-router";
import './global.css'
import Dashboard from './routes/Dashboard'
import Applications from './routes/Application'
import Interview from './routes/Interview';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/interview" element={<Interview />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
