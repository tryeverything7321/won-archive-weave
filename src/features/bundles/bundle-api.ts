import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable } from "firebase/storage";
import { getFirebaseServices } from "../../lib/firebase/client";
import {
  parseMaterialBundle,
  serverBundleVisibility,
  type BundleRightsRecord,
  type BundleVisibility,
  type MaterialBundle,
} from "./bundle-model";

function services() {
  const value = getFirebaseServices();
  if (!value) throw new Error("자료 기능을 준비하고 있어요.");
  return value;
}

export type BundleFileDescriptor = {
  clientFileId: string;
  name: string;
  displayName: string;
  order: number;
  size: number;
  contentType: string;
  sha256: string;
  replaceFileId?: string;
};

export type PreparedBundleFile = {
  clientFileId: string;
  fileId: string;
  revision: number;
  targetName: string;
  storagePath: string;
  sha256: string;
};

export async function sha256File(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createMaterialBundle(input: {
  requestId: string;
  title: string;
  description?: string;
  visibility: BundleVisibility;
  rights: BundleRightsRecord;
  eventId?: string | null;
}) {
  const payload = { ...input, visibility: serverBundleVisibility(input.visibility) };
  const callable = httpsCallable<typeof payload, { bundleId: string; status: "draft" }>(services().functions, "createMaterialBundle");
  const result = await callable(payload);
  if (!result.data.bundleId || result.data.status !== "draft") throw new Error("자료 저장 결과를 확인하지 못했어요.");
  return result.data;
}

export async function prepareMaterialBundleFiles(input: {
  bundleId: string;
  requestId: string;
  files: BundleFileDescriptor[];
}) {
  const callable = httpsCallable<typeof input, {
    bundleId: string;
    reservationId: string;
    expiresAtMs: number;
    files: PreparedBundleFile[];
  }>(services().functions, "prepareMaterialBundleFiles");
  const result = await callable(input);
  if (
    result.data.bundleId !== input.bundleId
    || !result.data.reservationId
    || result.data.expiresAtMs <= Date.now()
    || !Array.isArray(result.data.files)
  ) throw new Error("파일 업로드 예약을 확인하지 못했어요.");
  return result.data;
}

export async function uploadPreparedBundleFile(
  bundleId: string,
  prepared: PreparedBundleFile,
  file: File,
  reservationId: string,
  requestId: string,
  contentType: string,
  onProgress: (progress: number) => void,
) {
  const firebase = services();
  const uid = firebase.auth.currentUser?.uid;
  if (!uid) throw new Error("로그인이 만료되었어요. 다시 로그인해 주세요.");
  const expectedPrefix = `quarantined/${uid}/material-bundles/${bundleId}/${prepared.fileId}/`;
  if (!prepared.storagePath.startsWith(expectedPrefix) || prepared.storagePath.includes("..")) {
    throw new Error("파일 업로드 경로를 확인하지 못했어요.");
  }
  const upload = uploadBytesResumable(ref(firebase.storage, prepared.storagePath), file, {
    contentType,
    customMetadata: {
      reservationId,
      requestId,
      bundleId,
      fileId: prepared.fileId,
      revision: String(prepared.revision),
      weaveSha256: prepared.sha256,
    },
  });
  await new Promise<void>((resolve, reject) => upload.on(
    "state_changed",
    (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1)) * 100)),
    reject,
    resolve,
  ));
}

export async function finalizeMaterialBundle(bundleId: string, requestId: string) {
  const callable = httpsCallable<{ bundleId: string; requestId: string }, { bundleId: string; status: "active" }>(services().functions, "finalizeMaterialBundle");
  const result = await callable({ bundleId, requestId });
  if (result.data.bundleId !== bundleId || result.data.status !== "active") throw new Error("자료 완료 상태를 확인하지 못했어요.");
  return result.data;
}

export async function getMaterialBundle(bundleId: string): Promise<MaterialBundle> {
  const callable = httpsCallable<{ bundleId: string }, unknown>(services().functions, "getMaterialBundle");
  const result = await callable({ bundleId });
  const value = result.data && typeof result.data === "object" && "bundle" in result.data
    ? (result.data as { bundle: unknown }).bundle
    : result.data;
  return parseMaterialBundle(value);
}

export async function listMyMaterialBundles(cursor?: string | null): Promise<{ bundles: MaterialBundle[]; nextCursor: string | null }> {
  const callable = httpsCallable<{ limit: number; cursor?: string }, { items: unknown[]; nextCursor?: string | null }>(services().functions, "listMyMaterialBundles");
  const result = await callable({ limit: 50, ...(typeof cursor === "string" ? { cursor } : {}) });
  if (!Array.isArray(result.data.items)) throw new Error("내 자료 목록을 확인하지 못했어요.");
  return {
    bundles: result.data.items.map(parseMaterialBundle),
    nextCursor: typeof result.data.nextCursor === "string" ? result.data.nextCursor : null,
  };
}

export async function updateMaterialBundle(input: {
  bundleId: string;
  requestId: string;
  title: string;
  description: string;
  visibility: BundleVisibility;
  rights: BundleRightsRecord;
  eventId: string | null;
}) {
  const payload = { ...input, visibility: serverBundleVisibility(input.visibility) };
  const callable = httpsCallable<typeof payload, unknown>(services().functions, "updateMaterialBundle");
  await callable(payload);
}

export async function updateMaterialBundleFiles(input: {
  bundleId: string;
  requestId: string;
  files: Array<{ fileId: string; displayName: string; order: number }>;
}) {
  const callable = httpsCallable<typeof input, unknown>(services().functions, "updateMaterialBundleFiles");
  await callable(input);
}

export async function withdrawMaterialBundleFile(bundleId: string, fileId: string) {
  const callable = httpsCallable<{ bundleId: string; fileId: string; requestId: string }, unknown>(services().functions, "withdrawMaterialBundleFile");
  await callable({ bundleId, fileId, requestId: crypto.randomUUID() });
}

export async function createMaterialBundleFileAccess(bundleId: string, fileId: string, action: "preview" | "download") {
  const callable = httpsCallable<{ bundleId: string; fileId: string; action: "preview" | "download" }, { url: string; expiresAtMs: number }>(services().functions, "createMaterialBundleFileAccess", { timeout: 120_000 });
  const result = await callable({ bundleId, fileId, action });
  if (!/^https:\/\//u.test(result.data.url) || result.data.expiresAtMs <= Date.now()) throw new Error("파일 열람 링크를 확인하지 못했어요.");
  return result.data;
}

export async function ensureCalendarArchiveEvent(sourceCalendarEventId: string, requestId = crypto.randomUUID()) {
  const callable = httpsCallable<{ sourceCalendarEventId: string; requestId: string }, { archiveEventId: string; event: { title?: string }; repeated: boolean }>(services().functions, "ensureArchiveEventContext");
  const result = await callable({ sourceCalendarEventId, requestId });
  if (!result.data.archiveEventId) throw new Error("행사 연결 대상을 확인하지 못했어요.");
  return result.data;
}

export async function linkArchiveTarget(input: {
  archiveEventId: string;
  targetType: "bundle" | "material" | "activity";
  targetId: string;
  requestId: string;
}) {
  const callable = httpsCallable<typeof input, { relationId: string; status: "linked"; repeated: boolean }>(services().functions, "linkArchiveRelation");
  const result = await callable(input);
  if (!result.data.relationId || result.data.status !== "linked") throw new Error("행사 연결 결과를 확인하지 못했어요.");
  return result.data;
}
