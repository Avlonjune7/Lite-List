import type { LiteWebsocketResponse } from "@/types/lite-api"
import { createContext } from "react"

export interface WebSocketContextType {
  lastMessage: { data: string } | null
  snapshot?: LiteWebsocketResponse | null
  connected: boolean
}

export const WebSocketContext = createContext<WebSocketContextType>({
  lastMessage: null,
  snapshot: null,
  connected: false,
})
