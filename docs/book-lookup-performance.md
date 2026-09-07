# Book lookup performance

The ISBN form prefetches after 220 ms of unchanged, checksum-valid input. Prefetching does not show a spinner, display errors, or start enrichment. Submitting adopts the same pending or completed request; ISBN-10 and its ISBN-13 equivalent share the request. Changing the input or leaving the form cancels an unadopted pending prefetch.

## First result

Ownership and canonical-book reads run concurrently. An existing canonical record avoids the provider request. A catalog miss makes one Open Library edition request, batches author persistence, and saves the core book and an enrichment job before returning an addable result. Persistence still resolves competing canonical inserts.

Migration `0019_durable_open_library_payload.sql` adds nullable `books.open_library_metadata`. It retains the initial edition payload for later requests and retries. Existing books without this payload continue using the legacy enrichment lookup.

## Covers and details

The initial result includes the provider cover URL when available. Cover IDs are preferred over ISBN URLs, with OLID fallback when available. The browser can display this preview while the server downloads and stores the cover through StorageService. A failed preview renders a placeholder and can retry when the stored URL arrives.

Enrichment reuses the persisted edition payload, fetches only missing author/work details, and downloads the cover concurrently. A missing seeded cover is attempted once per job attempt. A failed optional work request preserves the available metadata. Persistence failures retain retry/cleanup behavior.

On identified Cloudflare deployments, enrichment has a two-request-per-second budget in addition to the shared three-request-per-second global limit. This limits sustained enrichment traffic to leave capacity for interactive lookups; it is not a strict priority queue or a latency guarantee. Anonymous requests retain the single shared one-request-per-second limit. Self-hosted deployments retain process-local pacing.

## Measuring the deployed result

Info-level structured logs include `operation`, `durationMs`, and `outcome` for lookup stages. Inspect `lookup.total`, `lookup.ownership`, `lookup.canonical`, `core.openLibraryMetadata`, `core.minimumPersistence`, and `core.pendingJobPersistence`. Outbound logs separately report `waitDurationMs` and `requestDurationMs`; enrichment logs include work metadata and cover download stages.

Compare previously unseen ISBNs before and after deployment. Record click-to-addable-result and click-to-visible-cover separately using the browser network/performance tools. Also compare paste-to-result because a completed prefetch can hide request time before the click. Server timings do not include browser image loading. A warmed local record is a different workload from a first-ever provider lookup.

No fixed latency improvement is assumed: Open Library response time, database location, and concurrent traffic still determine the deployed result.
