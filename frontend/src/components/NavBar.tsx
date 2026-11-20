import { useEffect, useState } from "react"
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { Link, useNavigate } from "react-router"
import { getSession, signOut } from "@/lib/auth"
import styles from "@/styles/NavBar.module.css"

type NavBarProps = {
  currentLocation: string
}

export default function NavBar({ currentLocation }: NavBarProps) {
  const navigate = useNavigate()

  const [authStatus, setAuthStatus] = useState<boolean>(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true
    setAuthStatus(false)

    getSession()
      .then((session) => {
        if (active) setAuthStatus(!!session)
      })
      .catch(() => {
        if (active) {
          setAuthStatus(false)
          window.alert("Unable to sign out. Please try again.")
        }
      })

    return () => {
      active = false
    }
  }, [currentLocation])

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
      setAuthStatus(false)
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

        <div className={styles.actions}>
          <Menubar className={styles.menubar}>
            <MenubarMenu>
              <MenubarTrigger className={menuItemClass(["/"])}>
                <Link to="/">Dashboard</Link>
              </MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={menuItemClass(["/applications", "/application"])}>
                <Link to="/applications">Applications</Link>
              </MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={menuItemClass(["/resumes"])}>
                <Link to="/resumes">Resumes</Link>
              </MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={menuItemClass(["/interview"])}>
                <Link to="/interview">AI Prep</Link>
              </MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger
                className={menuItemClass(["/login"])}
                disabled={signingOut}
                onClick={(event) => {
                  if (authStatus) {
                    event.preventDefault()
                    void handleSignOut()
                  }
                }}
              >
                {authStatus
                  ? signingOut ? "Signing out..." : "Logout"
                  : <Link to="/login">Login</Link>}
              </MenubarTrigger>
            </MenubarMenu>
          </Menubar>
        </div>
      </div>
    </div>
  )
}
