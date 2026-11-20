import { useEffect, useState } from "react"
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { Link } from "react-router"
import { getSession, signOut } from "@/lib/auth"

type NavBarProps = {
  currentLocation: string
}

export default function NavBar({ currentLocation }: NavBarProps) {

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

    return `rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100 hover:text-slate-950 focus:bg-slate-100 focus:text-slate-950 data-[state=open]:bg-slate-100 ${isActive ? "bg-slate-100 text-slate-950" : "text-slate-700"
      }`;
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
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full items-center justify-between gap-4">
        <Link
          to="/"
          className="text-lg font-semibold tracking-tight text-slate-900 transition-colors hover:text-slate-700"
        >
          JobFlo.AI
        </Link>

        <div className="flex items-center gap-2">
          <Menubar className="border-none bg-transparent p-0">
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
