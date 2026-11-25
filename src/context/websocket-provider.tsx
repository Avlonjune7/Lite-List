import { SharedClient } from "@/hooks/use-rpc2"
import { isRpcAuthLossError } from "@/lib/rpc-auth"
import { readLiveStatusCache, writeLiveStatusCache } from "@/lib/live-status-cache"
import { getLiteNodes, normalizeLiteServerStatus, parseLiteWebsocketMessage } from "@/lib/utils"
import type { LiteWebsocketResponse } from "@/types/lite-api"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { WebSocketContext, WebSocketContextType } from "./websocket-context"

const STATUS_POLL_MS = 5000

function liveStatusStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lastMessage, setLastMessage] = useState<{ data: string } | null>(() => readLiveStatusCache(liveStatusStorage()))
  const [snapshot, setSnapshot] = useState<LiteWebsocketResponse | null>(() =>
    parseLiteWebsocketMessage(lastMessage?.data),
  )
  const [connected, setConnected] = useState(false)
  const activeRef = useRef(false)
  const requestRunningRef = useRef(false)
  const intervalIdRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    activeRef.current = false
    if (intervalIdRef.current != null) {
      window.clearInterval(intervalIdRef.current)
      intervalIdRef.current = null
    }
  }, [])

  const updateData = useCallback(async () => {
    if (!activeRef.current || requestRunningRef.current) return
    requestRunningRef.current = true

    try {
      const rpc2 = SharedClient()
      const [nodes, status] = await Promise.all([getLiteNodes(false), rpc2.call("common:getNodesLatestStatus")])
      if (!activeRef.current) return

      const nextSnapshot = normalizeLiteServerStatus(status, nodes)
      const message = { data: JSON.stringify(nextSnapshot) }
      // Authenticated addresses belong to the live response only.
      writeLiveStatusCache(liveStatusStorage(), JSON.stringify(nextSnapshot, (key, value) =>
        key === "ipv4" || key === "ipv6" ? undefined : value,
      ))
      setSnapshot(nextSnapshot)
      setLastMessage(message)
      setConnected(true)
    } catch (error) {
      if (isRpcAuthLossError(error)) {
        stopPolling()
        try {
          SharedClient().pause()
        } catch {
          // Provider already tore down the client.
        }
        return
      }
      console.warn("加载服务器状态失败，等待下一轮：", error instanceof Error ? error.message : error)
    } finally {
      requestRunningRef.current = false
    }
  }, [stopPolling])

  useEffect(() => {
    activeRef.current = true
    if (typeof document === "undefined" || !document.hidden) {
      void updateData()
    }

    intervalIdRef.current = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      void updateData()
    }, STATUS_POLL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden && activeRef.current) {
        void updateData()
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange)
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
      stopPolling()
    }
  }, [stopPolling, updateData])

  const contextValue: WebSocketContextType = useMemo(
    () => ({
      lastMessage,
      snapshot,
      connected,
    }),
    [lastMessage, snapshot, connected],
  )

  return <WebSocketContext.Provider value={contextValue}>{children}</WebSocketContext.Provider>
}
