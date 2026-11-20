import { Navigate, Outlet } from "react-router"
import ErrorAlert from "@/components/ErrorAlert"
import { useAuth } from "@/components/AuthProvider"

export default function RequireAuth() {
  const { status, error } = useAuth()

  if (status === "checking") {
    return <p role="status">Checking sign-in status...</p>
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />
  }

  if (status === "error") {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-12">
        {error && <ErrorAlert message={error} />}
      </main>
    )
  }

  return <Outlet />
}
