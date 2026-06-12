import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const userStr = localStorage.getItem('vision_grader_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      const options = args[1] || {};
      options.headers = {
        ...options.headers,
        'x-auth-cccd': user.cccd,
        'x-auth-role': user.role
      };
      args[1] = options;
    } catch(e) {}
  }
  return originalFetch(...args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
