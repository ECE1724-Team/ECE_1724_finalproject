export class AuthFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) { super(message); }
}

export function authErrorResponse(error: AuthFailure): Response {
  return Response.json({ code: error.code, message: error.message }, {
    status: error.status,
    headers: error.retryAfter === undefined ? {} : { "Retry-After": String(error.retryAfter) },
  });
}
