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
import ErrorAlert from "@/components/ErrorAlert";
import ApplicationStatusDropdown from "@/components/ApplicationStatusDropdown";
import { Textarea } from "@/components/ui/textarea";
import ResumeUploadForm from "@/components/ResumeUploadForm";
import { Link, useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import type {
  Application,
  ApplicationCreate,
  ApplicationReplace,
  ApplicationStatus,
  Interview,
  InterviewInput,
  Resume,
  ResumeList,
} from "../types";
import { fakeResumes } from "../lib/testpayloads";
import { responseError } from "@/lib/response-error";
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

type InterviewDraft = {
  id?: string;
  type: string;
  localTime: string;
  originalTime?: string;
};

function interviewDrafts(interviews: Interview[]): InterviewDraft[] {
  return interviews.map((interview) => {
    const date = new Date(interview.scheduledAt);
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    const localTime = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
    return { id: interview.id, type: interview.type, localTime, originalTime: interview.scheduledAt };
  });
}

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

function formFromApplication(application: Application): ApplicationFormData {
  return {
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
  };
}

export default function ApplicationForm({
  application,
  mock = false,
}: ApplicationFormProps) {
  const navigate = useNavigate();
  const [savedApplication, setSavedApplication] = useState(application);
  const [editing, setEditing] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const isViewMode = !!savedApplication && !editing;
  const [form, setForm] = useState<ApplicationFormData>(
    application ? formFromApplication(application) : emptyForm,
  );
  const [interviews, setInterviews] = useState<InterviewDraft[]>(
    application ? interviewDrafts(application.interviews) : [],
  );

  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resumesError, setResumesError] = useState<string | null>(null);
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
          throw await responseError(response, "Failed to load resumes.");
        }

        const result = await response.json() as ResumeList;
        setResumes(result.data);
      } catch (loadError) {
          setResumesError(loadError instanceof Error ? loadError.message : "Failed to load resumes.");
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

  async function deleteApplication() {
    if (!savedApplication || deleting || statusSaving) return;
    setDeleteError(null);
    if (mock) {
      setDeleteError("Sample applications cannot be deleted.");
      return;
    }
    if (!window.confirm(
      `Delete ${savedApplication.jobTitle} at ${savedApplication.companyName}? This permanently deletes the application, its interviews, history, and AI conversations. Linked resumes are not deleted.`,
    )) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/v1/applications/${encodeURIComponent(savedApplication.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw await responseError(response, "Failed to delete application.");
      window.alert("Application deleted successfully.");
      navigate("/applications");
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : "Failed to delete application.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || isViewMode) return;

    if (!form.companyName.trim()) {
      setSubmissionError("Company name is required");
      return;
    }

    if (!form.jobTitle.trim()) {
      setSubmissionError("Job title is required");
      return;
    }

    if (mock && savedApplication) {
      setSubmissionError("Sample applications cannot be edited.");
      return;
    }

    const interviewInputs: InterviewInput[] = [];
    for (const [index, interview] of interviews.entries()) {
      const type = interview.type.trim();
      if (!type || [...type].length > 100) {
        setSubmissionError(`interviews[${index}].type must be 1 to 100 characters after trimming.`);
        return;
      }
      const date = new Date(interview.localTime);
      if (!interview.localTime || !Number.isFinite(date.getTime())) {
        setSubmissionError(`interviews[${index}].scheduledAt must be a valid date and time.`);
        return;
      }
      interviewInputs.push({
        ...(interview.id ? { id: interview.id } : {}),
        type,
        scheduledAt: interview.originalTime ?? date.toISOString(),
      });
    }

    const fields = {
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
    };
    const payload: ApplicationCreate | ApplicationReplace = savedApplication
      ? {
        ...fields,
        status: form.status,
        offerReceived: savedApplication.offerReceived,
        interviews: interviewInputs,
        rowVersion: savedApplication.rowVersion,
      }
      : { ...fields, offerReceived: false, interviews: interviewInputs };

    setSubmissionError(null);
    setSubmitting(true);

    try {
      const response = await fetch(savedApplication
        ? `/api/v1/applications/${encodeURIComponent(savedApplication.id)}`
        : "/api/v1/applications", {
        method: savedApplication ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await responseError(response, savedApplication
          ? "Failed to update application."
          : "Failed to create application.");
        if (savedApplication && response.status === 409) {
          throw new Error(`${error.message} Reload the page before trying again.`);
        }
        throw error;
      }

      if (savedApplication) {
        const updated = await response.json() as Application;
        setSavedApplication(updated);
        setForm(formFromApplication(updated));
        setInterviews(interviewDrafts(updated.interviews));
        setEditing(false);
        setShowResumeUpload(false);
        window.alert("Application updated successfully.");
      } else {
        window.alert("Application created successfully.");
        navigate("/applications");
      }
    } catch (failure) {
      setSubmissionError(
        failure instanceof Error
          ? failure.message
          : savedApplication ? "Failed to update application." : "Failed to create application.",
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
      {submissionError && <ErrorAlert message={submissionError} className={styles.errorAlert} />}
      {deleteError && <ErrorAlert message={deleteError} className={styles.errorAlert} />}

      {/* Only shown while viewing, so there are no unsaved edits; the AI reads the saved application. */}
      {isViewMode && savedApplication && !mock && (
        <div className={styles.formHeader}>
          <Button
            nativeButton={false}
            render={<Link to={`/interview?application=${encodeURIComponent(savedApplication.id)}`} />}
            variant="outline"
          >
            <Sparkles aria-hidden="true" />
            AI Interview Assistant
          </Button>
        </div>
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
          {isViewMode && savedApplication ? (
            <ApplicationStatusDropdown
              application={savedApplication}
              mock={mock}
              disabled={deleting}
              onSaved={(updated) => {
                setSavedApplication(updated);
                updateField("status", updated.status);
                setInterviews(interviewDrafts(updated.interviews));
              }}
              onSavingChange={setStatusSaving}
            />
          ) : (
            <>
              <Label htmlFor="status" className={styles.fieldLabel}>Status</Label>
              <Select
                value={form.status}
                disabled={disabled}
                onValueChange={(value) => {
                  const status = statuses.find((item) => item === value);
                  if (status) updateField("status", status);
                }}
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
            </>
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
        {isViewMode ? (
          <p className={styles.fieldLabel}>Job URL</p>
        ) : (
          <Label htmlFor="jobUrl" className={styles.fieldLabel}>
            Job URL
          </Label>
        )}
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
            {isViewMode ? (
              <p className={styles.fieldLabel}>Resume</p>
            ) : (
              <Label htmlFor="resumeId">Resume</Label>
            )}
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
          {resumesError && <ErrorAlert message={resumesError} />}
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
              disabled={disabled || loadingResumes || (resumes.length === 0 && !form.resumeId)}
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
        {isViewMode ? (
          <p className={styles.fieldLabel}>Company website</p>
        ) : (
          <Label htmlFor="companyWebsiteUrl" className={styles.fieldLabel}>
            Company website
          </Label>
        )}
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

      <section aria-labelledby="interviews-heading" className={styles.interviews}>
        <h2 id="interviews-heading" className={styles.interviewsHeading}>Interviews</h2>
        {isViewMode ? (
          savedApplication?.interviews.length ? (
            <ul className={styles.interviews}>
              {savedApplication.interviews.map((interview) => (
                <li key={interview.id}>
                  {interview.type}{" - "}
                  <time dateTime={interview.scheduledAt}>{new Date(interview.scheduledAt).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          ) : <p className={styles.fieldValue}>No interviews scheduled.</p>
        ) : (
          <>
            {interviews.map((interview, index) => (
              <fieldset key={index} className={styles.interviewRow} disabled={submitting}>
                <legend>Interview {index + 1}</legend>
                <div className={styles.fieldGrid}>
                  <div>
                    <Label htmlFor={`interview-type-${index}`} className={styles.fieldLabel}>Type</Label>
                    <Input
                      id={`interview-type-${index}`}
                      value={interview.type}
                      onChange={(event) => setInterviews((current) => current.map((item, i) =>
                        i === index ? { ...item, type: event.target.value } : item))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`interview-time-${index}`} className={styles.fieldLabel}>Date and time</Label>
                    <Input
                      id={`interview-time-${index}`}
                      type="datetime-local"
                      step="0.001"
                      value={interview.localTime}
                      onChange={(event) => setInterviews((current) => current.map((item, i) =>
                        i === index ? { ...item, localTime: event.target.value, originalTime: undefined } : item))}
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={() => setInterviews((current) => current.filter((_, i) => i !== index))}>
                  Remove interview {index + 1}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={submitting || interviews.length >= 50}
              onClick={() => setInterviews((current) => [...current, { type: "", localTime: "" }])}
            >
              Add interview
            </Button>
            {interviews.length >= 50 && <p className={styles.fieldValue}>Maximum of 50 interviews.</p>}
          </>
        )}
      </section>

      <div className={styles.formActions}>
        {isViewMode ? (
          <Button
            type="button"
            variant="destructive"
            className={styles.actionButton}
            disabled={deleting || statusSaving}
            onClick={() => void deleteApplication()}
          >
            {deleting ? "Deleting..." : "Delete application"}
          </Button>
        ) : savedApplication && editing ? (
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            className={styles.actionButton}
            onClick={() => {
              setForm(formFromApplication(savedApplication));
              setInterviews(interviewDrafts(savedApplication.interviews));
              setEditing(false);
              setSubmissionError(null);
              setShowResumeUpload(false);
            }}
          >
            Cancel
          </Button>
        ) : (
          <Button
            nativeButton={false}
            render={<Link to="/applications" />}
            variant="outline"
            className={styles.actionButton}
          >
            Back to all applications
          </Button>
        )}
        {isViewMode ? (
          <Button
            type="button"
            className={styles.actionButton}
            disabled={statusSaving || deleting}
            onClick={(event) => {
              event.preventDefault();
              setEditing(true);
            }}
          >
            Edit application
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={disabled}
            className={styles.submitButton}
          >
            {submitting
              ? savedApplication ? "Saving..." : "Creating..."
              : savedApplication ? "Save changes" : "Create application"}
          </Button>
        )}
        {isViewMode && (
          <Button
            nativeButton={false}
            render={<Link to="/applications" />}
            variant="outline"
            className={styles.backButtonView}
          >
            Back to all applications
          </Button>
        )}
      </div>
    </form>
  );
}
