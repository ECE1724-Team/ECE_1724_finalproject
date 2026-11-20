import { Button } from "@/components/ui/button"
import { Link } from "react-router"
import "@/styles/NotFound.css"

export default function NotFound() {
  return (
    <main className="not-found-page">
      <h1 className="not-found-heading">Page not found</h1>
      <p className="not-found-message">
        The page you are looking for does not exist.
      </p>
      <Button nativeButton={false} render={<Link to="/" />}>
        Go home
      </Button>
    </main>
  )
}