import GroupSwitch from "@/components/GroupSwitch"
import ServerCard from "@/components/ServerCard"
import ServerOverview from "@/components/ServerOverview"
import { Loader } from "@/components/loading/Loader"
import type { SortType } from "@/context/sort-context"
import { useStatus } from "@/hooks/use-status"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { readHomeLatencyCache, writeHomeLatencyCache } from "@/lib/home-latency"
import { applyHomeProbeTaskOrder, homeProbeOverrideIds } from "@/lib/home-probe-tasks"
import { restoreHomeScroll, saveHomeScroll } from "@/lib/home-scroll"
import { returnRouteForServer } from "@/lib/home-return-route"
import { fetchHomeLatency, fetchPublicPingTasks, fetchPublicReturnRoutes, fetchServerGroup } from "@/lib/lite-api"
import { compareHomeServers, readThemeHomeSort } from "@/lib/theme-home-sort"
import { readHideEmptyProbeWindow, readShowHomeReturnRoute, readHomeProbeTaskOverrides } from "@/lib/theme-config"
import { formatLiteInfo, parseLiteWebsocketMessage } from "@/lib/utils"
import { ServerGroup } from "@/types/lite-api"
import { MenuItem, Select } from "@mui/material"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

function homeLatencyStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const SORT_OPTION_KEYS: Array<{ value: SortType; labelKey: string }> = [
  { value: "default", labelKey: "home.sortDefault" },
  { value: "name", labelKey: "home.sortName" },
  { value: "cpu", labelKey: "home.sortLoad" },
  { value: "up", labelKey: "home.sortUpload" },
  { value: "down", labelKey: "home.sortDownload" },
]

export default function Servers() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { lastMessage, snapshot, connected } = useWebSocketContext()
  const [currentGroup, setCurrentGroup] = useState("All")
  const themeSort = readThemeHomeSort()
  const [sortType, setSortType] = useState<SortType>(themeSort.sortType)
  const sortOrder = themeSort.sortOrder
  const { data: groupData } = useQuery({
    queryKey: ["server-group"],
    queryFn: () => fetchServerGroup(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const websocketData = useMemo(
    () => snapshot ?? parseLiteWebsocketMessage(lastMessage?.data),
    [snapshot, lastMessage?.data],
  )
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const toggleRow = useCallback((id: number) => {
    setExpandedIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useLayoutEffect(() => {
    restoreHomeScroll()
    const timers = [50, 120, 250].map((ms) => window.setTimeout(() => restoreHomeScroll(), ms))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  useEffect(() => {
    setCurrentGroup(sessionStorage.getItem("selectedGroup") || "All")
  }, [])

  useEffect(() => {
    let ticking = false
    let armed = false
    const armTimer = window.setTimeout(() => {
      armed = true
    }, 300)
    const persist = () => {
      ticking = false
      if (!armed) return
      saveHomeScroll()
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(persist)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      armed = false
      window.clearTimeout(armTimer)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  const handleGroupChange = (group: string) => {
    setCurrentGroup(group)
    sessionStorage.setItem("selectedGroup", group)
  }

  const groupedServers = useMemo(() => {
    if (!websocketData) return []
    return websocketData.servers.filter((server) => {
      if (currentGroup === "All") return true
      return groupData?.data?.some((group: ServerGroup) => group.group.name === currentGroup && group.servers?.includes(server.id))
    })
  }, [websocketData, currentGroup, groupData?.data])

  const infoMap = useMemo(() => {
    const map = new Map<number, ReturnType<typeof formatLiteInfo>>()
    if (!websocketData) return map
    for (const server of groupedServers) {
      map.set(server.id, formatLiteInfo(websocketData.now, server))
    }
    return map
  }, [groupedServers, websocketData])

  const { totalServers, onlineServers, offlineServers, up, down, upSpeed, downSpeed, regionServers, filteredServers } = useMemo(() => {
    if (!websocketData) {
      return {
        totalServers: 0,
        onlineServers: 0,
        offlineServers: 0,
        up: 0,
        down: 0,
        upSpeed: 0,
        downSpeed: 0,
        regionServers: [],
        filteredServers: [],
      }
    }
    const total = groupedServers.length
    let onlineCount = 0
    let totalUp = 0
    let totalDown = 0
    let totalUpSpeed = 0
    let totalDownSpeed = 0
    const regions: Array<{ country_code?: string; online: boolean; cpu?: number; mem?: number; tcp?: number; udp?: number; cpu_cores?: number; mem_total?: number; mem_used?: number; disk_total?: number; disk_used?: number }> = []
    const statusList: typeof groupedServers = []

    for (const server of groupedServers) {
      const info = infoMap.get(server.id)!
      if (info.online) {
        onlineCount++
        totalUp += server.state?.net_out_transfer || 0
        totalDown += server.state?.net_in_transfer || 0
        totalUpSpeed += (server.state?.net_out_speed || 0) / 1000 / 1000
        totalDownSpeed += (server.state?.net_in_speed || 0) / 1000 / 1000
      }
      regions.push({
        country_code: info.country_code,
        online: info.online,
        cpu: info.cpu,
        mem: info.mem,
        tcp: info.tcp,
        udp: info.udp,
        cpu_cores: info.cpu_cores,
        mem_total: info.mem_total,
        mem_used: server.state?.mem_used || 0,
        disk_total: info.disk_total,
        disk_used: server.state?.disk_used || 0,
      })
      if (status === "all" || (info.online ? "online" : "offline") === status) {
        statusList.push(server)
      }
    }

    statusList.sort((a, b) => compareHomeServers(a, b, websocketData.now, sortType, sortOrder, infoMap))
    return {
      totalServers: total,
      onlineServers: onlineCount,
      offlineServers: total - onlineCount,
      up: totalUp,
      down: totalDown,
      upSpeed: totalUpSpeed,
      downSpeed: totalDownSpeed,
      regionServers: regions,
      filteredServers: statusList,
    }
  }, [groupedServers, infoMap, websocketData, status, sortType, sortOrder])

  const latencyEntityIds = useMemo(() => filteredServers
    .filter(server => expandedIds.has(server.id))
    .flatMap(server => server.uuid ? [server.uuid] : [])
    .sort(), [filteredServers, expandedIds])

  const { data: tasks } = useQuery({
    queryKey: ["home-probe-assignments"],
    queryFn: fetchPublicPingTasks,
    enabled: readHideEmptyProbeWindow() && filteredServers.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
  const assignedClients = useMemo(() => new Set(tasks?.flatMap(task =>
    (task.clients || []).map(id => id.toLowerCase()))), [tasks])

  const { data: homeLatency = {} } = useQuery({
    queryKey: ["home-latency", latencyEntityIds],
    queryFn: async () => {
      const data = await fetchHomeLatency(latencyEntityIds)
      writeHomeLatencyCache(homeLatencyStorage(), data)
      return data
    },
    placeholderData: () => readHomeLatencyCache(homeLatencyStorage(), latencyEntityIds),
    enabled: latencyEntityIds.length > 0,
    staleTime: 5_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  })
  const { data: returnRoutes = {} } = useQuery({
    queryKey: ["home-return-routes"],
    queryFn: fetchPublicReturnRoutes,
    enabled: latencyEntityIds.length > 0 && readShowHomeReturnRoute(),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  })

  if (!connected && !lastMessage) {
    return <Loader visible />
  }

  if (!websocketData) {
    return <p className="py-20 text-center text-sm text-muted-foreground">{t("info.processing")}</p>
  }

  const groupTabs = [
    "All",
    ...(groupData?.data
      ?.filter((item: ServerGroup) => item.servers?.some((serverId) => websocketData.servers.some((server) => server.id === serverId)))
      .map((item: ServerGroup) => item.group.name) || []),
  ]
  const probeOverrides = readHomeProbeTaskOverrides()
  const latencyFor = (uuid?: string) =>
    applyHomeProbeTaskOrder(uuid ? homeLatency[uuid] || [] : [], homeProbeOverrideIds(probeOverrides, uuid || ""))
  return (
    <div className="w-full">
      <ServerOverview
        total={totalServers}
        online={onlineServers}
        offline={offlineServers}
        up={up}
        down={down}
        upSpeed={upSpeed}
        downSpeed={downSpeed}
        now={websocketData.now}
        servers={regionServers}
      />
      <section className="mb-5 mt-7 flex items-center justify-between gap-3 max-[967px]:mt-5 max-[967px]:grid max-[967px]:grid-cols-[minmax(0,1fr)_auto] max-[967px]:items-center max-[967px]:gap-x-2.5 max-[967px]:gap-y-2.5" aria-label={t("home.filter")}>
        <div className="flex min-w-0 items-center gap-3 max-[967px]:contents">
          <div className="flex items-end gap-2.5 max-[967px]:col-start-1 max-[967px]:row-start-1">
            <h2 className="m-0 text-lg font-semibold leading-none text-[#1C252E] dark:text-white">{t("home.allServers")}</h2>
            <span className="text-[11px] leading-none text-[#919EAB]">{t("home.serverCount", { count: filteredServers.length })}</span>
          </div>
          <div className="min-w-0 max-[967px]:col-span-2 max-[967px]:row-start-2">
            <GroupSwitch tabs={groupTabs} currentTab={currentGroup} setCurrentTab={handleGroupChange} />
          </div>
        </div>
        <Select
          size="small"
          value={sortType}
          onChange={(event) => setSortType(event.target.value as SortType)}
          aria-label={t("home.sort")}
          sx={{ minWidth: 112, height: 32, fontSize: 11, flexShrink: 0, ".MuiSelect-select": { py: 0.75 } }}
        >
          {SORT_OPTION_KEYS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{t(option.labelKey)}</MenuItem>
          ))}
        </Select>
      </section>
      <section
        className="lite-list-scroll"
        aria-label={t("home.allServers")}
      >
        <div className="lite-server-list">
          <div className="lite-list-head lite-list-grid">
            {[t("serverCard.node"), "IP", t("serverCard.rate"), t("serverCard.traffic"), "CPU",
              t("serverCard.mem"), t("serverCard.stg"), t("serverCard.load"), t("serverCard.uptime")].map(label => <span key={label}>{label}</span>)}
          </div>
        {filteredServers.map((serverInfo) => (
          <ServerCard
            now={websocketData.now}
            key={serverInfo.id}
            serverInfo={serverInfo}
            expanded={expandedIds.has(serverInfo.id)}
            onToggle={toggleRow}
            hasAssignedProbe={assignedClients.has(serverInfo.uuid?.toLowerCase() ?? "")}
            formattedInfo={infoMap.get(serverInfo.id)}
            latencySummaries={latencyFor(serverInfo.uuid)}
            returnRoute={returnRouteForServer(returnRoutes, serverInfo.uuid)}
          />
        ))}
        </div>
      </section>
    </div>
  )
}
