export interface HomeLatencySample {
  entityId: string
  taskId: string
  taskName: string
  timestamp: number
  latency: number | null
  lossRatio: number
  count: number
}

export interface HomeLatencySummary {
  latency: number | null
  packetLoss: number | null
  latencyHistory: Array<number | null>
  packetLossHistory: Array<number | null>
  updatedAt: number | null
  total?: number | null
  valid?: number | null
  interval?: number | null
}

export interface HomeLatencyTaskSummary extends HomeLatencySummary {
  taskId: string
  taskName: string
}

export type HomeLatencyByServer = Record<string, HomeLatencyTaskSummary[]>

interface SummaryBucket {
  latencySum: number
  latencyCount: number
  lostCount: number
  totalCount: number
}

interface TaskBuckets {
  entityId: string
  taskId: string
  taskName: string
  buckets: Map<number, SummaryBucket>
}

const MINUTE_MS = 60_000
const HOME_BUCKET_MS = 5 * MINUTE_MS
const HOME_LATENCY_CACHE_KEY = "lite-home-latency-v2"
const HOME_LATENCY_CACHE_MAX_AGE_MS = 5 * MINUTE_MS
export const HOME_LATENCY_WINDOW_HOURS = 1
export const HOME_LATENCY_BUCKET_COUNT = 12
export const HOME_LATENCY_CARD_LIMIT = 4
export const HOME_LATENCY_GREEN_MAX_MS = 80
export const HOME_LATENCY_AMBER_MAX_MS = 180

export const HOME_TWO_COL_MIN = 968
export const HOME_FOUR_COL_MIN = 1440
export const HOME_FIVE_COL_MIN = 1920
export const HOME_TWO_COL_WIDTH = 1120
export const HOME_FOUR_COL_WIDTH = 1680
export const HOME_FIVE_COL_WIDTH = 1920
export const HOME_CARD_WIDTH = 394

export function homePageGutter(width: number): number {
  if (width <= 967) return 32
  if (width <= 1919) return 56
  return 80
}

export function homeCardColumnCount(width: number): number {
  if (width >= HOME_FIVE_COL_MIN) return 5
  if (width >= HOME_FOUR_COL_MIN) return 4
  if (width >= HOME_TWO_COL_MIN) return 2
  return 1
}

export function homePageMaxWidth(columns: number): number | null {
  if (columns <= 1) return null
  if (columns === 2) return HOME_TWO_COL_WIDTH
  if (columns === 4) return HOME_FOUR_COL_WIDTH
  if (columns >= 5) return HOME_FIVE_COL_WIDTH
  return null
}

export function homeCardTrackWidth(columns: number): number | null {
  const maxWidth = homePageMaxWidth(columns)
  if (maxWidth == null) return null
  return maxWidth - (maxWidth >= HOME_FIVE_COL_WIDTH ? 80 : 56)
}

export function homeProbeRowCount(taskCount: number): number {
  const count = Math.min(HOME_LATENCY_CARD_LIMIT, Math.max(0, taskCount))
  if (count === 0) return 0
  return Math.ceil(count / 2)
}

export function homeProbeShouldStack(taskCounts: number[], index: number, columns: number): boolean {
  if (columns < 2 || index < 0 || index >= taskCounts.length) return false
  const count = Math.min(HOME_LATENCY_CARD_LIMIT, Math.max(0, taskCounts[index] ?? 0))
  if (count !== 2) return false
  const rowStart = Math.floor(index / columns) * columns
  const rowEnd = Math.min(taskCounts.length, rowStart + columns)
  let maxRows = 0
  for (let i = rowStart; i < rowEnd; i++) {
    maxRows = Math.max(maxRows, homeProbeRowCount(taskCounts[i] ?? 0))
  }
  return maxRows >= 2
}

export type LatencyBarTone = "green" | "amber" | "coral" | "empty"

export function latencyBarTone(latency: number | null): LatencyBarTone {
  if (latency === null || !Number.isFinite(latency) || latency < 0) return "empty"
  if (latency >= HOME_LATENCY_AMBER_MAX_MS) return "coral"
  if (latency > HOME_LATENCY_GREEN_MAX_MS) return "amber"
  return "green"
}

export type ProbeLossTone = "muted" | "amber" | "coral"

export function probeLossTone(packetLoss: number | null): ProbeLossTone {
  if (packetLoss === null || !Number.isFinite(packetLoss) || packetLoss <= 0) return "muted"
  if (packetLoss > 5) return "coral"
  return "amber"
}

export function probeRailTone(input: { latency: number | null; packetLoss: number | null }): LatencyBarTone {
  const latency = finiteNonNegativeOrNull(input.latency)
  const packetLoss = finiteNonNegativeOrNull(input.packetLoss)
  if (latency === null && packetLoss === null) return "empty"
  if ((packetLoss !== null && packetLoss > 5) || (latency !== null && latency >= HOME_LATENCY_AMBER_MAX_MS)) {
    return "coral"
  }
  if (packetLoss !== null && packetLoss > 0) return "amber"
  return "green"
}

export interface ProbeHealthBucket {
  tone: LatencyBarTone
  height: number
  opacity: number
  latency: number | null
  packetLoss: number | null
}

function finiteNonNegativeOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function rawBucketsFromSummary(
  summary: Pick<HomeLatencySummary, "latency" | "packetLoss" | "latencyHistory" | "packetLossHistory" | "total" | "valid" | "interval">,
  bucketCount: number,
): Array<{ latency: number | null; packetLoss: number | null }> {
  const latencyHistory = Array.isArray(summary.latencyHistory) ? summary.latencyHistory : []
  const lossHistory = Array.isArray(summary.packetLossHistory) ? summary.packetLossHistory : []
  const historyLen = Math.max(latencyHistory.length, lossHistory.length)

  if (historyLen >= 2) {
    const raw = Array.from({ length: historyLen }, (_, idx) => ({
      latency: finiteNonNegativeOrNull(latencyHistory[idx] ?? null),
      packetLoss: finiteNonNegativeOrNull(lossHistory[idx] ?? null),
    }))
    if (raw.length >= bucketCount) return raw.slice(raw.length - bucketCount)
    const padCount = bucketCount - raw.length
    return [
      ...Array.from({ length: padCount }, () => ({ latency: null, packetLoss: null })),
      ...raw,
    ]
  }

  const total = finiteOrNull(summary.total)
  const valid = finiteOrNull(summary.valid)
  const latency = finiteNonNegativeOrNull(summary.latency)
  const packetLoss = finiteNonNegativeOrNull(summary.packetLoss)
  const hasSamples =
    total !== null
      ? total > 0
      : valid !== null
        ? valid > 0
        : latency !== null || packetLoss !== null

  if (!hasSamples) {
    return Array.from({ length: bucketCount }, () => ({ latency: null, packetLoss: null }))
  }

  const interval = finiteOrNull(summary.interval)
  let activeCount = bucketCount
  if (total !== null && total > 0 && interval !== null && interval > 0) {
    const expected = Math.max(1, Math.floor((HOME_LATENCY_WINDOW_HOURS * 3600) / interval))
    if (total < expected * 0.85) {
      activeCount = Math.max(1, Math.min(bucketCount, Math.round((total / expected) * bucketCount)))
    }
  }

  const loss = packetLoss ?? 0
  const lossBuckets = loss > 0 ? Math.max(1, Math.min(activeCount, Math.round((loss / 100) * activeCount))) : 0
  const emptyPrefix = bucketCount - activeCount

  return Array.from({ length: bucketCount }, (_, idx) => {
    if (idx < emptyPrefix) return { latency: null, packetLoss: null }
    const activeIdx = idx - emptyPrefix
    const isLossBucket =
      lossBuckets > 0 &&
      Math.floor(((activeIdx + 1) * lossBuckets) / activeCount) > Math.floor((activeIdx * lossBuckets) / activeCount)
    if (!isLossBucket) {
      return { latency, packetLoss: 0 }
    }
    const bucketLoss = loss >= 100 ? 100 : loss > 5 ? Math.max(loss, 5.1) : loss
    const spikeLatency =
      bucketLoss >= 100
        ? null
        : latency !== null
          ? Math.max(latency * 1.18, latency + 12)
          : null
    return { latency: spikeLatency, packetLoss: bucketLoss }
  })
}

export function buildProbeHealthBuckets(
  summary: Pick<HomeLatencySummary, "latency" | "packetLoss" | "latencyHistory" | "packetLossHistory" | "total" | "valid" | "interval">,
  bucketCount = HOME_LATENCY_BUCKET_COUNT,
): ProbeHealthBucket[] {
  const size = Math.max(1, Math.floor(bucketCount))
  const raw = rawBucketsFromSummary(summary, size)
  const validDelays = raw.map((item) => item.latency).filter((val): val is number => val !== null)
  const maxDelay = validDelays.length > 0 ? Math.max(...validDelays) : 0
  const minDelay = validDelays.length > 0 ? Math.min(...validDelays) : 0
  const spread = Math.max(maxDelay - minDelay, maxDelay * 0.15, 1)

  return raw.map((bucket) => {
    if (bucket.latency === null && bucket.packetLoss === null) {
      return {
        tone: "empty",
        height: 5,
        opacity: 1,
        latency: null,
        packetLoss: null,
      }
    }

    const loss = bucket.packetLoss ?? 0
    const delay = bucket.latency
    const jitterRatio = delay === null ? 1 : Math.min(1, Math.max(0, (delay - minDelay) / spread))
    const height =
      loss > 0
        ? Math.min(10, Math.max(8, Math.round(8 + jitterRatio * 2)))
        : Math.min(10, Math.max(6, Math.round(6 + jitterRatio * 4)))

    if (loss > 5 || (delay !== null && delay >= HOME_LATENCY_AMBER_MAX_MS) || (delay === null && loss > 0)) {
      return { tone: "coral", height, opacity: 0.95, latency: delay, packetLoss: bucket.packetLoss }
    }
    if (loss > 0) {
      return { tone: "amber", height, opacity: 0.95, latency: delay, packetLoss: bucket.packetLoss }
    }
    return { tone: "green", height, opacity: 0.68, latency: delay, packetLoss: bucket.packetLoss }
  })
}

export const PROBE_MISSING_VALUE = "—"

export function formatProbePacketLoss(packetLoss: number | null): string {
  if (packetLoss === null || !Number.isFinite(packetLoss) || packetLoss < 0) return PROBE_MISSING_VALUE
  return `${packetLoss.toFixed(1)}%`
}

export function formatProbeLatency(latency: number | null): { value: string; unit: string | null } {
  if (latency === null || !Number.isFinite(latency) || latency < 0) {
    return { value: PROBE_MISSING_VALUE, unit: null }
  }
  return { value: latency.toFixed(2), unit: "ms" }
}

export function hourPacketFillPercent(input: { total?: number | null; valid?: number | null; packetLoss?: number | null }): number {
  const total = finiteOrNull(input.total)
  const valid = finiteOrNull(input.valid)
  if (total !== null) {
    if (total <= 0) return 0
    if (valid !== null) return Math.min(100, Math.max(0, (valid / total) * 100))
  }
  if (valid !== null && valid > 0) {
    const loss = finiteOrNull(input.packetLoss)
    if (loss !== null) return Math.min(100, Math.max(0, 100 - loss))
    return 100
  }
  return 0
}

function finiteOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function summarizeHomeLatencySamples(
  samples: HomeLatencySample[],
  historyLimit = 12,
  referenceEndMs?: number | null,
): HomeLatencyByServer {
  const taskBuckets = new Map<string, TaskBuckets>()

  for (const sample of samples) {
    const timestamp = finiteOrNull(sample.timestamp)
    const count = finiteOrNull(sample.count)
    if (!sample.entityId || !sample.taskId || timestamp === null || count === null || count <= 0) continue

    const key = `${sample.entityId}\u0000${sample.taskId}`
    const task = taskBuckets.get(key) || {
      entityId: sample.entityId,
      taskId: sample.taskId,
      taskName: sample.taskName || sample.taskId,
      buckets: new Map<number, SummaryBucket>(),
    }
    const bucketTime = Math.floor(timestamp / HOME_BUCKET_MS) * HOME_BUCKET_MS
    const lossRatio = Math.min(1, Math.max(0, finiteOrNull(sample.lossRatio) ?? 0))
    const bucket = task.buckets.get(bucketTime) || { latencySum: 0, latencyCount: 0, lostCount: 0, totalCount: 0 }
    const validCount = count * (1 - lossRatio)
    const latency = finiteOrNull(sample.latency)

    if (latency !== null && latency >= 0 && validCount > 0) {
      bucket.latencySum += latency * validCount
      bucket.latencyCount += validCount
    }
    bucket.lostCount += count * lossRatio
    bucket.totalCount += count
    task.buckets.set(bucketTime, bucket)
    taskBuckets.set(key, task)
  }

  const endMs = finiteOrNull(referenceEndMs)
  const minAnchorBucket = endMs !== null ? Math.floor(endMs / HOME_BUCKET_MS) * HOME_BUCKET_MS - HOME_BUCKET_MS : null

  const summaries: HomeLatencyByServer = {}
  for (const task of taskBuckets.values()) {
    const latestSampleBucket = Math.max(...task.buckets.keys())
    const anchorTimestamp = minAnchorBucket !== null ? Math.max(latestSampleBucket, minAnchorBucket) : latestSampleBucket
    const windowSize = Math.max(1, Math.floor(historyLimit))
    const history = Array.from({ length: windowSize }, (_, index) => {
      const timestamp = anchorTimestamp - (windowSize - index - 1) * HOME_BUCKET_MS
      const bucket = task.buckets.get(timestamp)
      return {
        timestamp,
        latency: bucket && bucket.latencyCount > 0 ? bucket.latencySum / bucket.latencyCount : null,
        packetLoss: bucket && bucket.totalCount > 0 ? (bucket.lostCount / bucket.totalCount) * 100 : null,
      }
    })
    let windowLostCount = 0
    let windowTotalCount = 0
    for (const item of history) {
      const bucket = task.buckets.get(item.timestamp)
      if (!bucket) continue
      windowLostCount += bucket.lostCount
      windowTotalCount += bucket.totalCount
    }

    const summary: HomeLatencyTaskSummary = {
      taskId: task.taskId,
      taskName: task.taskName,
      latency: history.at(-1)?.latency ?? null,
      packetLoss: windowTotalCount > 0 ? (windowLostCount / windowTotalCount) * 100 : null,
      latencyHistory: history.map((item) => item.latency),
      packetLossHistory: history.map((item) => item.packetLoss),
      updatedAt: latestSampleBucket,
      total: windowTotalCount > 0 ? windowTotalCount : null,
      valid: windowTotalCount > 0 ? Math.max(0, windowTotalCount - windowLostCount) : null,
    }
    summaries[task.entityId] = [...(summaries[task.entityId] || []), summary]
  }

  return summaries
}

export function mergeHomeLatencyBuckets(
  statsByServer: HomeLatencyByServer,
  bucketsByServer: HomeLatencyByServer,
): HomeLatencyByServer {
  const entityIds = new Set([...Object.keys(statsByServer), ...Object.keys(bucketsByServer)])
  const merged: HomeLatencyByServer = {}

  for (const entityId of entityIds) {
    const statList = statsByServer[entityId] || []
    const bucketList = bucketsByServer[entityId] || []
    if (bucketList.length === 0) {
      if (statList.length > 0) merged[entityId] = statList
      continue
    }
    if (statList.length === 0) {
      merged[entityId] = bucketList
      continue
    }

    const bucketByTask = new Map(bucketList.map((item) => [item.taskId, item]))
    const seen = new Set<string>()
    const combined: HomeLatencyTaskSummary[] = []

    for (const item of statList) {
      seen.add(item.taskId)
      const bucket = bucketByTask.get(item.taskId)
      if (!bucket) {
        combined.push(item)
        continue
      }
      combined.push({
        ...item,
        latency: item.latency ?? bucket.latency,
        packetLoss: item.packetLoss ?? bucket.packetLoss,
        latencyHistory: bucket.latencyHistory,
        packetLossHistory: bucket.packetLossHistory,
        updatedAt: item.updatedAt ?? bucket.updatedAt,
      })
    }

    for (const bucket of bucketList) {
      if (!seen.has(bucket.taskId)) combined.push(bucket)
    }

    if (combined.length > 0) merged[entityId] = combined
  }

  return merged
}

export interface PingStatForHome {
  entity_id?: string
  task_id?: string
  name?: string
  latest?: number | null
  avg?: number | null
  loss?: number | null
  total?: number | null
  valid?: number | null
  interval?: number | null
}

export function mapPingStatsToHomeLatency(stats: PingStatForHome[], tasks: Array<{ id?: number | string; name?: string }> = []): HomeLatencyByServer {
  const taskNames = new Map(tasks.map((task) => [String(task.id), task.name || `Task ${task.id}`]))
  const taskOrder = new Map(tasks.map((task, index) => [String(task.id), index]))
  const result: HomeLatencyByServer = {}

  for (const stat of stats) {
    const entityId = String(stat.entity_id || "").trim()
    const taskId = String(stat.task_id || "").trim()
    if (!entityId || !taskId) continue

    const total = finiteOrNull(stat.total)
    const valid = finiteOrNull(stat.valid)
    const latencyRaw = finiteOrNull(stat.latest) ?? finiteOrNull(stat.avg)
    const hasSamples = total !== null ? total > 0 : valid !== null ? valid > 0 : latencyRaw !== null
    const latency = hasSamples ? latencyRaw : null
    const packetLoss = hasSamples ? finiteOrNull(stat.loss) : null
    const summary: HomeLatencyTaskSummary = {
      taskId,
      taskName: stat.name || taskNames.get(taskId) || `Task ${taskId}`,
      latency,
      packetLoss,
      latencyHistory: [latency],
      packetLossHistory: [packetLoss],
      updatedAt: hasSamples ? Date.now() : null,
      total,
      valid,
      interval: finiteOrNull(stat.interval),
    }
    result[entityId] = [...(result[entityId] || []), summary]
  }

  for (const entityId of Object.keys(result)) {
    result[entityId].sort((left, right) => {
      const first = taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER
      const second = taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER
      return first === second ? left.taskName.localeCompare(right.taskName) : first - second
    })
  }

  return result
}

interface HomeLatencyCachePayload {
  savedAt: number
  data: HomeLatencyByServer
}

type ReadableStorage = Pick<Storage, "getItem">
type WritableStorage = Pick<Storage, "setItem">

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isHistory(value: unknown): value is Array<number | null> {
  return Array.isArray(value) && value.every(isNullableNumber)
}

function isTaskSummary(value: unknown): value is HomeLatencyTaskSummary {
  if (!value || typeof value !== "object") return false
  const summary = value as Partial<HomeLatencyTaskSummary>
  return (
    typeof summary.taskId === "string" &&
    typeof summary.taskName === "string" &&
    isNullableNumber(summary.latency) &&
    isNullableNumber(summary.packetLoss) &&
    isHistory(summary.latencyHistory) &&
    isHistory(summary.packetLossHistory) &&
    isNullableNumber(summary.updatedAt)
  )
}

export function readHomeLatencyCache(storage: ReadableStorage | null, entityIds: string[], now = Date.now()): HomeLatencyByServer | undefined {
  if (!storage || entityIds.length === 0) return undefined

  try {
    const parsed = JSON.parse(storage.getItem(HOME_LATENCY_CACHE_KEY) || "null") as Partial<HomeLatencyCachePayload> | null
    if (!parsed || typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) return undefined
    if (parsed.savedAt > now + MINUTE_MS || now - parsed.savedAt > HOME_LATENCY_CACHE_MAX_AGE_MS) return undefined
    if (!parsed.data || typeof parsed.data !== "object") return undefined

    const cached: HomeLatencyByServer = {}
    for (const entityId of entityIds) {
      const summaries = parsed.data[entityId]
      if (Array.isArray(summaries) && summaries.every(isTaskSummary)) cached[entityId] = summaries
    }
    return Object.keys(cached).length > 0 ? cached : undefined
  } catch {
    return undefined
  }
}

export function writeHomeLatencyCache(storage: WritableStorage | null, data: HomeLatencyByServer, savedAt = Date.now()): void {
  if (!storage || Object.keys(data).length === 0) return

  try {
    const payload: HomeLatencyCachePayload = { savedAt, data }
    storage.setItem(HOME_LATENCY_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Live data remains available when storage is disabled.
  }
}
