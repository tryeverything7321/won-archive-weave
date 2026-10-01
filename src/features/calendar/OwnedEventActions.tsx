import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { useOwnedRecord } from "../auth/useOwnedRecord";
import { getFirebaseServices } from "../../lib/firebase/client";
import type { CalendarEvent } from "./calendar-model";
import { EventEditor } from "./EventEditor";
import {
  managedEventActions,
  managedEventEditorValue,
  managedEventStatuses,
  type ManagedEventStatus,
} from "./event-editor-model";
import { ownedEventEditorRecord } from "./owned-event-model";

export function OwnedEventActions({ event, onChanged }: { event: CalendarEvent; onChanged: () => void }) {
  const record = useOwnedRecord("calendarEventSubmissions", event.id);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const status = record?.status;
  if (!record || !managedEventStatuses.includes(status as ManagedEventStatus)) return null;
  const actions = managedEventActions(status as ManagedEventStatus);
  const managed = ownedEventEditorRecord(event, record);

  const unpublish = async () => {
    if (!window.confirm("이 행사를 달력에서 삭제할까요? 원본은 내 위브에 남고 비공개 초안으로 복원할 수 있어요.")) return;
    const services = getFirebaseServices();
    if (!services) return;
    setWorking(true);
    setError("");
    try {
      const callable = httpsCallable<{ eventId: string }, unknown>(services.functions, "unpublishOwnedEvent");
      await callable({ eventId: event.id });
      navigate("/calendar", { replace: true });
    } catch {
      setError("행사를 달력에서 삭제하지 못했어요. 다시 시도해 주세요.");
      setWorking(false);
    }
  };

  return <section className="owned-content-actions" aria-label="내가 등록한 행사 관리">
    <span>내가 등록한 행사</span>
    {actions.canEdit && <button className="button button-secondary" type="button" onClick={() => setEditing(true)} disabled={working}><Pencil size={16} aria-hidden="true" /> 수정</button>}
    {actions.canUnpublish && <button className="button button-quiet" type="button" onClick={() => void unpublish()} disabled={working}><Trash2 size={16} aria-hidden="true" /> 삭제</button>}
    {error && <p role="alert">{error}</p>}
    {editing && <div className="owned-event-editor">
      <EventEditor
        key={event.id}
        eventId={event.id}
        initialValue={{ ...managedEventEditorValue(managed), mediaUploads: managed.mediaUploads, status: managed.status }}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged(); }}
      />
    </div>}
  </section>;
}
