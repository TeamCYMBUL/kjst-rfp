import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './auth/ProtectedRoute'
import DashboardLayout from './components/DashboardLayout'
import Login from './pages/Login'
import ClientsList from './pages/clients/ClientsList'
import ClientForm from './pages/clients/ClientForm'
import ClientDetail from './pages/clients/ClientDetail'
import TripsList from './pages/trips/TripsList'
import TripForm from './pages/trips/TripForm'
import TripDetail from './pages/trips/TripDetail'
import TripGrid from './pages/trips/TripGrid'
import ProposalPrint from './pages/trips/ProposalPrint'
import RfpForm from './pages/rfp/RfpForm'
import TemplateEditor from './pages/settings/TemplateEditor'
import SettingsPage from './pages/settings/Settings'
import Dashboard from './pages/Dashboard'
import HotelsList from './pages/hotels/HotelsList'
import TeamPage from './pages/team/TeamPage'

export default function App() {
  return (
    <Routes>
      {/* Public hotel-facing form — no auth required */}
      <Route path="/rfp/:token" element={<RfpForm />} />

      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />

          <Route path="clients" element={<ClientsList />} />
          <Route path="clients/new" element={<ClientForm />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="clients/:id/edit" element={<ClientForm />} />

          <Route path="trips" element={<TripsList />} />
          <Route path="trips/new" element={<TripForm />} />
          <Route path="trips/:id" element={<TripDetail />} />
          <Route path="trips/:id/edit" element={<TripForm />} />
          <Route path="trips/:id/grid" element={<TripGrid />} />
          <Route path="trips/:id/proposal" element={<ProposalPrint />} />

          <Route path="hotels" element={<HotelsList />} />
          <Route path="template" element={<TemplateEditor />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="team" element={<TeamPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
