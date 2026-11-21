import { useEffect, useState } from "react"
import ErrorAlert from "@/components/ErrorAlert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import ResumeUploadForm from "@/components/ResumeUploadForm"
import { fakeResumes } from "@/lib/testpayloads"
import { responseError } from "@/lib/response-error"
import type { Resume, ResumeList } from "@/types"
import styles from "@/styles/Resumes.module.css"

type ResumesProps = {
  mock?: boolean
}

export default function Resumes({ mock = false }: ResumesProps) {
  const [resumes, setResumes] = useState<Resume[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showUploadCard, setShowUploadCard] = useState(false)

  useEffect(() => {
    let active = true

    async function loadResumes() {
      setLoading(true)
      setError(null)

      if (mock) {
        setResumes(fakeResumes)
        setLoading(false)
        return
      }

      try {
        const response = await fetch("/api/v1/resumes", {
          credentials: "include",
        })

        if (!response.ok) {
          throw await responseError(
            response,
            response.status === 401
              ? "Sign in to view your resumes."
              : "Unable to load resumes.",
          )
        }

        const result = await response.json() as ResumeList
        if (active) setResumes(result.data)
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load resumes.")
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadResumes()
    return () => {
      active = false
    }
  }, [mock])

  async function downloadResume(resume: Resume) {
    setDownloadError(null)
    if (mock && fakeResumes.some((sample) => sample.id === resume.id)) {
      setDownloadError("Sample resumes cannot be downloaded.")
      return
    }

    try {
      const response = await fetch(`/api/v1/resumes/${encodeURIComponent(resume.id)}/file`, {
        credentials: "include",
      })
      if (!response.ok) {
        throw await responseError(
          response,
          response.status === 401
            ? "Sign in to download your resume."
            : "Unable to download resume.",
        )
      }

      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = resume.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (downloadFailure) {
      setDownloadError(downloadFailure instanceof Error ? downloadFailure.message : "Unable to download resume.")
    }
  }

  async function deleteResume(resume: Resume) {
    if (deletingId) return
    setDeleteError(null)
    if (mock && fakeResumes.some((sample) => sample.id === resume.id)) {
      setDeleteError("Sample resumes cannot be deleted.")
      return
    }

    const linkedMessage = resume.linkedApplicationCount > 0
      ? ` It will be unlinked from ${resume.linkedApplicationCount} ${resume.linkedApplicationCount === 1 ? "application" : "applications"}.`
      : ""
    if (!window.confirm(`Delete resume ${resume.name}?${linkedMessage} This cannot be undone.`)) return

    setDeletingId(resume.id)
    try {
      const response = await fetch(`/api/v1/resumes/${encodeURIComponent(resume.id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!response.ok) throw await responseError(response, "Unable to delete resume.")

      setResumes((current) => current.filter((item) => item.id !== resume.id))
      window.alert("Resume Deleted Succesfully")
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "Unable to delete resume.")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Resumes</h1>
        {!showUploadCard && (
          <Button type="button" onClick={() => setShowUploadCard(true)}>
            Upload a Resume
          </Button>
        )}
      </header>

      {showUploadCard && (
        <ResumeUploadForm
          onCancel={() => setShowUploadCard(false)}
          onUploaded={(resume) => {
            setResumes((current) => [resume, ...current])
            setShowUploadCard(false)
          }}
        />
      )}

      {error && <ErrorAlert message={error} />}

      {downloadError && <ErrorAlert message={downloadError} />}

      {deleteError && <ErrorAlert message={deleteError} />}

      {loading ? (
        <p role="status">Loading resumes...</p>
      ) : resumes.length === 0 && !error ? (
        <p>No resumes uploaded yet.</p>
      ) : (
        <section
          aria-label="Your resumes"
          className={styles.resumeGrid}
        >
          {resumes.map((resume) => (
            <Card key={resume.id}>
              <CardHeader>
                <CardTitle>{resume.name}</CardTitle>
                <CardDescription>{resume.fileName}</CardDescription>
              </CardHeader>
              <CardContent className={styles.cardContent}>
                <p>
                  Used for {resume.linkedApplicationCount}{" "}
                  {resume.linkedApplicationCount === 1 ? "job" : "jobs"}
                </p>
                <p className={styles.mutedText}>
                  Text extraction: {resume.textStatus}
                </p>
                <div className={styles.actions}>
                  <Button type="button" onClick={() => void downloadResume(resume)} aria-label={`Download ${resume.name}`}>
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deletingId !== null}
                    onClick={() => void deleteResume(resume)}
                    aria-label={`Delete ${resume.name}`}
                  >
                    {deletingId === resume.id ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  )
}
