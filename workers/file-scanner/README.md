# Weave file scanner worker

This container is the malware-engine boundary used by `scanQuarantinedUpload`.

- Cloud Run IAM accepts only OIDC-authenticated `POST` requests from an allowed invoker.
- The application also requires `x-weave-scanner-token` as a defense-in-depth shared secret.
- The HTTP listener starts only after daemon readiness; engine failures still fail closed. It rejects empty requests and bodies larger than 20 MiB.
- Only ClamAV exit code `0` becomes `clean`.
- Malware exit code `1` becomes `blocked`.
- Missing definitions, definition refresh failure and engine errors fail closed with a non-2xx response.
- The persistent `clamd` engine loads definitions once per container; `clamdscan` clients share the engine. Each client is forcibly killed with `SIGKILL` after 60 seconds and the request fails closed.
- The caller binds the returned verdict to the exact Storage path, generation, size and SHA-256 before it updates a submission.

Runtime configuration:

- `SCANNER_BEARER_TOKEN`: required defense-in-depth secret shared with the Firebase Storage trigger and carried only in `x-weave-scanner-token`.
- `PORT`: supplied by the container platform.

Deploy Cloud Run with unauthenticated access disabled. Grant `roles/run.invoker` on this service only to the Firebase Functions runtime service account; the caller obtains a Google OIDC ID token whose audience is the Cloud Run service origin. Secret creation, IAM binding and staging EICAR verification are integration-owner operations. Do not deploy until `freshclam` can update successfully.
