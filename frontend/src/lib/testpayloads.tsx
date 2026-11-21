import type { Application, Resume } from "../types";

const mockResumeId = "10000000-0000-4000-8000-000000000001";

const applicationTemplates: Array<
  Pick<Application, "companyName" | "jobTitle" | "status"> & { resumeId?: string }
> = [
  {
    companyName: "Acme Software",
    jobTitle: "Software Engineer",
    status: "applied",
    resumeId: mockResumeId,
  },
  {
    companyName: "Northstar Robotics",
    jobTitle: "Frontend Developer",
    status: "interview",
  },
  {
    companyName: "Maple Analytics",
    jobTitle: "Data Analyst",
    status: "saved",
    resumeId: mockResumeId,
  },
  {
    companyName: "Redwood Health",
    jobTitle: "UX Engineer",
    status: "offer",
  },
  {
    companyName: "Orbit Financial",
    jobTitle: "Product Designer",
    status: "rejected",
  },
];

export const fakeApplications: Application[] = Array.from(
  { length: 45 },
  (_, index) => {
    const template = applicationTemplates[index % applicationTemplates.length];
    const sequence = String(index + 1).padStart(2, "0");
    const date = new Date(Date.UTC(2025, 0, index + 1, 12)).toISOString();

    return {
      ...template,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      companyName: `${template.companyName} (Test ${sequence})`,
      appliedDate: null,
      jobDescription: null,
      jobUrl: null,
      resumeId: template.resumeId ?? null,
      resumeName: template.resumeId ? "Software Engineer Resume" : null,
      companyWebsiteUrl: null,
      companyNotes: null,
      notes: null,
      offerReceived: template.status === "offer",
      interviews: [],
      statusHistory: [],
      rowVersion: String(index + 1),
      createdAt: date,
      updatedAt: date,
    };
  },
);

export const fakeResumes: Resume[] = [
  {
    id: mockResumeId,
    name: "Software Engineer Resume",
    fileName: "software-engineer-resume.pdf",
    mimeType: "application/pdf",
    sizeBytes: 245760,
    createdAt: "2025-01-10T12:00:00Z",
    textStatus: "available",
    linkedApplicationCount: 18,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Product Design Resume",
    fileName: "product-design-resume.pdf",
    mimeType: "application/pdf",
    sizeBytes: 196608,
    createdAt: "2025-02-01T12:00:00Z",
    textStatus: "available",
    linkedApplicationCount: 0,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Data Analyst Resume",
    fileName: "data-analyst-resume.pdf",
    mimeType: "application/pdf",
    sizeBytes: 221184,
    createdAt: "2025-03-01T12:00:00Z",
    textStatus: "unavailable",
    linkedApplicationCount: 0,
  },
];
