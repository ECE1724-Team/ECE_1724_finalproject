import { useLayoutEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Link, useNavigate } from "react-router"
import { Moon, Sun } from "lucide-react"
import { signOut } from "@/lib/auth"
import styles from "@/styles/NavBar.module.css"
import { useAuth } from "@/components/AuthProvider"

type NavBarProps = {
  currentLocation: string
}

const THEME_KEY = "jobflo-theme"

function initialDarkMode() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark"
  } catch (error) {
    console.warn("Unable to read the saved theme preference.", error)
    return false
  }
}

export default function NavBar({ currentLocation }: NavBarProps) {
  const navigate = useNavigate()
  const { status, setUnauthenticated } = useAuth()

  const [signingOut, setSigningOut] = useState(false)
  const [darkMode, setDarkMode] = useState(initialDarkMode)
  const authStatus = status === "authenticated"

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
  }, [darkMode])

  function toggleTheme() {
    const next = !darkMode
    setDarkMode(next)
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light")
    } catch (error) {
      console.warn("Unable to save the theme preference.", error)
    }
  }

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
      navigate("/login")
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to sign out. Please try again.");
    } finally {
      setSigningOut(false)
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
                AI Copilot
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={styles.themeToggle}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
          >
            {darkMode ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
        </nav>
      </div>
    </div>
  )
}
