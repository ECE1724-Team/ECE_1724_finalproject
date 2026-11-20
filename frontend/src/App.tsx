import { Outlet, useLocation } from "react-router";
import NavBar from "@/components/NavBar";

export default function AppLayout() {
  const { pathname } = useLocation();

  return (
    <>
      <NavBar currentLocation={pathname} />
      <Outlet />
    </>
  );
}