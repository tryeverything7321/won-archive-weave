import { lazy, Suspense } from "react";
import { AnimatePresence } from "motion/react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RouteTransition } from "../components/RouteTransition";
import { RouteLoading } from "../components/RouteLoading";
import { importWithReload } from "../lib/lazy-with-reload";

const HomePage = lazy(() =>
  importWithReload(
    () => import("../routes/HomePage").then((m) => ({ default: m.HomePage })),
    "home",
  ),
);
const ArchivePage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/ArchivePages").then((m) => ({
        default: m.ArchivePage,
      })),
    "archive",
  ),
);
const ActivityPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/ArchivePages").then((m) => ({
        default: m.ActivityPage,
      })),
    "activity",
  ),
);
const ResourcesPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/ResourcesPage").then((m) => ({
        default: m.ResourcesPage,
      })),
    "resources",
  ),
);
const MaterialDetailPage = lazy(() => importWithReload(() => import('../routes/MaterialDetailPage').then((m) => ({ default: m.MaterialDetailPage })), 'material-detail'));
const BundleDetailPage = lazy(() => importWithReload(() => import("../features/bundles/BundleDetailPage").then(m => ({ default: m.BundleDetailPage })), "bundle-detail"));
const StartPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/InformationPages").then((m) => ({
        default: m.StartPage,
      })),
    "start",
  ),
);
const AboutPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/InformationPages").then((m) => ({
        default: m.AboutPage,
      })),
    "about",
  ),
);
const PlannerPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/InformationPages").then((m) => ({
        default: m.PlannerPage,
      })),
    "planner",
  ),
);
const CalendarPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/CalendarPages").then((m) => ({
        default: m.CalendarPage,
      })),
    "calendar",
  ),
);
const CalendarEventPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/CalendarPages").then((m) => ({
        default: m.CalendarEventPage,
      })),
    "calendar-event",
  ),
);
const CalendarConnectPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/CalendarPages").then((m) => ({
        default: m.CalendarConnectPage,
      })),
    "calendar-connect",
  ),
);
const CalendarEventCreatePage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/CalendarPages").then((m) => ({
        default: m.CalendarEventCreatePage,
      })),
    "calendar-event-create",
  ),
);
const PolicyPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/PolicyPage").then((m) => ({ default: m.PolicyPage })),
    "policy",
  ),
);
const ContributePage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/MemberPages").then((m) => ({
        default: m.ContributePage,
      })),
    "contribute",
  ),
);
const CommunityPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/MemberPages").then((m) => ({
        default: m.CommunityPage,
      })),
    "community",
  ),
);
const ProfilePage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/MemberPages").then((m) => ({ default: m.ProfilePage })),
    "profile",
  ),
);
const AuthCompletePage = lazy(() =>
  importWithReload(
    () =>
      import("../features/auth/AuthCompletePage").then((m) => ({
        default: m.AuthCompletePage,
      })),
    "auth-complete",
  ),
);
const AdminPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/AdminPages").then((m) => ({ default: m.AdminPage })),
    "admin",
  ),
);
const AdminAccessGuard = lazy(() =>
  importWithReload(
    () =>
      import("../features/auth/AdminAccessGuard").then((m) => ({
        default: m.AdminAccessGuard,
      })),
    "admin-access",
  ),
);
const NotFoundPage = lazy(() =>
  importWithReload(
    () =>
      import("../routes/NotFoundPage").then((m) => ({
        default: m.NotFoundPage,
      })),
    "not-found",
  ),
);

const PastArchiveEventCreatePage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.PastArchiveEventCreatePage })), "PastArchiveEventCreatePage"));
const ArchiveEventDetailPage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.ArchiveEventDetailPage })), "ArchiveEventDetailPage"));
const ArchiveCollectionsPage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.ArchiveCollectionsPage })), "ArchiveCollectionsPage"));
const ArchiveCollectionCreatePage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.ArchiveCollectionCreatePage })), "ArchiveCollectionCreatePage"));
const ArchiveCollectionDetailPage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.ArchiveCollectionDetailPage })), "ArchiveCollectionDetailPage"));
const ArchiveCollectionEditPage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.ArchiveCollectionEditPage })), "ArchiveCollectionEditPage"));
const ArchiveRelationCreatePage = lazy(() => importWithReload(() => import("../features/event-archive/EventArchivePages").then(m => ({ default: m.ArchiveRelationCreatePage })), "ArchiveRelationCreatePage"));

export function AppRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="sync" initial={false}>
      <RouteTransition routeKey={location.pathname} key={location.pathname}>
        <Suspense fallback={<RouteLoading />}>
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/start" element={<StartPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/brand" element={<Navigate replace to="/about#weave-story" />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/activities/:slug" element={<ActivityPage />} />
            <Route path="/archive-events/new" element={<PastArchiveEventCreatePage />} />
            <Route path="/archive-events/:eventId" element={<ArchiveEventDetailPage />} />
            <Route path="/collections" element={<ArchiveCollectionsPage />} />
            <Route path="/collections/new" element={<ArchiveCollectionCreatePage />} />
            <Route path="/collections/:collectionId" element={<ArchiveCollectionDetailPage />} />
            <Route path="/collections/:collectionId/edit" element={<ArchiveCollectionEditPage />} />
            <Route path="/archive-relations/new" element={<ArchiveRelationCreatePage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/materials/:id" element={<MaterialDetailPage />} />
            <Route path="/bundles/:bundleId" element={<BundleDetailPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/calendar/new" element={<CalendarEventCreatePage />} />
            <Route path="/calendar/connect" element={<CalendarConnectPage />} />
            <Route path="/events/:eventId" element={<CalendarEventPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/contribute" element={<ContributePage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route
              path="/admin"
              element={
                <AdminAccessGuard>
                  <AdminPage section="home" />
                </AdminAccessGuard>
              }
            />
            <Route
              path="/admin/submissions"
              element={
                <AdminAccessGuard>
                  <AdminPage section="submissions" />
                </AdminAccessGuard>
              }
            />
            <Route
              path="/admin/community"
              element={
                <AdminAccessGuard>
                  <AdminPage section="community" />
                </AdminAccessGuard>
              }
            />
            <Route
              path="/admin/calendar"
              element={
                <AdminAccessGuard>
                  <AdminPage section="calendar" />
                </AdminAccessGuard>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <AdminAccessGuard>
                  <AdminPage section="audit" />
                </AdminAccessGuard>
              }
            />
            <Route path="/admin/members" element={<AdminAccessGuard members><AdminPage section="members" /></AdminAccessGuard>} />
            <Route path="/admin/members/:memberId" element={<AdminAccessGuard members><AdminPage section="members" /></AdminAccessGuard>} />
            <Route path="/policies/:policy" element={<PolicyPage />} />
            <Route path="/auth/complete" element={<AuthCompletePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </RouteTransition>
    </AnimatePresence>
  );
}
