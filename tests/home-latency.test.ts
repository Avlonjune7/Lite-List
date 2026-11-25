import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  HOME_CARD_WIDTH,
  HOME_FIVE_COL_WIDTH,
  HOME_FOUR_COL_WIDTH,
  HOME_LATENCY_BUCKET_COUNT,
  HOME_LATENCY_CARD_LIMIT,
  HOME_TWO_COL_WIDTH,
  buildProbeHealthBuckets,
  formatProbeLatency,
  formatProbePacketLoss,
  homeCardColumnCount,
  homeCardTrackWidth,
  homePageMaxWidth,
  homeProbeRowCount,
  homeProbeShouldStack,
  hourPacketFillPercent,
  latencyBarTone,
  mapPingStatsToHomeLatency,
  mergeHomeLatencyBuckets,
  probeLossTone,
  probeRailTone,
  readHomeLatencyCache,
  summarizeHomeLatencySamples,
  writeHomeLatencyCache,
} from "../src/lib/home-latency.ts"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

function sample(taskId: string, timestamp: number, latency: number | null, lossRatio: number, count: number) {
  return { entityId: "node-a", taskId, taskName: `Task ${taskId}`, timestamp, latency, lossRatio, count }
}

test("restores recent per-task latency values during a page refresh", () => {
  const storage = memoryStorage()
  const summary = {
    taskId: "1",
    taskName: "Shanghai",
    latency: 32,
    packetLoss: 1.5,
    latencyHistory: [30, 32],
    packetLossHistory: [0, 3],
    updatedAt: 120_000,
  }

  writeHomeLatencyCache(storage, { "node-a": [summary] }, 200_000)
  assert.deepEqual(readHomeLatencyCache(storage, ["node-a"], 210_000), { "node-a": [summary] })
})

test("ignores stale or unrelated latency cache entries", () => {
  const storage = memoryStorage()
  const summary = {
    taskId: "1",
    taskName: "Shanghai",
    latency: 32,
    packetLoss: 0,
    latencyHistory: [32],
    packetLossHistory: [0],
    updatedAt: 120_000,
  }

  writeHomeLatencyCache(storage, { "node-a": [summary] }, 200_000)
  assert.equal(readHomeLatencyCache(storage, ["node-b"], 210_000), undefined)
  assert.equal(readHomeLatencyCache(storage, ["node-a"], 200_000 + 5 * 60_000 + 1), undefined)
})

test("keeps every ping task as a separate weighted summary", () => {
  const bucket = 5 * 60_000
  const result = summarizeHomeLatencySamples(
    [sample("1", bucket, 20, 0, 10), sample("1", bucket, 40, 0.1, 10), sample("1", bucket * 2, 35, 0, 20), sample("2", bucket * 2, 80, 0, 5)],
    2,
  )

  assert.equal(result["node-a"].length, 2)
  const first = result["node-a"].find((item) => item.taskId === "1")!
  const second = result["node-a"].find((item) => item.taskId === "2")!
  assert.ok(Math.abs((first.latencyHistory[0] || 0) - 560 / 19) < 0.0001)
  assert.equal(first.packetLossHistory[0], 5)
  assert.equal(first.latency, 35)
  assert.equal(first.packetLoss, 2.5)
  assert.equal(second.latency, 80)
  assert.equal(second.taskName, "Task 2")
})

test("keeps each task timeline continuous when records skip intervals", () => {
  const bucket = 5 * 60_000
  const result = summarizeHomeLatencySamples([sample("1", bucket, 20, 1, 1), sample("1", bucket * 3, 30, 0, 1)], 3)["node-a"][0]

  assert.deepEqual(result.latencyHistory, [null, null, 30])
  assert.deepEqual(result.packetLossHistory, [100, null, 0])
  assert.equal(result.packetLoss, 50)
})

test("weights a task loss rate by probe count", () => {
  const bucket = 5 * 60_000
  const result = summarizeHomeLatencySamples([sample("1", bucket, null, 1, 2), sample("1", bucket * 2, 25, 0, 18)], 2)["node-a"][0]

  assert.equal(result.packetLoss, 10)
  assert.deepEqual(result.packetLossHistory, [100, 0])
})

test("keeps total packet loss visible without inventing latency", () => {
  const result = summarizeHomeLatencySamples([sample("1", 60_000, null, 1, 12)])["node-a"][0]
  assert.equal(result.latency, null)
  assert.equal(result.packetLoss, 100)
})

test("formats probe packet loss with one decimal", () => {
  assert.equal(formatProbePacketLoss(null), "—")
  assert.equal(formatProbePacketLoss(-1), "—")
  assert.equal(formatProbePacketLoss(0), "0.0%")
  assert.equal(formatProbePacketLoss(1.54), "1.5%")
  assert.equal(formatProbePacketLoss(100), "100.0%")
})

test("formats probe latency without turning 0 into missing", () => {
  assert.deepEqual(formatProbeLatency(null), { value: "—", unit: null })
  assert.deepEqual(formatProbeLatency(-1), { value: "—", unit: null })
  assert.deepEqual(formatProbeLatency(0), { value: "0.00", unit: "ms" })
  assert.deepEqual(formatProbeLatency(135.21), { value: "135.21", unit: "ms" })
})

test("fills the probe bar from last-hour reply rate, not expected ping count", () => {
  assert.equal(hourPacketFillPercent({}), 0)
  assert.equal(hourPacketFillPercent({ packetLoss: 0 }), 0)
  assert.equal(hourPacketFillPercent({ packetLoss: 25 }), 0)
  assert.equal(hourPacketFillPercent({ total: 0, valid: 0, packetLoss: 0 }), 0)
  assert.equal(hourPacketFillPercent({ total: 60, valid: 60 }), 100)
  assert.equal(hourPacketFillPercent({ total: 60, valid: 57, packetLoss: 5 }), 95)
  assert.equal(hourPacketFillPercent({ total: 12, valid: 12, interval: 60 }), 100)
  assert.equal(hourPacketFillPercent({ total: 15, valid: 15, packetLoss: 0 }), 100)
})

test("colors 0-80ms green, 80-180ms amber, and 180ms+ coral", () => {
  assert.equal(latencyBarTone(null), "empty")
  assert.equal(latencyBarTone(-4), "empty")
  assert.equal(latencyBarTone(0), "green")
  assert.equal(latencyBarTone(13), "green")
  assert.equal(latencyBarTone(80), "green")
  assert.equal(latencyBarTone(80.1), "amber")
  assert.equal(latencyBarTone(135), "amber")
  assert.equal(latencyBarTone(179.9), "amber")
  assert.equal(latencyBarTone(180), "coral")
  assert.equal(latencyBarTone(200), "coral")
})

test("maps ping metric stats onto per-task home summaries", () => {
  const result = mapPingStatsToHomeLatency(
    [
      { entity_id: "node-a", task_id: "2", name: "Tokyo", latest: 80, loss: 0 },
      { entity_id: "node-a", task_id: "1", latest: 32, avg: 40, loss: 1.5 },
    ],
    [
      { id: 1, name: "Shanghai" },
      { id: 2, name: "Tokyo" },
    ],
  )

  assert.equal(result["node-a"].length, 2)
  assert.equal(result["node-a"][0].taskName, "Shanghai")
  assert.equal(result["node-a"][0].latency, 32)
  assert.equal(result["node-a"][1].taskName, "Tokyo")
})

test("treats zero-sample ping stats as empty instead of a full green bar", () => {
  const result = mapPingStatsToHomeLatency([{ entity_id: "node-a", task_id: "1", name: "Fujian", latest: null, loss: 0, total: 0, valid: 0 }])
  assert.equal(result["node-a"][0].latency, null)
  assert.equal(result["node-a"][0].packetLoss, null)
  assert.equal(hourPacketFillPercent(result["node-a"][0]), 0)
})

test("homepage cards keep at most four probe tasks", () => {
  assert.equal(HOME_LATENCY_CARD_LIMIT, 4)
})

test("homepage probes render as C-2 telemetry health rails inside a rounded well", () => {
  const latency = readFileSync(new URL("../src/components/ServerLatencySummary.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8")
  const card = readFileSync(new URL("../src/components/ServerCard.tsx", import.meta.url), "utf8")
  const home = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
  const api = readFileSync(new URL("../src/lib/lite-api.ts", import.meta.url), "utf8")
  assert.match(latency, /slice\(0, HOME_LATENCY_CARD_LIMIT\)/)
  assert.match(latency, /lite-probe-well/)
  assert.match(latency, /lite-probe-row/)
  assert.match(latency, /lite-probe-row__rail/)
  assert.match(latency, /lite-probe-row__bars/)
  assert.match(latency, /lite-probe-row__bar/)
  assert.match(latency, /lite-probe-row__arrow/)
  assert.match(latency, /data-count=\{displayed.length\}/)
  assert.match(latency, /returnRoutePillTone/)
  assert.match(latency, /latencyBarTone/)
  assert.match(latency, /probeRailTone/)
  assert.match(latency, /probeLossTone/)
  assert.match(latency, /buildProbeHealthBuckets/)
  assert.doesNotMatch(latency, /lite-probe-chip__slot/)
  assert.doesNotMatch(latency, /grid-cols-2|stackProbes|col-span-2|grid-cols-3/)
  assert.doesNotMatch(latency, /homeLatencyGridTemplate|home-latency-cols/)
  assert.doesNotMatch(css, /grid-template-rows:\s*subgrid/)
  assert.doesNotMatch(css, /\[data-count="3"\]/)
  assert.doesNotMatch(css, /\[data-count="4"\]/)
  assert.match(css, /\.lite-probe-well \{[\s\S]*border-radius:\s*11px/)
  assert.match(css, /\.lite-probe-row \+ \.lite-probe-row \{[\s\S]*border-top:\s*1px solid var\(--probe-row-line\)/)
  assert.match(css, /\.lite-probe-row__rail \{[\s\S]*width:\s*3px/)
  assert.match(css, /\.lite-probe-row:hover \.lite-probe-row__rail[\s\S]*width:\s*3\.5px/)
  assert.match(css, /\.lite-probe-row__delay \{[\s\S]*align-items: baseline/)
  assert.match(css, /\.lite-probe-row__delay b,[\s\S]*white-space:\s*nowrap/)
  assert.match(css, /\.lite-probe-row__loss \{[\s\S]*white-space:\s*nowrap/)
  assert.match(css, /\.lite-server-card__quota \{[\s\S]*?border-top:\s*1px solid var\(--card-line\)/)
  assert.match(css, /\.lite-server-card__quality \{[\s\S]*flex:\s*0 0 auto/)
  assert.match(css, /\.lite-server-card__bottom \{[\s\S]*margin-top:\s*auto/)
  assert.match(api, /entity_ids:\s*entityIds/)
  assert.match(api, /max_points:\s*HOME_LATENCY_BUCKET_COUNT/)
  assert.match(card, /aria-expanded=\{expanded\}/)
  assert.match(home, /lite-server-list/)
})

test("decouples C-2 stability rail and 12-bucket bars from trans-oceanic orange latency", () => {
  assert.equal(HOME_LATENCY_BUCKET_COUNT, 12)
  // Zero-loss US-West 134ms line: amber latency number, green stability rail, 12 steady green bars
  assert.equal(latencyBarTone(134.09), "amber")
  assert.equal(probeRailTone({ latency: 134.09, packetLoss: 0 }), "green")
  assert.equal(probeLossTone(0), "muted")
  assert.equal(probeLossTone(1.2), "amber")
  assert.equal(probeLossTone(5), "amber")
  assert.equal(probeLossTone(5.1), "coral")
  assert.equal(probeRailTone({ latency: null, packetLoss: null }), "empty")
  assert.equal(probeRailTone({ latency: 131.9, packetLoss: 0.4 }), "amber")
  assert.equal(probeRailTone({ latency: 186.4, packetLoss: 0 }), "coral")
  assert.equal(probeRailTone({ latency: 60, packetLoss: 6.2 }), "coral")

  const steadyBuckets = buildProbeHealthBuckets({
    latency: 134.09,
    packetLoss: 0,
    latencyHistory: [133, 135, 134, 136, 134, 133, 135, 134, 136, 134, 135, 134],
    packetLossHistory: Array(12).fill(0),
  })
  assert.equal(steadyBuckets.length, 12)
  assert.ok(steadyBuckets.every((item) => item.tone === "green" && item.opacity === 0.68))
  assert.ok(steadyBuckets.every((item) => item.height >= 6 && item.height <= 7))

  const jitterBuckets = buildProbeHealthBuckets({
    latency: 132,
    packetLoss: 1.2,
    latencyHistory: [130, 132, null, 165, 131, 130, 132, 192, 131, 132, 130, 132],
    packetLossHistory: [0, 0, null, 2.5, 0, 0, 0, 8.0, 0, 0, 0, 0],
  })
  assert.equal(jitterBuckets[2].tone, "empty")
  assert.equal(jitterBuckets[2].height, 5)
  assert.equal(jitterBuckets[3].tone, "amber")
  assert.ok(jitterBuckets[3].height >= 8)
  assert.equal(jitterBuckets[7].tone, "coral")
  assert.equal(jitterBuckets[7].height, 10)
  assert.equal(jitterBuckets[0].tone, "green")
})

test("gracefully degrades 12-bucket bars from summary stats before bucket series arrives", () => {
  const empty = buildProbeHealthBuckets({
    latency: null,
    packetLoss: null,
    latencyHistory: [],
    packetLossHistory: [],
    total: 0,
    valid: 0,
  })
  assert.equal(empty.length, 12)
  assert.ok(empty.every((item) => item.tone === "empty" && item.height === 5))

  const singlePointSteady = buildProbeHealthBuckets({
    latency: 138.5,
    packetLoss: 0,
    latencyHistory: [138.5],
    packetLossHistory: [0],
    total: 60,
    valid: 60,
    interval: 60,
  })
  assert.equal(singlePointSteady.length, 12)
  assert.ok(singlePointSteady.every((item) => item.tone === "green"))

  const partialWindowWithLoss = buildProbeHealthBuckets({
    latency: 120,
    packetLoss: 10,
    latencyHistory: [120],
    packetLossHistory: [10],
    total: 20,
    valid: 18,
    interval: 60,
  })
  assert.equal(partialWindowWithLoss.filter((item) => item.tone === "empty").length, 8)
  assert.ok(partialWindowWithLoss.some((item) => item.tone === "coral"))
})

test("merges 12-bucket series into realtime ping stats without losing latest delay", () => {
  const stats = mapPingStatsToHomeLatency(
    [{ entity_id: "node-a", task_id: "1", name: "宁波移动", latest: 134.09, loss: 0, total: 60, valid: 60 }],
    [{ id: 1, name: "宁波移动" }],
  )
  const bucket = 5 * 60_000
  const bucketed = summarizeHomeLatencySamples(
    Array.from({ length: 12 }, (_, idx) => sample("1", bucket * (idx + 1), 132 + (idx % 3), 0, 5)),
    12,
  )
  const merged = mergeHomeLatencyBuckets(stats, bucketed)
  assert.equal(merged["node-a"][0].latency, 134.09)
  assert.equal(merged["node-a"][0].latencyHistory.length, 12)
  assert.equal(merged["node-a"][0].packetLossHistory.length, 12)
})

test("homepage card columns follow the server grid breakpoints", () => {
  assert.equal(homeCardColumnCount(967), 1)
  assert.equal(homeCardColumnCount(968), 2)
  assert.equal(homeCardColumnCount(1439), 2)
  assert.equal(homeCardColumnCount(1440), 4)
  assert.equal(homeCardColumnCount(1919), 4)
  assert.equal(homeCardColumnCount(1920), 5)
  assert.equal(homePageMaxWidth(1), null)
  assert.equal(homePageMaxWidth(2), HOME_TWO_COL_WIDTH)
  assert.equal(homePageMaxWidth(4), HOME_FOUR_COL_WIDTH)
  assert.equal(homePageMaxWidth(5), HOME_FIVE_COL_WIDTH)
  assert.equal(homeCardTrackWidth(1), null)
  assert.equal(homeCardTrackWidth(2), HOME_TWO_COL_WIDTH - 56)
  assert.equal(homeCardTrackWidth(4), HOME_FOUR_COL_WIDTH - 56)
  assert.equal(homeCardTrackWidth(4), HOME_CARD_WIDTH * 4 + 48)
  assert.equal(homeCardTrackWidth(5), HOME_FIVE_COL_WIDTH - 80)
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8")
  assert.match(css, /max-w-\[1920px\].*max-\[1919px\]:max-w-\[1680px\].*max-\[1439px\]:max-w-\[1120px\]/)
  const home = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
  assert.match(home, /lite-list-head lite-list-grid/)
})

test("two-task probes stack to one per row when a neighbor in the same row already has two probe rows", () => {
  assert.equal(homeProbeRowCount(0), 0)
  assert.equal(homeProbeRowCount(1), 1)
  assert.equal(homeProbeRowCount(2), 1)
  assert.equal(homeProbeRowCount(3), 2)
  assert.equal(homeProbeRowCount(4), 2)
  assert.equal(homeProbeRowCount(9), 2)

  const mixed = [2, 2, 2, 4]
  assert.equal(homeProbeShouldStack(mixed, 0, 4), true)
  assert.equal(homeProbeShouldStack(mixed, 1, 4), true)
  assert.equal(homeProbeShouldStack(mixed, 2, 4), true)
  assert.equal(homeProbeShouldStack(mixed, 3, 4), false)

  const even = [2, 2, 2, 2]
  assert.equal(homeProbeShouldStack(even, 0, 4), false)
  assert.equal(homeProbeShouldStack(even, 3, 4), false)

  const nextRow = [2, 2, 2, 2, 4]
  assert.equal(homeProbeShouldStack(nextRow, 0, 4), false)
  assert.equal(homeProbeShouldStack(nextRow, 4, 4), false)

  const threeCol = [2, 4, 2]
  assert.equal(homeProbeShouldStack(threeCol, 0, 3), true)
  assert.equal(homeProbeShouldStack(threeCol, 2, 3), true)

  assert.equal(homeProbeShouldStack([2, 4], 0, 1), false)
  assert.equal(homeProbeShouldStack([1, 4], 0, 4), false)
})
