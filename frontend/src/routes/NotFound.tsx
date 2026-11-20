import { Button } from "@/components/ui/button"
import { Link } from "react-router"
import styles from "@/styles/NotFound.module.css"

export default function NotFound() {
  return (
    <main className={styles.notFoundPage}>
      <h1 className={styles.notFoundHeading}>Page not found</h1>
      <p className={styles.notFoundMessage}>
        The page you are looking for does not exist.
      </p>
      <Button nativeButton={false} render={<Link to="/" />}>
        Go home
      </Button>
    </main>
  )
}