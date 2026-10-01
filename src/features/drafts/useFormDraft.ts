import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { browserDraftStore, createDraftSession, type DraftCaptureResult, type DraftCodec, type DraftEnvelope, type DraftIdentity, type DraftSession, type DraftStore } from "./draft-store";
import { draftUiReducer, initialDraftUiState, type DraftUiState } from "./draft-state";

export { draftOwnerTransition, draftUiReducer, initialDraftUiState, type DraftUiState } from "./draft-state";
export type { DraftCodec } from "./draft-store";

export type UseFormDraftOptions<T> = {
  identity: DraftIdentity;
  value: T;
  codec: DraftCodec<T>;
  onRestore(value: T): void;
  fileReselectionRequired?: boolean;
  store?: DraftStore;
  active?: boolean;
};

function nonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function useFormDraft<T>({ identity: rawIdentity, value, codec, onRestore, fileReselectionRequired, store: providedStore, active = true }: UseFormDraftOptions<T>) {
  const store = useMemo(() => providedStore ?? browserDraftStore(), [providedStore]);
  const { ownerId, kind, documentId } = rawIdentity;
  const identity = useMemo(() => ({ ownerId, kind, documentId }), [documentId, kind, ownerId]);
  const codecRef = useRef(codec);
  const valueRef = useRef(value);
  const restoreRef = useRef(onRestore);
  const fileFlagRef = useRef(fileReselectionRequired);
  const [state, setState] = useState<DraftUiState>(initialDraftUiState);
  const [recovery, setRecovery] = useState<DraftEnvelope<unknown> | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  const sessionRef = useRef<DraftSession<T> | null>(null);
  const enabledRef = useRef(false);

  useLayoutEffect(() => {
    codecRef.current = codec;
    valueRef.current = value;
    restoreRef.current = onRestore;
    fileFlagRef.current = fileReselectionRequired;
  }, [codec, fileReselectionRequired, onRestore, value]);

  useLayoutEffect(() => {
    if (!active) {
      sessionRef.current = null;
      enabledRef.current = false;
      queueMicrotask(() => {
        if (sessionRef.current) return;
        setEnabled(false);
        setRecovery(null);
        setState(initialDraftUiState);
      });
      return undefined;
    }
    const session = createDraftSession<T>({
      identity,
      codec: { encode: (next) => codecRef.current.encode(next), decode: (stored) => codecRef.current.decode(stored) },
      store,
      hydrationNonce: nonce(),
    });
    sessionRef.current = session;
    enabledRef.current = false;
    const result = session.load();
    if (result.status !== "ready") {
      session.prime(valueRef.current, fileFlagRef.current ?? false);
      enabledRef.current = true;
    }
    queueMicrotask(() => {
      if (sessionRef.current !== session) return;
      setState((current) => draftUiReducer(current, { type: "hydrated", result }));
      setRecovery(result.status === "ready" ? result.draft : null);
      setEnabled(result.status !== "ready");
    });
    return () => { if (sessionRef.current === session) sessionRef.current = null; };
  }, [active, hydrateAttempt, identity, store]);

  useLayoutEffect(() => {
    if (!enabled || !enabledRef.current || !sessionRef.current) return;
    const result = sessionRef.current.update(value, { fileReselectionRequired });
    if (result.status === "unchanged") return;
    queueMicrotask(() => {
      if (result.status === "saved") setState({ phase: "saved", revision: result.revision, savedAtMs: result.savedAtMs });
      else setState({ phase: "error", reason: result.reason, ...(result.revision ? { revision: result.revision } : {}) });
    });
  }, [enabled, fileReselectionRequired, value]);

  const continueDraft = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !recovery) return;
    const result = session.restore({ status: "ready", draft: recovery }, (restored) => restoreRef.current(restored));
    if (result.status !== "restored") setState({ phase: "error", reason: result.status === "unavailable" ? "unavailable" : "invalid" });
    setRecovery(null);
    enabledRef.current = false;
    queueMicrotask(() => {
      enabledRef.current = true;
      setEnabled(true);
    });
  }, [recovery]);

  const startNew = useCallback((nextBaseline?: T) => {
    const session = sessionRef.current;
    if (!session || !session.remove()) {
      setState({ phase: "error", reason: "unavailable" });
      return false;
    }
    session.prime(nextBaseline ?? valueRef.current, nextBaseline === undefined ? fileFlagRef.current ?? false : false);
    setRecovery(null);
    enabledRef.current = true;
    setEnabled(true);
    setState({ phase: "ready" });
    return true;
  }, []);

  const deleteDraft = useCallback((nextBaseline?: T) => {
    const session = sessionRef.current;
    if (!session || !session.remove()) {
      setState({ phase: "error", reason: "unavailable" });
      return false;
    }
    session.prime(nextBaseline ?? valueRef.current, nextBaseline === undefined ? fileFlagRef.current ?? false : false);
    setRecovery(null);
    enabledRef.current = true;
    setEnabled(true);
    setState({ phase: "ready" });
    return true;
  }, []);

  const retry = useCallback(() => {
    if (state.phase !== "error" || !state.revision) {
      setHydrateAttempt((current) => current + 1);
      return;
    }
    const result = sessionRef.current?.capture(valueRef.current, { fileReselectionRequired });
    if (!result) return;
    if (result.status === "saved") setState({ phase: "saved", revision: result.revision, savedAtMs: result.savedAtMs });
    else if (result.status === "error") setState({ phase: "error", reason: result.reason, ...(result.revision ? { revision: result.revision } : {}) });
  }, [fileReselectionRequired, state]);

  const capture = useCallback((nextValue?: T): DraftCaptureResult | undefined => sessionRef.current?.capture(nextValue ?? valueRef.current, { fileReselectionRequired }), [fileReselectionRequired]);
  const complete = useCallback((revision: string, nextBaseline?: T) => {
    const session = sessionRef.current;
    const result = session?.complete(revision) ?? "unavailable";
    if (result === "cleared" && session) {
      session.prime(nextBaseline ?? valueRef.current, nextBaseline === undefined ? fileFlagRef.current ?? false : false);
      enabledRef.current = true;
      setEnabled(true);
      setState({ phase: "ready" });
    }
    return result;
  }, []);

  return { state, recovery, continueDraft, startNew, deleteDraft, retry, capture, flush: capture, complete };
}
