import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Link, useNavigate } from "react-router"
import { signOut } from "@/lib/auth"
import styles from "@/styles/NavBar.module.css"
import { useAuth } from "@/components/AuthProvider"

type NavBarProps = {
  currentLocation: string
}

export default function NavBar({ currentLocation }: NavBarProps) {
  const navigate = useNavigate()
  const { status, setUnauthenticated } = useAuth()

  const [signingOut, setSigningOut] = useState(false)
  const authStatus = status === "authenticated"

  const menuItemClass = (paths: string[]) => {
    const isActive = paths.some((path) =>
      path === "/" ? currentLocation === path : currentLocation.startsWith(path),
    );

    return `${styles.menuItem} ${isActive ? styles.activeMenuItem : styles.inactiveMenuItem}`;
  };

  async function handleSignOut() {
    if(!window.confirm("Are you sure you want to sign out?")){
      return
    }
    setSigningOut(true)

    try {
      await signOut()
      setUnauthenticated()
    } catch (error) {
      window.alert("Unable to sign out. Please try again.");
    } finally {
      setSigningOut(false)
      navigate("/login")
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.row}>
        <Link
          to="/"
          className={styles.brand}
        >
          JobFlo.AI
        </Link>

        <nav className={styles.actions} aria-label="Main navigation">
          {!authStatus ? (
            <Button
              nativeButton={false}
              render={<Link to="/login" />}
              variant="ghost"
              className={menuItemClass(["/login"])}
            >
              Login
            </Button>
          ) : (
            <>
              <Button
                nativeButton={false}
                render={<Link to="/dashboard" />}
                variant="ghost"
                className={menuItemClass(["/dashboard"])}
              >
                Dashboard
              </Button>
              <Button
                nativeButton={false}
                render={<Link to="/applications" />}
                variant="ghost"
                className={menuItemClass(["/applications", "/application"])}
              >
                Applications
              </Button>
              <Button
                nativeButton={false}
                render={<Link to="/resumes" />}
                variant="ghost"
                className={menuItemClass(["/resumes"])}
              >
                Resumes
              </Button>
              <Button
                nativeButton={false}
                render={<Link to="/interview" />}
                variant="ghost"
                className={menuItemClass(["/interview"])}
              >
                AI Prep
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={menuItemClass(["/login"])}
                disabled={signingOut}
                onClick={() => void handleSignOut()}
              >
                {signingOut ? "Signing out..." : "Logout"}
              </Button>
            </>
          )}
        </nav>
      </div>
    </div>
  )
}
