# Weave document preview worker

Bounded Cloud Run worker for converting reviewed Office Open XML documents into PDF previews.

## HTTP contract

- `POST /convert?format=docx|pptx|xlsx|hwp|hwpx`
- Request body: raw document bytes (`application/octet-stream`), 1 byte to 20 MiB
- Success: `200 application/pdf`, at most 30 MiB
- Only one conversion is accepted per container; an overlapping request receives `429`
- Conversion is killed after 45 seconds and receives `504`
- HWP5 and HWPX use the checksum-pinned `rhwp v0.8.6` Linux x86_64 binary; Office Open XML uses LibreOffice. The runtime uses Debian trixie because the pinned rhwp binary requires GLIBC 2.39, which bookworm does not provide.

Cloud Run must require IAM authentication. The service should use a dedicated runtime service account with no application IAM roles and container concurrency `1`. There is no application shared secret because Google-signed service-to-service identity is the authentication boundary.

## Safety boundary

Before conversion, the worker rejects malformed OOXML/HWPX, traversal paths, encrypted ZIP entries, excessive expansion, duplicate entries, macros, embedded/active content, external relationships, and spreadsheet formulas/features that can request external data. HWP5 requires the exact compound-file signature. HWP5/HWPX must also pass `rhwp scan --probe` with no password and `rhwp threat-scan` with a clean verdict. Both renderers run as the non-root container user. LibreOffice gets a fresh profile whose macro security is high. A fail-closed seccomp wrapper denies creation of IPv4 and IPv6 sockets before either renderer is executed; Unix-domain sockets remain available for renderer internals.

The syscall filter is defense in depth, not a general document malware scanner or a complete filesystem sandbox. It applies to the child renderer only: the Node HTTP server still needs network ingress to serve Cloud Run requests, while the renderer cannot create IPv4 or IPv6 sockets. A platform egress deny is additional hardening when the project has that infrastructure; it is not claimed as configured or required for the first private deployment. The dedicated runtime service account should still have no application IAM roles. Callers must submit only content that has already passed the upload quarantine and malware-review gates.

## Local checks

```bash
npm test
docker build -t weave-document-preview .
```

## HWP/HWPX smoke fixture

The checked-in spec is self-authored and contains no user or production data. With the checksum-verified `rhwp v0.8.6` binary on `PATH`:

```bash
probe_dir=$(mktemp -d /tmp/weave-rhwp-live.XXXXXX)
rhwp scaffold fixtures/rhwp-probe-spec.json --format hwpx -o "$probe_dir/probe.hwpx" --json
rhwp convert "$probe_dir/probe.hwpx" "$probe_dir/probe.hwp" --verify --verify-pages --json
rhwp verify "$probe_dir/probe.hwpx" --expect-pages 1 --expect-contains "원불교 청년회" --expect-format hwpx --json
rhwp verify "$probe_dir/probe.hwp" --expect-pages 1 --expect-contains "원불교 청년회" --expect-format hwp5 --json
```

After the integration owner sets `service_url` to the private Cloud Run origin, obtain an identity token without logging it and exercise both formats:

```bash
identity_token=$(gcloud auth print-identity-token --audiences="$service_url")
curl --fail-with-body -sS \
  -H "Authorization: Bearer $identity_token" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$probe_dir/probe.hwpx" \
  "$service_url/convert?format=hwpx" \
  -o "$probe_dir/probe-hwpx.pdf"
curl --fail-with-body -sS \
  -H "Authorization: Bearer $identity_token" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$probe_dir/probe.hwp" \
  "$service_url/convert?format=hwp" \
  -o "$probe_dir/probe-hwp.pdf"
unset identity_token
pdfinfo "$probe_dir/probe-hwpx.pdf"
pdfinfo "$probe_dir/probe-hwp.pdf"
```

The rhwp gate was qualified locally with a self-authored Korean HWPX, a verified lossless HWP5 conversion, clean threat scans, byte-identical PDF exports, and a rendered visual check. Deployment, IAM binding, optional platform egress hardening, and representative real-document fidelity checks remain integration-owner operations.
