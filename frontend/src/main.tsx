import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from "react-router";
import './styles/global.css'
import Dashboard from './routes/Dashboard'
import Applications from './routes/Applications'
import Interview from './routes/Interview';
import Application from './routes/Application';
import Login from './routes/Login';
import Resumes from './routes/Resumes';
import App from './App';

const MOCK = false;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/applications" element={<Applications mock={MOCK}/>} />
        <Route path="/application" element={<Application mock={MOCK}/>} />
        <Route path="/application/:id" element={<Application mock={MOCK}/>} />
        <Route path="/resumes" element={<Resumes mock={MOCK}/>} />
        <Route path="/interview" element={<Interview />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
