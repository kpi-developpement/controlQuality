// src/main.jsx — point d'entrée
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';
import api from './api.js';
import { initRipple, attachNetworkProgress } from './ui/motion.js';
import { initSpotlight } from './ui/spotlight.js';
import { initTilt } from './ui/tilt.js';
import { initPerf } from './ui/perf.js';
import { readTheme } from './ui/themeStore.js';

// Thème appliqué avant le premier rendu (sombre par défaut ; évite un flash clair → sombre)
document.documentElement.classList.add(readTheme());

initPerf();
initRipple();
initSpotlight();
initTilt();
attachNetworkProgress(api);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
