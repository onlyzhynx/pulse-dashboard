import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './utils/fetchCache.js'   // must install before any component fetches
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
