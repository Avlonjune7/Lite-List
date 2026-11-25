import { cn } from "@/lib/utils"

const flags = import.meta.glob<string>("../../node_modules/country-flag-icons/3x2/*.svg", {
  eager: true,
  import: "default",
  query: "?url&no-inline",
})

export default function ServerFlag({
  country_code,
  className,
  size = "md",
}: {
  country_code: string
  className?: string
  size?: "md" | "lg"
}) {
  const code = country_code?.trim().toUpperCase()
  if (!code) return null
  const normalized = code === "UK" || code === "EN" ? "GB" : code
  const url = flags[`../../node_modules/country-flag-icons/3x2/${normalized}.svg`]
  const flagClassName = cn(
    "lite-flag pointer-events-none block shrink-0 overflow-hidden",
    size === "lg" ? "h-[18px] w-[27px]" : "h-[15px] w-[22px]",
    className,
  )
  if (!url) return <span aria-hidden className={flagClassName} />
  return <img src={url} alt="" className={flagClassName} />
}
