import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyThemePreference, getStoredThemePreference } from './lib/themeState.js'

applyThemePreference(getStoredThemePreference())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
