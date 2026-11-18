import {
  HOME_LATENCY_CARD_LIMIT,
  type HomeLatencyTaskSummary,
  buildProbeHealthBuckets,
  formatProbeLatency,
  formatProbePacketLoss,
  hourPacketFillPercent,
  latencyBarTone,
  probeLossTone,
  probeRailTone,
} from "@/lib/home-latency"
import {
  returnBlockBadgeForRoute,
  returnLineForPingTask,
  returnRoutePillTone,
  type PublicReturnRoute,
} from "@/lib/home-return-route"
import { readShowHomePacketLoss, readShowHomeReturnRoute } from "@/lib/theme-config"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

function TaskProbe({
  summary,
  returnLine,
  blockedLabel,
  showPacketLoss,
  onSelect,
  onPress,
}: {
  summary: HomeLatencyTaskSummary
  returnLine: string
  blockedLabel: string
  showPacketLoss: boolean
  onSelect?: (taskId: string) => void
  onPress?: () => void
}) {
  const { t } = useTranslation()
  const latency = formatProbeLatency(summary.latency)
  const delayTone = latencyBarTone(summary.latency)
  const lossTone = probeLossTone(summary.packetLoss)
  const railTone = probeRailTone(summary)
  const buckets = buildProbeHealthBuckets(summary)
  const packetLoss = formatProbePacketLoss(summary.packetLoss)
  const percent = hourPacketFillPercent(summary)
  const lossLabel = t("serverCard.packetLoss")
  const latencyLabel = latency.unit ? `${latency.value} ${latency.unit}` : latency.value
  const title = [
    summary.taskName,
    returnLine,
    blockedLabel,
    latencyLabel,
    showPacketLoss ? `${lossLabel} ${packetLoss}` : "",
    t("serverCard.sampleFill", { percent: percent.toFixed(0) }),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <button
      type="button"
      title={title}
      data-rail-tone={railTone}
      data-return={returnLine ? "true" : "false"}
      data-loss={showPacketLoss ? "true" : "false"}
      onPointerDown={() => onPress?.()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.stopPropagation()
        if (event.key === " ") {
          event.preventDefault()
          onSelect?.(summary.taskId)
        }
      }}
      onClick={(event) => {
        if (!onSelect) return
        event.stopPropagation()
        onSelect(summary.taskId)
      }}
      className="lite-probe-row lite-probe-chip"
    >
      <span className="lite-probe-row__rail" data-tone={railTone} aria-hidden="true" />
      <span className="lite-probe-row__main">
        <span className="lite-probe-row__head">
          <span className="lite-probe-row__name" title={summary.taskName}>
            {summary.taskName}
          </span>
          {returnLine ? (
            <span className="lite-probe-row__tag lite-probe-chip__tag" data-route-tone={returnRoutePillTone(returnLine)}>
              {returnLine}
            </span>
          ) : null}
        </span>
        <span className="lite-probe-row__bars" aria-hidden="true">
          {buckets.map((bucket, index) => (
            <i
              key={index}
              className="lite-probe-row__bar"
              data-tone={bucket.tone}
              style={{ height: `${bucket.height}px`, opacity: bucket.opacity }}
            />
          ))}
        </span>
      </span>
      <span className="lite-probe-row__side">
        <span className="lite-probe-row__metrics tabular-nums">
          <strong className="lite-probe-row__delay lite-probe-chip__delay-value" data-tone={delayTone}>
            <b>{latency.value}</b>
            {latency.unit ? <small>{latency.unit}</small> : null}
          </strong>
          {showPacketLoss ? (
            <span className="lite-probe-row__loss lite-probe-chip__loss" data-tone={lossTone}>
              {lossLabel} {packetLoss}
            </span>
          ) : null}
        </span>
        <span className="lite-probe-row__arrow" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  )
}

export default function ServerLatencySummary({
  summaries,
  returnRoute,
  onSelectTask,
  onPrefetch,
}: {
  summaries?: HomeLatencyTaskSummary[]
  returnRoute?: PublicReturnRoute
  onSelectTask?: (taskId: string) => void
  onPrefetch?: (priority: boolean) => void
}) {
  const { t } = useTranslation()
  const showReturnRoute = readShowHomeReturnRoute()
  const showPacketLoss = readShowHomePacketLoss()
  const displayed = (summaries || []).slice(0, HOME_LATENCY_CARD_LIMIT)
  const returnLines = displayed.map((item) => (showReturnRoute ? returnLineForPingTask(returnRoute, item.taskId) : ""))
  const blockBadge = showReturnRoute ? returnBlockBadgeForRoute(returnRoute) : null
  const blockedLabel =
    blockBadge === "high"
      ? t("serverCard.suspectedBlockedHigh")
      : blockBadge === "suspected"
        ? t("serverCard.suspectedBlocked")
        : ""
  const blockedShortLabel =
    blockBadge === "high"
      ? t("serverCard.suspectedBlockedHighShort")
      : blockedLabel
  const hasAnyReturn = Boolean(blockedLabel) || returnLines.some(Boolean)
  const sectionRef = useRef<HTMLElement>(null)
  const prefetchRef = useRef(onPrefetch)
  prefetchRef.current = onPrefetch

  useEffect(() => {
    const node = sectionRef.current
    if (!node) return

    let dwell: number | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          dwell = window.setTimeout(() => prefetchRef.current?.(false), 300)
          return
        }
        if (dwell !== undefined) {
          window.clearTimeout(dwell)
          dwell = undefined
        }
      },
      { threshold: [0.5] },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (dwell !== undefined) window.clearTimeout(dwell)
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      onPointerEnter={() => onPrefetch?.(true)}
      className="lite-server-card__quality"
      data-testid="server-latency-summary"
      data-blocked={blockBadge || "false"}
    >
      <div className="lite-server-card__quality-title">
        <div className="lite-server-card__quality-heading">
          <h3>{t("serverCard.networkQuality")}</h3>
          {blockBadge ? (
            <span className="lite-probe-block-tag" data-confidence={blockBadge} title={blockedLabel}>
              <i aria-hidden="true" />
              <span>{blockedShortLabel}</span>
            </span>
          ) : null}
        </div>
        <span className="lite-server-card__quality-window">{t("serverCard.recentHour")}</span>
      </div>
      <div
        className="lite-probe-well lite-server-card__probes"
        data-count={displayed.length}
        data-loss={showPacketLoss ? "true" : "false"}
        data-return={hasAnyReturn ? "true" : "false"}
        data-blocked={blockBadge || "false"}
      >
        {displayed.length > 0 ? (
          displayed.map((item, index) => (
            <TaskProbe
              key={item.taskId}
              summary={item}
              returnLine={returnLines[index] || ""}
              blockedLabel={blockedLabel}
              showPacketLoss={showPacketLoss}
              onSelect={onSelectTask}
              onPress={() => onPrefetch?.(true)}
            />
          ))
        ) : (
          <div className="lite-probe-empty">{t("monitor.noData")}</div>
        )}
      </div>
    </section>
  )
}
