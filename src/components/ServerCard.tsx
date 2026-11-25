import ServerFlag from "@/components/ServerFlag"
import ServerLatencySummary from "@/components/ServerLatencySummary"
import TrafficBar from "@/components/TrafficBar"
import { formatBytes, formatSpeed, splitFormattedMeasure } from "@/lib/format"
import type { HomeLatencyTaskSummary } from "@/lib/home-latency"
import type { PublicReturnRoute } from "@/lib/home-return-route"
import { saveHomeScroll } from "@/lib/home-scroll"
import { prefetchServerMonitor } from "@/lib/prefetch-monitor"
import { loadUsagePercent, resourceUsageTone } from "@/lib/meter-tone"
import { RESOURCE_SWATCH } from "@/lib/theme-tokens"
import { parseCardTags } from "@/lib/server-tags"
import { GetOsName } from "@/lib/logo-class"
import { readHideEmptyProbeWindow, readShowServerBandwidth, serverBandwidthLabel, shouldShowHomeProbeWindow } from "@/lib/theme-config"
import { calcTrafficUsed, cn, formatLiteInfo, parsePublicNote } from "@/lib/utils"
import { LiteServer } from "@/types/lite-api"
import { useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Copy, X } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"

import PlanInfo from "./PlanInfo"
import BillingInfo from "./billingInfo"

function resourceFill(percent: number, swatch: string) {
  const tone = resourceUsageTone(percent)
  if (tone === "amber") return "var(--card-amber)"
  if (tone === "coral") return "var(--card-danger)"
  if (tone === "empty") return "transparent"
  return swatch
}

function ResourceMetric({ label, value, unit, percent, swatch }: { label: string; value: string; unit?: string; percent: number; swatch: string }) {
  const width = Math.min(100, Math.max(0, percent))
  return (
    <div>
      <div className="lite-server-card__metric-label">
        <span className="sr-only">{label}</span>
        <span className="lite-list-value shrink-0 tabular-nums">
          {value}
          {unit ? <small>{unit}</small> : null}
        </span>
      </div>
      <div className="lite-server-card__meter" aria-hidden="true">
        <span style={{ width: `${width}%`, background: resourceFill(percent, swatch) }} />
      </div>
    </div>
  )
}

function SpeedValue({ text }: { text: string }) {
  const speed = splitFormattedMeasure(text)
  return (
    <strong className="lite-server-card__speed tabular-nums">
      {speed.value}
      <small>{speed.unit}</small>
    </strong>
  )
}

function formatOsLabel(platform: string, systemName: string): string {
  const normalized = (platform || "").trim().replace(/\s+/g, " ")
  if (!normalized) return systemName
  if (/^windows\b/i.test(normalized)) {
    return normalized
  }
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  return match ? `${systemName} ${match[1]}` : systemName
}

function Address({ address }: { address: string }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const label = t(`serverCard.${feedback === "idle" ? "copy" : feedback}`)
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setFeedback("copied")
    } catch {
      setFeedback("failed")
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFeedback("idle"), 1500)
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={`${label} ${address}`}
      aria-label={`${label} ${address}`}
      className="lite-list-address"
      data-feedback={feedback}
    >
      <span className="truncate tabular-nums">{address}</span>
      <span className="lite-list-address__icon" aria-hidden="true">
        {feedback === "copied" ? <Check size={13} color="var(--card-green)" /> :
          feedback === "failed" ? <X size={13} /> : <Copy size={12} />}
      </span>
    </button>
  )
}

const osIcons: Record<string, string> = {
  Debian: "debian", Ubuntu: "ubuntu", Alpine: "alpinelinux", Archlinux: "archlinux",
  Fedora: "fedora", Centos: "centos", "Rocky Linux": "rockylinux", Redhat: "redhat",
  Freebsd: "freebsd", FreeBSD: "freebsd", Gentoo: "gentoo", Opensuse: "opensuse",
  Linuxmint: "linuxmint", "Linux Mint": "linuxmint", Nixos: "nixos", NixOS: "nixos",
  macOS: "macos", Windows: "windows", Manjaro: "manjaro", Almalinux: "almalinux",
}

function ServerCard({
  now,
  serverInfo,
  formattedInfo,
  expanded,
  onToggle,
  hasAssignedProbe,
  latencySummaries,
  returnRoute,
}: {
  now: number
  serverInfo: LiteServer
  expanded: boolean
  onToggle: (id: number) => void
  hasAssignedProbe: boolean
  formattedInfo?: ReturnType<typeof formatLiteInfo>
  latencySummaries?: HomeLatencyTaskSummary[]
  returnRoute?: PublicReturnRoute
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const prefetchMonitor = useCallback(
    (priority: boolean) => prefetchServerMonitor(queryClient, serverInfo.id, { priority }),
    [queryClient, serverInfo.id],
  )
  const info = formattedInfo ?? formatLiteInfo(now, serverInfo)
  const parsedData = parsePublicNote(info.public_note)
  const systemName = info.platform.includes("Windows") ? "Windows" : GetOsName(info.platform)
  const osLabel = formatOsLabel(info.platform, systemName)
  const trafficUsed = calcTrafficUsed(info.net_out_transfer, info.net_in_transfer, info.traffic_limit_type)
  const bandwidth = serverBandwidthLabel(serverInfo.bandwidth)
  const showBandwidth = readShowServerBandwidth() && Boolean(bandwidth)
  const showTags = parseCardTags({ tags: serverInfo.tags, extra: parsedData?.planDataMod?.extra }).length > 0
  const showTraffic = info.traffic_limit > 0
  const showFooter = Boolean(parsedData?.billingDataMod || showTags || showBandwidth)
  const showProbeWindow = shouldShowHomeProbeWindow(latencySummaries?.length || Number(hasAssignedProbe), readHideEmptyProbeWindow())
  const hasDetails = showProbeWindow || showTraffic || showFooter

  return (
    <article
      className="lite-server-card min-w-0"
      data-online={info.online}
    >
      <div className="lite-server-card__frame">
        <header className="lite-server-card__hero lite-list-grid">
          <div className="flex min-w-0 items-center gap-2.5">
            <span role="img" aria-label={info.online ? t("online") : t("offline")} title={info.online ? t("online") : t("offline")}
              className={cn("size-2 shrink-0 rounded-full", info.online ? "bg-[var(--card-green)]" : "bg-[var(--card-danger)]")} />
            <ServerFlag country_code={info.country_code} className="h-3.5 w-5 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-col">
              <Link className="lite-server-card__name truncate hover:underline" title={info.name} to={`/server/${serverInfo.id}`} onClick={saveHomeScroll}>{info.name}</Link>
              <span className="lite-list-os-sub truncate" title={`${osLabel} · ${info.arch || "--"}`}>
                <img src={`/os/${osIcons[systemName] || "linux"}.svg`} alt="" width={12} height={12} aria-hidden="true" />
                <span className="truncate">{osLabel}</span>
              </span>
            </div>
          </div>
          <div className="lite-list-ip-cell min-w-0">
            {[info.ipv4, info.ipv6].filter(Boolean).map(address => <Address key={address} address={address!} />)}
            {!info.ipv4 && !info.ipv6 && "—"}
          </div>
          <div className="lite-list-pair">
            <span title={t("serverCard.download")}><i aria-hidden="true">↓</i><span className="sr-only">{t("serverCard.download")}</span><SpeedValue text={formatSpeed(info.down)} /></span>
            <span title={t("serverCard.upload")}><i aria-hidden="true">↑</i><span className="sr-only">{t("serverCard.upload")}</span><SpeedValue text={formatSpeed(info.up)} /></span>
          </div>
          <div className="lite-list-pair lite-list-value">
            <span title={t("serverCard.download")}><i>↓</i>{formatBytes(info.net_in_transfer)}</span>
            <span title={t("serverCard.upload")}><i>↑</i>{formatBytes(info.net_out_transfer)}</span>
          </div>
            <ResourceMetric label="CPU" value={info.cpu.toFixed(1)} unit="%" percent={info.cpu} swatch={RESOURCE_SWATCH.cpu} />
            <ResourceMetric label={t("serverCard.mem")} value={info.mem.toFixed(1)} unit="%" percent={info.mem} swatch={RESOURCE_SWATCH.memory} />
            <ResourceMetric label={t("serverCard.stg")} value={info.stg.toFixed(1)} unit="%" percent={info.stg} swatch={RESOURCE_SWATCH.storage} />
            <ResourceMetric label={t("serverCard.load")} value={String(info.load_1)} percent={loadUsagePercent(info.load_1, info.cpu_cores)} swatch={RESOURCE_SWATCH.load} />
          <span className="whitespace-nowrap tabular-nums">
            {info.uptime > 0 ? `${Math.floor(info.uptime / 86400)} ${t("serverCard.days")} ${Math.floor(info.uptime % 86400 / 3600)} ${t("serverCard.hours")}` : "—"}
          </span>
          {hasDetails && (
            <button type="button" className="lite-list-toggle" aria-expanded={expanded}
              aria-label={t("serverCard.rowDetails", { name: info.name })}
              onClick={() => onToggle(serverInfo.id)}>
              <ChevronDown size={18} aria-hidden="true" />
            </button>
          )}
        </header>
        {expanded && <>

        <div className="lite-server-card__body">

          {showProbeWindow ? (
            <ServerLatencySummary
              summaries={latencySummaries}
              returnRoute={returnRoute}
              onPrefetch={prefetchMonitor}
              onSelectTask={(taskId) => {
                saveHomeScroll()
                prefetchMonitor(true)
                navigate(`/server/${serverInfo.uuid || serverInfo.id}?view=network&ping_task=${encodeURIComponent(taskId)}`)
              }}
            />
          ) : null}
        </div>

        {showTraffic || showFooter ? (
          <div className="lite-server-card__bottom">
            {showTraffic ? (
              <TrafficBar
                used={trafficUsed}
                limit={info.traffic_limit}
                resetDay={info.traffic_reset_day}
                resetTime={info.traffic_reset_time}
                resetTimezone={info.traffic_reset_timezone}
                resetAt={info.traffic_reset_at}
                now={now}
                limitType={info.traffic_limit_type}
              />
            ) : null}
            {showFooter ? (
              <footer className="lite-server-card__footer">
                {parsedData?.billingDataMod ? (
                  <BillingInfo
                    variant="card"
                    parsedData={parsedData}
                    remainingValue={serverInfo.remaining_value}
                    remainingValueCurrency={serverInfo.remaining_value_currency}
                  />
                ) : null}
                {(showTags || showBandwidth) ? (
                  <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-x-[11px] gap-y-1.5">
                    {showTags ? <PlanInfo parsedData={parsedData} tags={serverInfo.tags} /> : null}
                    {showBandwidth ? (
                      <span className="lite-server-card__bandwidth">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                          <path d="M2 12h12M4 8.5h8M6.5 5h3" />
                        </svg>
                        {bandwidth}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </footer>
            ) : null}
          </div>
        ) : null}
        </>}
      </div>
    </article>
  )
}

export default memo(ServerCard)
