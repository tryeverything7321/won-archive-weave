#!/usr/bin/env node

const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function integerOption(name, fallback) {
  const raw = option(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

const projectId = option("--project") ?? process.env.FIREBASE_PROJECT_ID
const idToken = process.env.FIREBASE_ID_TOKEN
const apply = args.includes("--apply")
const writerFenceConfirmed = args.includes("--confirm-writer-fence-deployed")
const indexReadyConfirmed = args.includes("--confirm-index-ready")
const maxIterations = integerOption("--max-iterations", 1_000)

console.log(
  "Required rollout order: composite index READY → writer trigger/functions deployed "
  + "→ migration runner → owner-list smoke",
)

if (!projectId || !/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
  throw new Error("Provide a valid Firebase project with --project or FIREBASE_PROJECT_ID")
}
if (!idToken) {
  throw new Error("Set FIREBASE_ID_TOKEN to an administrator Firebase Auth ID token")
}
if (apply && !writerFenceConfirmed) {
  throw new Error(
    "Apply is closed until repairCreatedSubmissionSortTimestamp is deployed. "
    + "Re-run with --confirm-writer-fence-deployed only after verifying that deployment.",
  )
}
if (apply && !indexReadyConfirmed) {
  throw new Error(
    "Apply is closed until the submissions ownerUid/sortCreatedAt/__name__ index is READY. "
    + "Re-run with --confirm-index-ready only after verifying index status.",
  )
}

const retryableStatuses = new Set(["ABORTED", "INTERNAL", "RESOURCE_EXHAUSTED", "UNAVAILABLE"])
const MAX_ABORTED_WAIT_MS = 6 * 60 * 1_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function invokeCallable(functionName, data) {
  const endpoint = `https://asia-northeast3-${projectId}.cloudfunctions.net/${functionName}`
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(130_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.error) {
    const status = typeof payload.error?.status === "string" ? payload.error.status : `HTTP_${response.status}`
    const error = new Error(`Callable failed with ${status}`)
    error.status = status
    throw error
  }
  const result = payload.result ?? payload.data
  if (!result || typeof result !== "object") throw new Error("Callable returned an invalid result")
  return result
}

async function invokeWithRetry(action) {
  const startedAt = Date.now()
  let attempt = 0
  while (true) {
    try {
      return await invokeCallable("migrateSubmissionSortCreatedAt", { action })
    } catch (error) {
      if (!retryableStatuses.has(error?.status)) throw error
      if (error?.status === "ABORTED") {
        if (Date.now() - startedAt >= MAX_ABORTED_WAIT_MS) throw error
        await sleep(Math.min(15_000, 1_000 * (2 ** Math.min(attempt, 4))))
      } else {
        if (attempt >= 4) throw error
        await sleep(Math.min(5_000, 250 * (2 ** attempt)))
      }
      attempt += 1
    }
  }
}

const dryRun = await invokeWithRetry("dry_run")
console.log(JSON.stringify({ step: "dry_run", ...dryRun }))

if (!apply) {
  console.log(
    "Dry-run only. Add --apply --confirm-index-ready --confirm-writer-fence-deployed "
    + "after both rollout gates are verified.",
  )
  process.exit(0)
}

for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
  const result = await invokeWithRetry("apply")
  console.log(JSON.stringify({ step: "apply", iteration, ...result }))
  if (result.complete === true && result.phase === "complete") {
    const finalDryRun = await invokeWithRetry("dry_run")
    if (finalDryRun.complete !== true || finalDryRun.phase !== "complete") {
      throw new Error("Final dry-run did not confirm migration completion")
    }
    console.log(JSON.stringify({ step: "final_dry_run", ...finalDryRun }))
    const ownerSmoke = await invokeCallable("listMySubmissions", { pageSize: 1 })
    if (ownerSmoke.migrationRequired === true) {
      throw new Error("Owner-list smoke still reports migrationRequired")
    }
    console.log(JSON.stringify({
      step: "owner_list_smoke",
      migrationRequired: ownerSmoke.migrationRequired === true,
      itemCount: Array.isArray(ownerSmoke.submissions) ? ownerSmoke.submissions.length : null,
    }))
    process.exit(0)
  }
  await sleep(200)
}

throw new Error(`Migration did not complete within ${maxIterations} iterations`)
