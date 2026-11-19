// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './styles/luxe.css';
import './styles/polish.css';
import api from './api.js';
import { initRipple, attachNetworkProgress, initCardGlow } from './ui/motion.js';

// Applique le thème mémorisé avant le premier rendu (évite le flash clair → sombre)
try {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') document.documentElement.classList.add(t);
} catch { /* ignore */ }

initRipple();
initCardGlow();
attachNetworkProgress(api);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
