import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { getSession } from "@/lib/auth"

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "error"

type AuthContextValue = {
  status: AuthStatus
  error: string | null
  refreshSession: () => Promise<void>
  setAuthenticated: () => void
  setUnauthenticated: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking")
  const [error, setError] = useState<string | null>(null)

  const refreshSession = useCallback(async () => {
    setStatus("checking")
    setError(null)

    try {
      const session = await getSession()
      setStatus(session ? "authenticated" : "unauthenticated")
    } catch (sessionError) {
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "Unable to verify your sign-in status.",
      )
      setStatus("error")
    }
  }, [])

  const setAuthenticated = useCallback(() => {
    setError(null)
    setStatus("authenticated")
  }, [])

  const setUnauthenticated = useCallback(() => {
    setError(null)
    setStatus("unauthenticated")
  }, [])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  return (
    <AuthContext.Provider
      value={{ status, error, refreshSession, setAuthenticated, setUnauthenticated }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error("useAuth must be used within AuthProvider.")
  return auth
}
