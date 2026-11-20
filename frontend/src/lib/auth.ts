type AuthSession = {
  user: {
    id: string
    email: string
  }
  session: {
    id: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAuthSession(value: unknown): value is AuthSession {
  return (
    isRecord(value) &&
    isRecord(value.user) &&
    typeof value.user.id === "string" &&
    typeof value.user.email === "string" &&
    isRecord(value.session) &&
    typeof value.session.id === "string"
  )
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body: unknown = await response.json()
  if (isRecord(body) && typeof body.message === "string") {
    return new Error(body.message)
  }
  return new Error(fallback)
}

export async function getSession(): Promise<AuthSession | null> {
  const response = await fetch("/api/auth/get-session", {
    credentials: "include",
  })

  if (!response.ok) {
    throw await responseError(response, "Unable to check sign-in status.")
  }

  const body: unknown = await response.json()
  if (body === null) return null
  if (!isAuthSession(body)) {
    throw new Error("The server returned an invalid session response.")
  }
  return body
}

export async function signIn(email: string, password: string): Promise<void> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, rememberMe: true }),
  })

  if (!response.ok) {
    throw await responseError(response, "Unable to sign in.")
  }

  const session = await getSession()
  if (!session) {
    throw new Error("Sign-in completed, but no active session was found.")
  }
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  const response = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, password }),
  })

  if (!response.ok) {
    throw await responseError(response, "Unable to register.")
  }
}

export async function signOut(): Promise<void> {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
  })

  if (!response.ok) {
    throw await responseError(response, "Unable to sign out.")
  }
}
