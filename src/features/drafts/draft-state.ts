import type { DraftLoadResult, DraftSaveResult } from "./draft-store";

type DraftSaveError = Extract<DraftSaveResult, { status: "error" }>["reason"];

export type DraftUiState =
  | { phase: "hydrating" }
  | { phase: "ready" }
  | { phase: "editing" | "saving"; revision: string }
  | { phase: "saved"; revision: string; savedAtMs: number }
  | { phase: "error"; revision?: string; reason: DraftSaveError };

type DraftUiAction =
  | { type: "hydrated"; result: DraftLoadResult<unknown> }
  | { type: "edit"; revision: string }
  | { type: "saving"; revision: string }
  | { type: "saved"; revision: string; savedAtMs: number }
  | { type: "failed"; revision: string; reason: DraftSaveError }
  | { type: "retry" }
  | { type: "reset" };

export const initialDraftUiState: DraftUiState = { phase: "hydrating" };

export function draftUiReducer(state: DraftUiState, action: DraftUiAction): DraftUiState {
  if (action.type === "hydrated") {
    return action.result.status === "unavailable" || action.result.status === "corrupt"
      ? { phase: "error", reason: action.result.status === "unavailable" ? "unavailable" : "invalid" }
      : { phase: "ready" };
  }
  if (action.type === "reset") return { phase: "ready" };
  if (action.type === "retry") {
    if (state.phase !== "error") return state;
    return state.revision ? { phase: "editing", revision: state.revision } : { phase: "hydrating" };
  }
  if (action.type === "edit") return state.phase === "hydrating" ? state : { phase: "editing", revision: action.revision };
  if (action.type === "saving") return { phase: "saving", revision: action.revision };
  if (state.phase !== "saving" || state.revision !== action.revision) return state;
  if (action.type === "saved") return { phase: "saved", revision: action.revision, savedAtMs: action.savedAtMs };
  return { phase: "error", revision: action.revision, reason: action.reason };
}

export function draftOwnerTransition(
  _previousOwnerId: string | null,
  nextOwnerId: string | null,
  authSettled: boolean,
): string | null | undefined {
  return authSettled ? nextOwnerId : undefined;
}
