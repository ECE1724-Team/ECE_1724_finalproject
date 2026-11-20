import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import ResumeUploadForm from "@/components/ResumeUploadForm"
import { fakeResumes } from "@/lib/testpayloads"
import type { Resume, ResumeList } from "@/types"
import styles from "@/styles/Resumes.module.css"

type ResumesProps = {
  mock?: boolean
}

export default function Resumes({ mock = false }: ResumesProps) {
  const [resumes, setResumes] = useState<Resume[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
          throw new Error(
            response.status === 401
              ? "Sign in to view your resumes."
              : `Unable to load resumes (HTTP ${response.status}).`,
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Label className={styles.title}>Resumes</Label>
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
            setError(null)
          }}
        />
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  )
}
