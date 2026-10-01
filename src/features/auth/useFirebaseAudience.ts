import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import type { ArchiveAudience } from "../../data/archive-repository";
import { getFirebaseServices } from "../../lib/firebase/client";

const currentTermsVersion = "2026-07-20";
const currentCommunityRulesVersion = "2026-07-20";

export function useFirebaseAudience() {
  const services = useMemo(() => getFirebaseServices(), []);
  const [state, setState] = useState<{
    audience: ArchiveAudience;
    ready: boolean;
  }>(() => ({
    audience: "public",
    ready: !services,
  }));

  useEffect(() => {
    if (!services) return;
    let unsubscribeAccount: Unsubscribe | undefined;
    const unsubscribeAuth = onAuthStateChanged(services.auth, (user) => {
      unsubscribeAccount?.();
      unsubscribeAccount = undefined;
      if (!user) {
        setState({ audience: "public", ready: true });
        return;
      }
      // Never carry the previous account's member access into a new account lookup.
      setState({ audience: "public", ready: false });
      unsubscribeAccount = onSnapshot(
        doc(services.firestore, "users", user.uid),
        (snapshot) => {
          if (services.auth.currentUser?.uid !== user.uid) return;
          const account = snapshot.data();
          const active = snapshot.exists()
            && account?.connected === true
            && account?.termsVersion === currentTermsVersion
            && account?.communityRulesVersion === currentCommunityRulesVersion;
          setState({ audience: active ? "member" : "public", ready: true });
        },
        () => { if (services.auth.currentUser?.uid === user.uid) setState({ audience: "public", ready: true }); },
      );
    });
    return () => {
      unsubscribeAccount?.();
      unsubscribeAuth();
    };
  }, [services]);

  return state;
}
