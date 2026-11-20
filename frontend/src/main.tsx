import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthProvider } from './auth';
import Planner from './Planner';

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><Planner/></AuthProvider></React.StrictMode>);
