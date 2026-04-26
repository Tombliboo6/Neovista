import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installFrontendErrorReporter } from './lib/frontendErrorReporter.js'
import { applyThemePreference, getStoredThemePreference } from './lib/themeState.js'

applyThemePreference(getStoredThemePreference())
installFrontendErrorReporter()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
