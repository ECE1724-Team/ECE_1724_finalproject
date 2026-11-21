import { useState } from "react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { applicationStatuses } from "@/lib/application-status";
import { responseError } from "@/lib/response-error";
import type { Application, ApplicationReplace, ApplicationStatus } from "@/types";
import styles from "@/styles/ApplicationStatusDropdown.module.css";

type ApplicationStatusDropdownProps = {
  application: Application;
  mock?: boolean;
  disabled?: boolean;
  onSaved: (application: Application) => void;
  onSavingChange: (saving: boolean) => void;
};

export default function ApplicationStatusDropdown({ application, mock = false, disabled = false, onSaved, onSavingChange }: ApplicationStatusDropdownProps) {
  const [saved, setSaved] = useState(application);
  const [status, setStatus] = useState<ApplicationStatus>(application.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveStatus() {
    if (disabled || saving || status === saved.status) return;
    setError(null);
    if (mock) {
      setError("Sample application statuses cannot be saved.");
      return;
    }

    const payload: ApplicationReplace = {
      companyName: saved.companyName,
      jobTitle: saved.jobTitle,
      status,
      appliedDate: saved.appliedDate,
      jobDescription: saved.jobDescription,
      jobUrl: saved.jobUrl,
      resumeId: saved.resumeId,
      companyWebsiteUrl: saved.companyWebsiteUrl,
      companyNotes: saved.companyNotes,
      notes: saved.notes,
      offerReceived: saved.offerReceived,
      interviews: saved.interviews,
      rowVersion: saved.rowVersion,
    };

    setSaving(true);
    onSavingChange(true);
    try {
      const response = await fetch(`/api/v1/applications/${encodeURIComponent(saved.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const failure = await responseError(response, "Unable to update status.");
        if (response.status === 409) {
          throw new Error(`${failure.message} Reload the page before trying again.`);
        }
        throw failure;
      }

      const updated = await response.json() as Application;
      setSaved(updated);
      setStatus(updated.status);
      onSaved(updated);
      window.alert("Application Status updated successfully.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to update status.");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <div className={styles.statusEditor}>
      <Label htmlFor="application-status">Status</Label>
      <Select
        value={status}
        disabled={disabled || saving}
        onValueChange={(value) => {
          const selected = applicationStatuses.find((item) => item.value === value);
          if (selected) {
            setStatus(selected.value);
            setError(null);
          }
        }}
      >
        <SelectTrigger id="application-status" className={styles.fullWidth}>
          <SelectValue>{applicationStatuses.find((item) => item.value === status)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {applicationStatuses.map((item) => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {status !== saved.status && (
        <Button type="button" disabled={disabled || saving} onClick={() => void saveStatus()}>
          {saving ? "Saving..." : "Update status"}
        </Button>
      )}
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
