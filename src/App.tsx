import { BrowserRouter } from "react-router-dom"
import { AppRoutes } from "./app/AppRoutes"
import { SiteLayout } from "./app/SiteLayout"
import { AppErrorBoundary } from "./components/AppErrorBoundary"

function App() {
  return (
    <BrowserRouter>
      <SiteLayout>
        <AppErrorBoundary>
          <AppRoutes />
        </AppErrorBoundary>
      </SiteLayout>
    </BrowserRouter>
  )
}

export default App
