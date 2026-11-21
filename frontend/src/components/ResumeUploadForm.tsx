import { useState } from "react"
import ErrorAlert from "@/components/ErrorAlert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Resume } from "@/types"
import { responseError } from "@/lib/response-error"
import styles from "@/styles/ResumeUploadForm.module.css"

const MAX_RESUME_BYTES = 2_097_152

type ResumeUploadFormProps = {
  onCancel: () => void
  onUploaded: (resume: Resume) => void
}

export default function ResumeUploadForm({
  onCancel,
  onUploaded,
}: ResumeUploadFormProps) {
  const [resumeName, setResumeName] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function handleUpload() {
    setUploadError(null)

    const name = resumeName.trim()
    if (!name || !selectedFile) {
      setUploadError("Enter a resume name and choose a PDF file.")
      return
    }
    if ([...name].length > 200) {
      setUploadError("Resume names must be 200 characters or fewer.")
      return
    }
    if (selectedFile.size > MAX_RESUME_BYTES) {
      setUploadError("The PDF must be no larger than 2 MiB.")
      return
    }

    setUploading(true)
    try {
      const body = new FormData()
      body.append("name", name)
      body.append("file", selectedFile)

      const response = await fetch("/api/v1/resumes", {
        method: "POST",
        credentials: "include",
        body,
      })

      if (!response.ok) {
        throw await responseError(response, "Unable to upload resume.")
      }

      const resume = await response.json() as Resume
      window.alert("Resume created successfully.")
      onUploaded(resume)
    } catch (uploadFailure) {
      setUploadError(
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "Unable to upload resume. Please try again.",
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a resume</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription className={styles.description}>
          Choose a PDF no larger than 2 MiB and no more than 2 pages. Scanned PDFs may not have text available to AI features.
        </CardDescription>
        <div className={styles.fields}>
          <div className={styles.fieldGroup}>
            <Label htmlFor="resume-name">Resume name</Label>
            <Input
              id="resume-name"
              name="name"
              maxLength={200}
              required
              value={resumeName}
              disabled={uploading}
              onChange={(event) => setResumeName(event.target.value)}
            />
          </div>
          <div className={styles.fieldGroup}>
            <Label htmlFor="resume-file">PDF file</Label>
            <Input
              id="resume-file"
              name="file"
              type="file"
              accept=".pdf,application/pdf"
              required
              disabled={uploading}
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className={styles.actionsColumn}>
            <div className={styles.actions}>
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={uploading}
                onClick={() => void handleUpload()}
              >
                {uploading ? "Uploading..." : "Upload resume"}
              </Button>
            </div>
          </div>
        </div>
        {uploadError && (
          <ErrorAlert className={styles.feedback} message={uploadError} />
        )}
      </CardContent>
    </Card>
  )
}
