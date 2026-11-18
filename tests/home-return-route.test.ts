import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  hasPublicReturnRoute,
  mapPublicReturnRoutes,
  returnBlockBadgeForRoute,
  returnLineForPingTask,
  returnRouteForServer,
  returnRoutePillTone,
} from "../src/lib/home-return-route.ts"

const card = readFileSync(new URL("../src/components/ServerCard.tsx", import.meta.url), "utf8")
const latency = readFileSync(new URL("../src/components/ServerLatencySummary.tsx", import.meta.url), "utf8")
const page = readFileSync(new URL("../src/pages/Server.tsx", import.meta.url), "utf8")
const api = readFileSync(new URL("../src/lib/lite-api.ts", import.meta.url), "utf8")

test("maps public return routes without private probe fields", () => {
  const mapped = mapPublicReturnRoutes([
    {
      client: "Node-A",
      lines: ["CMNET", "CMNET", "CN2 GIA"],
      tasks: [
        { ping_task_id: 11, line: "CMNET" },
        { ping_task_id: 12, line: "CN2 GIA" },
        { ping_task_id: 11, line: "CMIN2" },
      ],
      suspected_blocked: true,
      high_confidence: true,
    },
    { client: "node-b", lines: ["  "], suspected_blocked: false },
  ])
  const route = returnRouteForServer(mapped, "node-a")
  assert.deepEqual(route?.lines, ["CMNET", "CN2 GIA"])
  assert.deepEqual(route?.tasks, [
    { pingTaskId: "11", line: "CMNET" },
    { pingTaskId: "12", line: "CN2 GIA" },
  ])
  assert.equal(returnLineForPingTask(route, "12"), "CN2 GIA")
  assert.equal(returnLineForPingTask(route, "99"), "")
  assert.equal(route?.suspectedBlocked, true)
  assert.equal(route?.highConfidence, true)
  assert.equal(returnBlockBadgeForRoute(route), "high")
  assert.equal(
    returnBlockBadgeForRoute({ client: "node-c", lines: [], tasks: [], suspectedBlocked: true, highConfidence: false }),
    "suspected",
  )
  assert.equal(returnBlockBadgeForRoute(returnRouteForServer(mapped, "node-b")), null)
  assert.equal(hasPublicReturnRoute(returnRouteForServer(mapped, "node-b")), false)
})

test("homepage cards load public return routes onto matching ping-task chips", () => {
  assert.match(api, /public:getPublicReturnRoutes/)
  assert.match(page, /fetchPublicReturnRoutes/)
  assert.match(page, /returnRouteForServer/)
  assert.match(card, /returnRoute=\{returnRoute\}/)
  assert.match(latency, /returnLineForPingTask/)
  assert.match(latency, /returnBlockBadgeForRoute/)
  assert.match(latency, /returnRoutePillTone/)
  assert.match(latency, /lite-probe-chip__tag/)
  assert.match(latency, /lite-probe-block-tag/)
  assert.match(latency, /serverCard\.suspectedBlockedHighShort/)
  assert.match(latency, /serverCard\.suspectedBlockedHigh/)
  assert.match(latency, /serverCard\.suspectedBlocked/)
  assert.doesNotMatch(latency, /reserveReturnSlot/)
  assert.doesNotMatch(latency, /lite-probe-chip__slot/)
  assert.match(latency, /data-return=\{hasAnyReturn \? "true" : "false"\}/)
  assert.doesNotMatch(latency, /serverCard.returnRouteTag/)
  assert.doesNotMatch(card, /lite-server-card__routes/)
  assert.doesNotMatch(card, /expected_line|ip_version|route_path|asn_path/)
  assert.doesNotMatch(page, /expected_line|ip_version/)
})

test("classifies return-route pill tones by carrier premium tier", () => {
  assert.equal(returnRoutePillTone("CMIN2"), "cmin2")
  assert.equal(returnRoutePillTone("cmi"), "cmin2")
  assert.equal(returnRoutePillTone("CN2 GIA"), "cn2")
  assert.equal(returnRoutePillTone("CN2 GT"), "cn2")
  assert.equal(returnRoutePillTone("CUG VIP"), "cug")
  assert.equal(returnRoutePillTone("9929"), "cug")
  assert.equal(returnRoutePillTone("10099"), "cug")
  assert.equal(returnRoutePillTone("4837"), "plain")
  assert.equal(returnRoutePillTone("163"), "plain")
  assert.equal(returnRoutePillTone("CMNET"), "plain")
  assert.equal(returnRoutePillTone(""), "plain")
})

test("drops unused home-probe-accent helper after moving to carrier route pills", () => {
  assert.equal(existsSync(new URL("../src/lib/home-probe-accent.ts", import.meta.url)), false)
})
