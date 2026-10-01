type AuthUser = { uid: string } | null;
type DraftSessionStore = {
  reconcileOwner: (ownerId: string | null) => unknown;
  sweepExpired: () => unknown;
};

export function bindDraftAuthSession(
  subscribe: (callback: (user: AuthUser) => void) => () => void,
  store: DraftSessionStore,
) {
  let active = true;
  const unsubscribe = subscribe((user) => {
    if (!active) return;
    store.reconcileOwner(user?.uid ?? null);
    store.sweepExpired();
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
