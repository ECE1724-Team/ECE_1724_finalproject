import { Navigate, Outlet } from "react-router"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/AuthProvider"

export default function RequireAuth() {
  const { status, error, refreshSession } = useAuth()

  if (status === "checking") {
    return <p role="status">Checking sign-in status...</p>
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />
  }

  if (status === "error") {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-12">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button type="button" onClick={() => void refreshSession()}>
          Retry
        </Button>
      </main>
    )
  }

  return <Outlet />
}
