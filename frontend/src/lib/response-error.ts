function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function responseError(response: Response, fallback: string): Promise<Error> {
  let message = fallback
  try {
    const body: unknown = await response.json()
    if (isRecord(body)) {
      if (isRecord(body.error) && typeof body.error.message === "string" && body.error.message.trim()) {
        message = body.error.message
      } else if (typeof body.message === "string" && body.message.trim()) {
        message = body.message
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      message = `${fallback} Unable to read the server's error response.`
    }
  }
  return new Error(`Server Error ${response.status}: ${message}`)
}
