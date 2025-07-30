import React from 'react';
import ReactDOM from 'react-dom/client'; // Importa da 'react-dom/client' per React 18+
import './index.css'; // Potresti voler creare questo file CSS o rimuovere l'importazione
import App from './App'; // Assicurati che App.js sia nella stessa cartella src

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
