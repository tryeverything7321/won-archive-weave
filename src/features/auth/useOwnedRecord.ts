import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, type DocumentData, type Unsubscribe } from "firebase/firestore";
import { getFirebaseServices } from "../../lib/firebase/client";

/** Private records are readable only by their owner under Firestore rules. */
export function useOwnedRecord(collection: "calendarEventSubmissions" | "submissions", id: string) {
  const services = useMemo(() => getFirebaseServices(), []);
  const [record, setRecord] = useState<DocumentData | null>(null);

  useEffect(() => {
    if (!services || !id) return undefined;
    let generation = 0;
    let unsubscribeRecord: Unsubscribe | undefined;
    const unsubscribe = onAuthStateChanged(services.auth, (user) => {
      unsubscribeRecord?.();
      unsubscribeRecord = undefined;
      const current = ++generation;
      setRecord(null);
      if (!user) return;
      unsubscribeRecord = onSnapshot(
        doc(services.firestore, collection, id),
        (snapshot) => {
          if (current !== generation || services.auth.currentUser?.uid !== user.uid) return;
          const value = snapshot.data();
          setRecord(value?.ownerUid === user.uid ? value : null);
        },
        () => {
          if (current === generation) setRecord(null);
        },
      );
    });
    return () => {
      generation += 1;
      unsubscribeRecord?.();
      unsubscribe();
    };
  }, [collection, id, services]);

  return record;
}
