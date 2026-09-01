import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './auth/ProtectedRoute'
import DashboardLayout from './components/DashboardLayout'
import ErrorBoundary from './components/ErrorBoundary'
import VersionGate from './components/VersionGate'
import { PrivacyPolicy, TermsOfService } from './pages/Legal'
import Login from './pages/Login'
import ClientsList from './pages/clients/ClientsList'
import ClientForm from './pages/clients/ClientForm'
import ClientDetail from './pages/clients/ClientDetail'
import TripForm from './pages/trips/TripForm'
import TripDetail from './pages/trips/TripDetail'
import TripGrid from './pages/trips/TripGrid'
import ProposalPrint from './pages/trips/ProposalPrint'
import ClientProposalsPrint from './pages/clients/ClientProposalsPrint'
import DelinquentPrint from './pages/clients/DelinquentPrint'
import RfpForm from './pages/rfp/RfpForm'
import ContractUpload from './pages/contracts/ContractUpload'
import ContractsList from './pages/contracts/ContractsList'
import ContractRules from './pages/contracts/ContractRules'
import ContractsPrint from './pages/contracts/ContractsPrint'
import TemplateEditor from './pages/settings/TemplateEditor'
import SettingsPage from './pages/settings/Settings'
import Dashboard from './pages/Dashboard'
import Playbook from './pages/Playbook'
import HotelsList from './pages/hotels/HotelsList'
import Tickets from './pages/tickets/Tickets'
import TeamPage from './pages/team/TeamPage'
import TimelinePage from './pages/timeline/TimelinePage'
import StatusPage from './pages/StatusPage'

export default function App() {
  return (
    <ErrorBoundary>
    <VersionGate />
    <Routes>
      {/* Public hotel-facing pages — no auth required */}
      <Route path="/rfp/:token" element={<RfpForm />} />
      <Route path="/contract/:token" element={<ContractUpload />} />

      <Route path="/login" element={<Login />} />

      {/* Public legal pages */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />

      <Route element={<ProtectedRoute />}>
        {/* Standalone print page — no sidebar/scroll-container chrome, so the
            browser's print/Save-as-PDF can flow across multiple pages instead
            of being clipped to whatever fits in DashboardLayout's viewport. */}
        <Route path="trips/:id/proposal" element={<ProposalPrint />} />
        <Route path="clients/:id/proposals" element={<ClientProposalsPrint />} />
        <Route path="clients/:id/delinquent" element={<DelinquentPrint />} />
        <Route path="contracts/print" element={<ContractsPrint />} />

        <Route element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="playbook" element={<Playbook />} />

          <Route path="clients" element={<ClientsList />} />
          <Route path="clients/new" element={<ClientForm />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="clients/:id/edit" element={<ClientForm />} />

          {/* Trips list retired — the Dashboard is the trips home. Redirect any
              old links/bookmarks there. The trip sub-routes below stay. */}
          <Route path="trips" element={<Navigate to="/" replace />} />
          <Route path="trips/new" element={<TripForm />} />
          <Route path="trips/:id" element={<TripDetail />} />
          <Route path="trips/:id/edit" element={<TripForm />} />
          <Route path="trips/:id/grid" element={<TripGrid />} />

          <Route path="contracts" element={<ContractsList />} />
          <Route path="contracts/rules" element={<ContractRules />} />
          <Route path="hotels" element={<HotelsList />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="template" element={<TemplateEditor />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="status" element={<StatusPage />} />
        </Route>
      </Route>
    </Routes>
    </ErrorBoundary>
  )
}
