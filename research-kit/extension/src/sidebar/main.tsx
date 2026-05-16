import React from 'react'
import ReactDOM from 'react-dom/client'
// FIX: Changed from default import to named import (App is exported as named export)
import { App } from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
