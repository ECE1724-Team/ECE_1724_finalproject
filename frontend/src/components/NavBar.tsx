import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { Link } from "react-router"

type NavBarProps = {
  currentLocation: string
}

export default function NavBar({ currentLocation }: NavBarProps) {
  const menuItemClass = (path: string) =>
    `rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100 hover:text-slate-950 focus:bg-slate-100 focus:text-slate-950 data-[state=open]:bg-slate-100 ${
      currentLocation === path
        ? "bg-slate-100 text-slate-950"
        : "text-slate-700"
    }`

  return (
    <div className="flex w-full items-center justify-between gap-4">
      <Link
        to="/"
        className="text-lg font-semibold tracking-tight text-slate-900 transition-colors hover:text-slate-700"
      >
        JobFlo.AI
      </Link>

      <Menubar className="border-none bg-transparent p-0">
        <MenubarMenu>
          <MenubarTrigger className={menuItemClass("/")}>
            <Link to="/">Dashboard</Link>
          </MenubarTrigger>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className={menuItemClass("/applications")}>
            <Link to="/applications">Applications</Link>
          </MenubarTrigger>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className={menuItemClass("/interview")}>
            <Link to="/interview">AI Prep</Link>
          </MenubarTrigger>
        </MenubarMenu>
      </Menubar>
    </div>
  )
}
