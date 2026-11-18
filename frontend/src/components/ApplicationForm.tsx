import { useEffect, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import type {
  Application,
  ApplicationCreate,
  ApplicationStatus,
  ApiError,
  Resume,
  ResumeList,
} from "../types";

type ApplicationFormProps = {
  application?: Application;
  locked?: boolean;
};

type ApplicationFormData = {
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  jobUrl: string;
  jobDescription: string;
  location: string;
  appliedAt: string;
  resumeId: string;
  notes: string;
  companyWebsiteUrl: string;
  companyNotes: string;
};

const emptyForm: ApplicationFormData = {
  companyName: "",
  jobTitle: "",
  status: "saved",
  jobUrl: "",
  jobDescription: "",
  location: "",
  appliedAt: "",
  resumeId: "",
  notes: "",
  companyWebsiteUrl: "",
  companyNotes: "",
};

const statuses: ApplicationStatus[] = [
  "saved",
  "applied",
  "interviewing",
  "offered",
  "rejected",
  "withdrawn",
  "accepted",
];

const NO_RESUME = "No Resumes Found";

export default function ApplicationForm({
  application,
}: ApplicationFormProps) {
  const isReadOnly = application ? true : false;
  const [form, setForm] = useState<ApplicationFormData>(
    application
      ? {
        companyName: application.companyName,
        jobTitle: application.jobTitle,
        status: application.status,
        jobUrl: application.jobUrl ?? "",
        jobDescription: application.jobDescription ?? "",
        location: application.location ?? "",
        appliedAt: application.appliedAt ?? "",
        resumeId: application.resumeId ?? "",
        notes: application.notes ?? "",
        companyWebsiteUrl: application.companyWebsiteUrl ?? "",
        companyNotes: application.companyNotes ?? "",
      }
      : emptyForm,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loadingResumes, setLoadingResumes] = useState(true);

  useEffect(() => {

    async function loadResumes() {
      try {
        const response = await fetch("/api/v1/resumes", {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error();
        }

        const result = await response.json() as ResumeList;
        setResumes(result.data);
      } catch (loadError) {
          setError("Failed to load resumes");
      } finally {
          setLoadingResumes(false);
      }
    }

    loadResumes();
  }, []);

  function updateField<K extends keyof ApplicationFormData>(
    field: K,
    value: ApplicationFormData[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || isReadOnly) return;

    if (!form.companyName.trim()) {
      setError("Company name is required");
      return;
    }

    if (!form.jobTitle.trim()) {
      setError("Job title is required");
      return;
    }

    const payload: ApplicationCreate = {
      companyName: form.companyName.trim(),
      jobTitle: form.jobTitle.trim(),
      status: form.status,
      jobUrl: form.jobUrl.trim() || undefined,
      jobDescription: form.jobDescription.trim() || undefined,
      location: form.location.trim() || undefined,
      appliedAt: form.appliedAt
        ? new Date(form.appliedAt).toISOString()
        : null,
      resumeId: form.resumeId.trim() || null,
      notes: form.notes.trim() || undefined,
      companyWebsiteUrl: form.companyWebsiteUrl.trim() || null,
      companyNotes: form.companyNotes.trim() || null,
    };

    setError(null);
    setSubmitting(true);

    try {
      //await new Promise<void>((resolve) => setTimeout(resolve, 5000));

      const response = await fetch("/api/v1/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as
          | ApiError
          | null;
        throw new Error(body?.error.message ?? "Failed to create application");
      }

      setForm(emptyForm);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Failed to create application",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || isReadOnly;
  const fieldClass = isReadOnly
    ? "border-transparent bg-transparent px-0 text-foreground shadow-none disabled:pointer-events-none disabled:cursor-default disabled:bg-transparent disabled:opacity-100 focus-visible:ring-0"
    : "disabled:cursor-default disabled:opacity-60";
  const textareaClass = isReadOnly
    ? "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-foreground shadow-none disabled:pointer-events-none disabled:cursor-default disabled:bg-transparent disabled:opacity-100 focus-visible:ring-0"
    : "disabled:cursor-default disabled:opacity-60";

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="mx-auto grid max-w-2xl gap-5 rounded-lg border border-slate-200 p-6"
    >
      {error && (
        <Alert variant="destructive" className="rounded-md py-2 text-red-700">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="companyName" className="mb-1 block">
            Company name
          </Label>
          <Input
            id="companyName"
            name="companyName"
            type="text"
            required
            value={form.companyName}
            disabled={disabled}
            className={fieldClass}
            onChange={(event) =>
              updateField("companyName", event.target.value)
            }
          />
        </div>

        <div>
          <Label htmlFor="jobTitle" className="mb-1 block">
            Job title
          </Label>
          <Input
            id="jobTitle"
            name="jobTitle"
            type="text"
            required
            value={form.jobTitle}
            disabled={disabled}
            className={fieldClass}
            onChange={(event) => updateField("jobTitle", event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="status" className="mb-1 block">
            Status
          </Label>
          {isReadOnly ? (
            <p className="py-1 text-sm">{form.status}</p>
          ) : (
            <Select
              value={form.status}
              disabled={disabled}
              onValueChange={(value) =>
                updateField("status", value as ApplicationStatus)
              }
            >
              <SelectTrigger id="status" className={fieldClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="appliedAt" className="mb-1 block">
            Applied at
          </Label>
          <Input
            id="appliedAt"
            name="appliedAt"
            type="datetime-local"
            value={form.appliedAt}
            disabled={disabled}
            className={fieldClass}
            onChange={(event) => updateField("appliedAt", event.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="jobUrl" className="mb-1 block">
          Job URL
        </Label>
        <Input
          id="jobUrl"
          name="jobUrl"
          type="url"
          value={form.jobUrl}
          disabled={disabled}
          className={fieldClass}
          onChange={(event) => updateField("jobUrl", event.target.value)}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="location" className="mb-1 block">
            Location
          </Label>
          <Input
            id="location"
            name="location"
            type="text"
            value={form.location}
            disabled={disabled}
            className={fieldClass}
            onChange={(event) => updateField("location", event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="resumeId" className="mb-1 block">
            Resume
          </Label>
          {isReadOnly ? (
            <p className="py-1 text-sm">
              {!form.resumeId
                ? "No resume selected"
                : loadingResumes
                  ? "Loading resumes..."
                  : resumes.find((resume) => resume.id === form.resumeId)?.name
                    ?? "Resume unavailable"}
            </p>
          ) : (
            <Select
              value={form.resumeId || NO_RESUME}
              disabled={disabled || loadingResumes || resumes.length === 0}
              onValueChange={(value) =>
                updateField(
                  "resumeId",
                  !value || value === NO_RESUME ? "" : value,
                )
              }
            >
              <SelectTrigger id="resumeId" className={fieldClass}>
                <SelectValue
                  placeholder={loadingResumes ? "Loading resumes..." : "Select a resume"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_RESUME}>No resume</SelectItem>
                {resumes.map((resume) => (
                  <SelectItem key={resume.id} value={resume.id}>
                    {resume.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="jobDescription" className="mb-1 block">
          Job description
        </Label>
        <Textarea
          id="jobDescription"
          name="jobDescription"
          rows={4}
          value={form.jobDescription}
          disabled={disabled}
          className={textareaClass}
          onChange={(event) =>
            updateField("jobDescription", event.target.value)
          }
        />
      </div>

      <div>
        <Label htmlFor="companyWebsiteUrl" className="mb-1 block">
          Company website
        </Label>
        <Input
          id="companyWebsiteUrl"
          name="companyWebsiteUrl"
          type="url"
          value={form.companyWebsiteUrl}
          disabled={disabled}
          className={fieldClass}
          onChange={(event) =>
            updateField("companyWebsiteUrl", event.target.value)
          }
        />
      </div>

      <div>
        <Label htmlFor="companyNotes" className="mb-1 block">
          Company notes
        </Label>
        <Textarea
          id="companyNotes"
          name="companyNotes"
          rows={3}
          value={form.companyNotes}
          disabled={disabled}
          className={textareaClass}
          onChange={(event) => updateField("companyNotes", event.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="notes" className="mb-1 block">
          Personal notes
        </Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          value={form.notes}
          disabled={disabled}
          className={textareaClass}
          onChange={(event) => updateField("notes", event.target.value)}
        />
      </div>

      {!isReadOnly && (
        <Button
          type="submit"
          disabled={disabled}
          className="disabled:cursor-default disabled:opacity-60"
        >
          {submitting ? "Creating..." : "Create application"}
        </Button>
      )}
    </form>
  );
}
