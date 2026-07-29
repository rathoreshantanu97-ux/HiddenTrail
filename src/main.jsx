import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import MapPreviewPage from './components/MapPreviewPage.jsx'

// Minimal path check -- no router library needed for just one extra page.
// Visit /preview (e.g. http://localhost:5173/preview or
// https://your-game.vercel.app/preview) to see the map preview/inspector
// tool described in src/maps/mapSchema.js. Everything else renders the
// normal game.
const isPreviewRoute = window.location.pathname.startsWith('/preview')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isPreviewRoute ? <MapPreviewPage /> : <App />}
  </React.StrictMode>,
)
