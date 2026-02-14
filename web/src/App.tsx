import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import InboxPage from './pages/InboxPage'
import DetailPage from './pages/DetailPage'
import ArchivePage from './pages/ArchivePage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/items/:id" element={<DetailPage />} />
        <Route path="/archive" element={<ArchivePage />} />
      </Route>
    </Routes>
  )
}
