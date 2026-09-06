import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/layout/AppShell'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './hooks/useAuth'
import { AdminAllAssignmentsPage } from './pages/AdminAllAssignmentsPage'
import { AdminTeamPage } from './pages/AdminTeamPage'
import { CalendarPage } from './pages/CalendarPage'
import { EmptyProjectState } from './pages/EmptyProjectState'
import { LoginPage } from './pages/LoginPage'
import { ProjectTasksPage } from './pages/ProjectTasksPage'
import { StyleguidePage } from './pages/StyleguidePage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { isOwnerRole } from './utils/role'

function Gate() {
  const { user, member, loading } = useAuth()

  if (loading) {
    return <div className="flex min-h-full items-center justify-center bg-bg text-text-muted">Loading…</div>
  }

  if (!user || !member) {
    return <LoginPage />
  }

  const ownerOnly = (el: React.ReactElement) => (isOwnerRole(member.role) ? el : <Navigate to="/" replace />)

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<EmptyProjectState />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/clients/:clientId/projects/:projectId" element={<ProjectTasksPage />} />
        {/* Its own full page, not an overlay on the task list — a direct link
            (from Admin → All Assignments, say) opens the same real page. */}
        <Route path="/clients/:clientId/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="/admin/team" element={ownerOnly(<AdminTeamPage />)} />
        <Route path="/admin/assignments" element={ownerOnly(<AdminAllAssignmentsPage />)} />
        <Route path="/styleguide" element={ownerOnly(<StyleguidePage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
