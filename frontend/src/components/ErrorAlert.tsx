import { Alert, AlertDescription } from "@/components/ui/alert"
import styles from "@/styles/ErrorAlert.module.css"

type ErrorAlertProps = {
  message: string
  className?: string
}

export default function ErrorAlert({ message, className }: ErrorAlertProps) {
  return (
    <Alert variant="destructive" className={`${styles.errorAlert} ${className ?? ""}`}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
