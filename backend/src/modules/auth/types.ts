/** Server-created identity shared by business, storage, and AI handlers. */
export interface VerifiedAuthContext {
  userId: string;
  sessionId: string;
  emailVerified: true;
}

/** The PostgreSQL-backed Better Auth Session returned by an authoritative read. */
export interface AuthenticatedSession {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    image?: string | null;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}

/** Must bypass cached identity and check current server-side Session state. */
export interface SessionReader {
  getSession(headers: Headers): Promise<AuthenticatedSession | null>;
}
