import type { ReactNode } from "react"
import { useLocation } from "react-router-dom"

export default function RouteView({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()

  return (
    <div key={pathname} className="lite-route-view flex flex-1 flex-col">
      {children}
    </div>
  )
}
