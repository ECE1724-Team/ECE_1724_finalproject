import { useState, type SubmitEvent } from "react"
import { useNavigate } from "react-router"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, signUp } from "@/lib/auth"
import styles from "@/styles/Login.module.css"

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [registrationComplete, setRegistrationComplete] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      if (mode === "register") {
        await signUp(name, email, password)
        setRegistrationComplete(true)
      } else {
        await signIn(email, password)
        navigate("/")
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to continue. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode)
    setError(null)
    setRegistrationComplete(false)
  }

  return (
    <main className={styles.page}>
      <div className={styles.modeSwitch} role="group" aria-label="Choose login or registration">
        <Button
          type="button"
          variant={mode === "login" ? "default" : "outline"}
          aria-pressed={mode === "login"}
          onClick={() => switchMode("login")}
        >
          Login
        </Button>
        <Button
          type="button"
          variant={mode === "register" ? "default" : "outline"}
          aria-pressed={mode === "register"}
          onClick={() => switchMode("register")}
        >
          Register
        </Button>
      </div>

      {mode === "login" ? (
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Sign in to your JobFlo.AI account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.fieldGroup}>
                <Label htmlFor="login-email">Email</Label>
                <Input
                  autoComplete="email"
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <Label htmlFor="login-password">Password</Label>
                <Input
                  autoComplete="current-password"
                  id="login-password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Signing in..." : "Login"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>
              Create a JobFlo.AI account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {registrationComplete ? (
              <Alert>
                <AlertDescription>
                  Check your email for a verification link. You must verify your email before logging in.
                </AlertDescription>
              </Alert>
            ) : (
              <form className={styles.form} onSubmit={handleSubmit}>
                <div className={styles.fieldGroup}>
                  <Label htmlFor="register-name">Name</Label>
                  <Input
                    autoComplete="name"
                    id="register-name"
                    name="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    autoComplete="email"
                    id="register-email"
                    name="email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <Label htmlFor="register-password">Password</Label>
                  <Input
                    autoComplete="new-password"
                    id="register-password"
                    name="password"
                    type="password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating account..." : "Create account"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
