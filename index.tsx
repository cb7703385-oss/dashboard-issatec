
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import * as XLSX from 'xlsx';

// Make XLSX available globally for the components that might use it
(window as any).XLSX = XLSX;


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
