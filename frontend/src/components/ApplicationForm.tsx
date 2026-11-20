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
import ResumeUploadForm from "@/components/ResumeUploadForm";
import { Link } from "react-router";
import type {
  Application,
  ApplicationCreate,
  ApplicationStatus,
  ApiError,
  Resume,
  ResumeList,
} from "../types";
import { fakeResumes } from "../lib/testpayloads";
import styles from "@/styles/ApplicationForm.module.css";

type ApplicationFormProps = {
  application?: Application;
  locked?: boolean;
  mock?: boolean;
};

type ApplicationFormData = {
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  jobUrl: string;
  jobDescription: string;
  appliedDate: string;
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
  appliedDate: "",
  resumeId: "",
  notes: "",
  companyWebsiteUrl: "",
  companyNotes: "",
};

const statuses: ApplicationStatus[] = [
  "saved",
  "applied",
  "oa",
  "interview",
  "offer",
  "rejected",
];

const NO_RESUME = "No Resumes Found";

function getExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!URL.canParse(trimmed)) return null;

  const url = new URL(trimmed);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return null;
  }
  return url.href;
}

export default function ApplicationForm({
  application,
  mock = false,
}: ApplicationFormProps) {
  const isViewMode = application ? true : false;
  const [form, setForm] = useState<ApplicationFormData>(
    application
      ? {
        companyName: application.companyName,
        jobTitle: application.jobTitle,
        status: application.status,
        jobUrl: application.jobUrl ?? "",
        jobDescription: application.jobDescription ?? "",
        appliedDate: application.appliedDate ?? "",
        resumeId: application.resumeId ?? "",
        notes: application.notes ?? "",
        companyWebsiteUrl: application.companyWebsiteUrl ?? "",
        companyNotes: application.companyNotes ?? "",
      }
      : emptyForm,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumes, setResumes] = useState<Resume[]>(mock ? fakeResumes : []);
  const [loadingResumes, setLoadingResumes] = useState(true);
  const [showResumeUpload, setShowResumeUpload] = useState(false);

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

    if(mock) {
        setResumes(fakeResumes);
        setLoadingResumes(false);
        return;
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
    if (submitting || isViewMode) return;

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
      appliedDate: form.appliedDate || null,
      resumeId: form.resumeId.trim() || null,
      notes: form.notes.trim() || undefined,
      companyWebsiteUrl: form.companyWebsiteUrl.trim() || undefined,
      companyNotes: form.companyNotes.trim() || null,
      offerReceived: false,
      interviews: [],
    };

    setError(null);
    setSubmitting(true);

    try {
      console.log(payload)
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

  const disabled = submitting || isViewMode;
  const fieldClass = isViewMode
    ? styles.fieldView
    : styles.fieldEdit;
  const textareaClass = isViewMode
    ? styles.textareaView
    : styles.fieldEdit;
  const jobUrlHref = isViewMode ? getExternalUrl(form.jobUrl) : null;
  const companyWebsiteHref = isViewMode ? getExternalUrl(form.companyWebsiteUrl) : null;

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className={styles.form}
    >
      {error && (
        <Alert variant="destructive" className={styles.errorAlert}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className={styles.fieldGrid}>
        <div>
          <Label htmlFor="companyName" className={styles.fieldLabel}>
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
          <Label htmlFor="jobTitle" className={styles.fieldLabel}>
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
          <Label htmlFor="status" className={styles.fieldLabel}>
            Status
          </Label>
          {isViewMode ? (
            <p className={styles.fieldValue}>{form.status}</p>
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
          <Label htmlFor="appliedDate" className={styles.fieldLabel}>
            Applied date
          </Label>
          <Input
            id="appliedDate"
            name="appliedDate"
            type="date"
            value={form.appliedDate}
            disabled={disabled}
            className={fieldClass}
            onChange={(event) => updateField("appliedDate", event.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="jobUrl" className={styles.fieldLabel}>
          Job URL
        </Label>
        {isViewMode ? (
          jobUrlHref ? (
            <a
              href={jobUrlHref}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
            >
              {form.jobUrl}
            </a>
          ) : (
            <p className={styles.fieldValue}>{form.jobUrl || "Not provided"}</p>
          )
        ) : (
          <Input
            id="jobUrl"
            name="jobUrl"
            type="url"
            value={form.jobUrl}
            disabled={disabled}
            className={fieldClass}
            onChange={(event) => updateField("jobUrl", event.target.value)}
          />
        )}
      </div>

      <div className={styles.fieldGrid}>
        <div className={styles.resumeField}>
          <div className={styles.resumeHeader}>
            <Label htmlFor="resumeId">Resume</Label>
            {!isViewMode && !showResumeUpload && !mock && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setShowResumeUpload(true)}
              >
                {"Upload New Resume"}
              </Button>
            )}
          </div>
          {isViewMode ? (
            <p className={styles.fieldValue}>
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
              <SelectTrigger id="resumeId" className={`${fieldClass} ${styles.fullWidth}`}>
                <SelectValue
                  placeholder={loadingResumes ? "Loading resumes..." : "Select a resume"}
                >
                  {loadingResumes && form.resumeId
                    ? "Loading resumes..."
                    : form.resumeId
                      ? resumes.find((resume) => resume.id === form.resumeId)?.name
                        ?? "Resume unavailable"
                      : "No resume"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={styles.selectContent}>
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
        {showResumeUpload && !isViewMode && (
          <div className={styles.uploadCard}>
            <ResumeUploadForm
              onCancel={() => setShowResumeUpload(false)}
              onUploaded={(resume) => {
                setResumes((current) => [resume, ...current])
                updateField("resumeId", resume.id)
                setError(null)
                setShowResumeUpload(false)
              }}
            />
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="jobDescription" className={styles.fieldLabel}>
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
        <Label htmlFor="companyWebsiteUrl" className={styles.fieldLabel}>
          Company website
        </Label>
        {isViewMode ? (
          companyWebsiteHref ? (
            <a
              href={companyWebsiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
            >
              {form.companyWebsiteUrl}
            </a>
          ) : (
            <p className={styles.fieldValue}>{form.companyWebsiteUrl || "Not provided"}</p>
          )
        ) : (
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
        )}
      </div>

      <div>
        <Label htmlFor="companyNotes" className={styles.fieldLabel}>
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
        <Label htmlFor="notes" className={styles.fieldLabel}>
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

      <div className={styles.formActions}>
        <Button
          nativeButton={false}
          render={<Link to="/applications" />}
          variant={isViewMode ? "default" : "outline"}
          className={isViewMode ? styles.backButtonView : styles.actionButton}
        >
          Back to all applications
        </Button>
        {!isViewMode && (
          <Button
            type="submit"
            disabled={disabled}
            className={styles.submitButton}
          >
            {submitting ? "Creating..." : "Create application"}
          </Button>
        )}
      </div>
    </form>
  );
}
