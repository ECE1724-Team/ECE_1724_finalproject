export type ApplicationStatus =
  | "saved"
  | "applied"
  | "oa"
  | "interview"
  | "offer"
  | "rejected";

export type Interview = {
  id: string;
  type: string;
  scheduledAt: string;
};

export type InterviewInput = {
  id?: string;
  type: string;
  scheduledAt: string;
};

export type ApplicationFields = {
  companyName: string;
  jobTitle: string;
  status?: ApplicationStatus;
  appliedDate?: string | null;
  jobDescription?: string | null;
  jobUrl?: string | null;
  resumeId?: string | null;
  companyWebsiteUrl?: string | null;
  companyNotes?: string | null;
  notes?: string | null;
  offerReceived?: boolean;
  interviews?: InterviewInput[];
};

export type ApplicationCreate = ApplicationFields;

export type ApplicationReplace = ApplicationFields & {
  status: ApplicationStatus;
  rowVersion?: string;
};

export type ApplicationStatusChange = {
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  changedAt: string;
};

export type Application = {
  id: string;
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  jobDescription: string | null;
  jobUrl: string | null;
  resumeId: string | null;
  resumeName: string | null;
  companyWebsiteUrl: string | null;
  companyNotes: string | null;
  notes: string | null;
  offerReceived: boolean;
  interviews: Interview[];
  statusHistory: ApplicationStatusChange[];
  rowVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationSummary = {
  id: string;
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  resumeId: string | null;
  resumeName: string | null;
  createdAt: string;
};

export type ApplicationList = {
  data: ApplicationSummary[];
  counts: {
    total: number;
    byStatus: Record<ApplicationStatus, number>;
  };
};

export type DashboardData = {
  counts: ApplicationList["counts"];
  offersEverReceived: number;
  interviewSessions: number;
  upcomingInterviews: {
    timeZone: string;
    start: string;
    end: string;
    items: {
      id: string;
      applicationId: string;
      type: string;
      scheduledAt: string;
      companyName: string;
      jobTitle: string;
    }[];
  };
  recentApplications: ApplicationSummary[];
};

export type ResumeUpload = {
  name: string;
  file: Blob;
};

export type Resume = {
  id: string;
  name: string;
  fileName: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  createdAt: string;
  textStatus: "available" | "unavailable";
  linkedApplicationCount: number;
};

export type ResumeList = {
  data: Resume[];
};

export type ResumeDeleteResult = {
  unlinkedApplicationCount: number;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

export type ErrorResponse = ApiError;

export type BetterAuthSignUp = {
  name: string;
  email: string;
  password: string;
  image?: string;
  callbackURL?: string;
};

export type BetterAuthSignIn = {
  email: string;
  password: string;
  rememberMe?: boolean;
  callbackURL?: string;
};

export type BetterAuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BetterAuthSignUpResult = {
  token: null;
  user: BetterAuthUser;
};

export type BetterAuthSignInResult = {
  token: string;
  user: BetterAuthUser;
  redirect: boolean;
  url?: string | null;
};

export type BetterAuthSession = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt?: string;
  updatedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  token?: string;
};

export type BetterAuthSessionResult = {
  user: BetterAuthUser;
  session: BetterAuthSession;
};

export type BetterAuthSendVerificationEmail = {
  email: string;
  callbackURL?: string;
};

export type BetterAuthSendVerificationEmailResult = {
  status: boolean;
};

export type BetterAuthVerifyEmailResult = {
  status: boolean;
  user: BetterAuthUser | null;
};

export type BetterAuthRequestPasswordReset = {
  email: string;
  redirectTo?: string;
};

export type BetterAuthRequestPasswordResetResult = {
  status: boolean;
  message: string;
};

export type BetterAuthResetPassword = {
  token: string;
  newPassword: string;
};

export type BetterAuthResetPasswordResult = {
  status: boolean;
};

export type BetterAuthChangePassword = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
};

export type BetterAuthUpdateUser = {
  name?: string;
  image?: string | null;
};

export type BetterAuthRevokeSession = {
  token: string;
};

export type BetterAuthError = {
  code?: string;
  message?: string;
  statusCode?: number;
  [key: string]: unknown;
};

export type BetterAuthSuccess = {
  [key: string]: unknown;
};

export type AiRevision = string;
export type AiMaterialFingerprint = string;

export type AiApplicationStatus =
  | "saved"
  | "applied"
  | "oa"
  | "interview"
  | "offer"
  | "rejected";

export type AiApplicationOption = {
  id: string;
  companyName: string;
  jobTitle: string;
  status: AiApplicationStatus;
};

export type AiApplicationList = {
  data: AiApplicationOption[];
};

export type AiMaterialKind = string;
export type AiMaterialAvailability = "available" | "unavailable";

export type AiMaterialVersion = {
  kind: AiMaterialKind;
  fingerprint: AiMaterialFingerprint;
  availability: AiMaterialAvailability;
  sourceResumeId: string | null;
  reasonCode: string | null;
};

export type AiMaterialReference = AiMaterialVersion & {
  snapshotId: string;
};

export type AiCurrentMaterials = Record<string, AiMaterialVersion>;
export type AiGenerationMaterials = Record<string, AiMaterialReference>;
export type AiConversationMaterialState = Record<string, AiMaterialReference>;

export type AiLinkedResume = {
  id: string;
  name: string;
  contentVersion: AiRevision;
};

export type AiWorkspace = {
  id: string;
  applicationId: string;
  companyName: string;
  jobTitle: string;
  linkedResume: AiLinkedResume | null;
  materials: AiCurrentMaterials;
  createdAt: string;
};

export type AiConversation = {
  id: string;
  workspaceId: string;
  title: string | null;
  activeGenerationId: string | null;
  materialState: AiConversationMaterialState;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationList = {
  data: AiConversation[];
};

export type AiGenerationStatus =
  | "preparing"
  | "streaming"
  | "completed"
  | "failed"
  | "interrupted";

export type AiFailure = {
  code: string;
  message: string;
};

export type AiGeneration = {
  id: string;
  conversationId: string;
  inputMessageId: string;
  status: AiGenerationStatus;
  materials: AiGenerationMaterials | null;
  snapshotAt: string | null;
  baselineGenerationId: string | null;
  changedKinds: AiMaterialKind[] | null;
  assistantMessageId: string | null;
  error: AiFailure | null;
  startedAt: string;
  completedAt: string | null;
};

export type AiGenerationList = {
  data: AiGeneration[];
};

export type AiMaterialSnapshot = AiMaterialReference & {
  id: string;
  conversationId: string;
  generationId: string;
  createdAt: string;
  contentText: string | null;
};

export type AiTextPart = {
  type: "text";
  text: string;
};

export type AiToolCallPart = {
  type: "tool-call";
  toolName: string;
  providerCallId: string;
  arguments: Record<string, unknown>;
};

export type AiWebsiteToolResult = {
  type: "website";
  sourceUrl: string;
  retrievedAt: string;
  contentText: string;
};

export type AiToolResultPart = {
  type: "tool-result";
  toolName: string;
  providerCallId: string;
  status: "succeeded" | "failed";
  result: AiWebsiteToolResult | null;
  error: AiFailure | null;
};

export type AiMessagePart = AiTextPart | AiToolCallPart | AiToolResultPart;

export type AiMessage = {
  id: string;
  conversationId: string;
  generationId: string | null;
  sequenceNo: AiRevision;
  role: "user" | "assistant" | "tool";
  parts: AiMessagePart[];
  createdAt: string;
};

export type AiMessageList = {
  data: AiMessage[];
};

export type AiSendMessage = {
  content: string;
};

export type AiGenerationAcceptedEvent = {
  type: "generation.accepted";
  generationId: string;
  inputMessage: AiMessage;
};

export type AiMaterialSyncEvent = {
  type: "materials.synced";
  generationId: string;
  snapshotAt: string;
  baselineGenerationId: string | null;
  materials: AiGenerationMaterials;
  changedKinds: AiMaterialKind[];
};

export type AiTextDeltaEvent = {
  type: "text.delta";
  generationId: string;
  delta: string;
};

export type AiGenerationCompletedEvent = {
  type: "generation.completed";
  generation: AiGeneration;
  message: AiMessage;
};

export type AiGenerationErrorEvent = {
  type: "generation.error";
  generationId: string;
  stage: "preparation" | "context" | "generation" | "persistence";
  error: AiFailure;
  statePersisted: boolean;
};

export type AiStreamEvent =
  | AiGenerationAcceptedEvent
  | AiMaterialSyncEvent
  | AiTextDeltaEvent
  | AiGenerationCompletedEvent
  | AiGenerationErrorEvent;
