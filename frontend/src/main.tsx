import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from "react-router";
import './styles/global.css'
import Dashboard from './routes/Dashboard'
import Home from './routes/Home'
import Applications from './routes/Applications'
import Interview from './routes/Interview';
import InterviewWorkspace from './routes/InterviewWorkspace';
import Application from './routes/Application';
import Login from './routes/Login';
import Resumes from './routes/Resumes';
import App from './App';
import RequireAuth from './components/RequireAuth';
import { AuthProvider } from './components/AuthProvider';
import NotFound from './routes/NotFound';

const MOCK = false;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/applications" element={<Applications mock={MOCK}/>} />
            <Route path="/application" element={<Application mock={MOCK}/>} />
            <Route path="/application/:id" element={<Application mock={MOCK}/>} />
            <Route path="/resumes" element={<Resumes mock={MOCK}/>} />
            <Route path="/interview" element={<Interview />} />
            <Route path="/interview/:workspaceId/:conversationId?" element={<InterviewWorkspace />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
