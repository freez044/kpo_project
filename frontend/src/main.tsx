import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { AuthProvider } from './services/auth';
import Planner from './Planner';

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><Planner/></AuthProvider></React.StrictMode>);
