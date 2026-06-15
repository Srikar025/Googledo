import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import EditorPage from './pages/Editor'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor/:docId" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  )
}
