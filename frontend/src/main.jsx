import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AiUnlock from './components/AiUnlock.jsx'
import { aiBuildMode, isAiUnlockPath } from './ai/settings.js'
import 'katex/dist/katex.min.css'
import './index.css'

// A gated build answers /withai with the unlock form; every other build, and
// every other path, is just the app.
const unlockPage = aiBuildMode() === 'gated' && isAiUnlockPath(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {unlockPage ? <AiUnlock /> : <App />}
  </React.StrictMode>
)
