import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "../../lib/firebase/client";
import {
  parseSubmissionOperatorException,
  type SubmissionExceptionAction,
  type SubmissionOperatorException,
} from "./submission-exceptions";

export type SubmissionExceptionPage = {
  items: SubmissionOperatorException[];
  nextCursor: string | null;
};

function functions() {
  const services = getFirebaseServices();
  if (!services) throw new Error("Firebase is not configured");
  return services.functions;
}

export async function listSubmissionOperatorExceptions(
  cursor: string | null = null,
): Promise<SubmissionExceptionPage> {
  const callable = httpsCallable<
    { cursor?: string; limit: number },
    { items?: unknown[]; nextCursor?: unknown }
  >(functions(), "listSubmissionOperatorExceptions");
  const result = await callable({
    ...(cursor ? { cursor } : {}),
    limit: 50,
  });
  return {
    items: Array.isArray(result.data.items)
      ? result.data.items
          .map(parseSubmissionOperatorException)
          .filter((item): item is SubmissionOperatorException => item !== null)
      : [],
    nextCursor: typeof result.data.nextCursor === "string" && result.data.nextCursor
      ? result.data.nextCursor
      : null,
  };
}

export async function runSubmissionOperatorExceptionAction(input: {
  exceptionId: string;
  submissionId: string;
  action: SubmissionExceptionAction;
  reason?: string;
  requestId?: string;
}) {
  const callable = httpsCallable<typeof input, { status: string }>(
    functions(),
    "resolveSubmissionOperatorException",
  );
  return (await callable(input)).data;
}
