import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebaseServices } from "../../lib/firebase/client";

export type ExternalCalendarLink = {
  id: string;
  name: string;
  organizerName: string;
  region: string;
  publicUrl: string;
};

function safeTimeTreeUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const allowed = url.protocol === "https:"
      && !url.username && !url.password && !url.port
      && (url.hostname === "timetreeapp.com" || url.hostname.endsWith(".timetreeapp.com"));
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function listPublicExternalCalendars(): Promise<ExternalCalendarLink[]> {
  const services = getFirebaseServices();
  if (!services) return [];
  const snapshot = await getDocs(query(
    collection(services.firestore, "calendarSources"),
    where("status", "==", "active"),
    where("visibility", "==", "public"),
    where("sourceType", "==", "timetree_link"),
    limit(12),
  ));
  return snapshot.docs.flatMap((document) => {
    const publicUrl = safeTimeTreeUrl(document.get("publicUrl"));
    if (!publicUrl) return [];
    return [{
      id: document.id,
      name: String(document.get("name") ?? "공개 캘린더"),
      organizerName: String(document.get("organizerName") ?? "운영 주체 확인 전"),
      region: String(document.get("region") ?? "전국"),
      publicUrl,
    }];
  });
}
