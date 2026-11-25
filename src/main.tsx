import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Suspense, lazy } from "react"
import ReactDOM from "react-dom/client"

import App from "./App"
import MuiThemeBridge from "./components/MuiThemeBridge"
import PrivateSiteBootstrap from "./components/PrivateSiteBootstrap"
import { ThemeColorManager } from "./components/ThemeColorManager"
import { ThemeProvider } from "./components/ThemeProvider"
import { i18nReady } from "./i18n"
import { isRpcAuthLossError } from "./lib/rpc-auth"
import "./index.css"

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() => import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })))
  : null

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !isRpcAuthLossError(error) && failureCount < 1,
    },
  },
})

void i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <ThemeProvider storageKey="vite-ui-theme">
      <MuiThemeBridge>
        <ThemeColorManager />
        <QueryClientProvider client={queryClient}>
          <PrivateSiteBootstrap>
            <App />
            {ReactQueryDevtools ? (
              <Suspense fallback={null}>
                <ReactQueryDevtools />
              </Suspense>
            ) : null}
          </PrivateSiteBootstrap>
        </QueryClientProvider>
      </MuiThemeBridge>
    </ThemeProvider>,
  )
})
