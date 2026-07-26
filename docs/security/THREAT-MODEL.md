# RepoCity Threat Model

## Scope

This model covers the public-repository product: the browser application, same-origin Cloudflare Worker, Cloudflare Cache API and Rate Limiting binding, optional encrypted GitHub credential, and GitHub public APIs. Private-repository and per-user authentication flows are out of scope and require a separate review.

The primary assets are:

- The optional `GITHUB_TOKEN`, Cloudflare account, deployment credentials, and release pipeline.
- GitHub quota, Worker CPU/subrequest budget, cache capacity, and product availability.
- The integrity of repository identity, completeness, metrics, sampling, and shared URLs.
- User safety when rendering untrusted repository names, paths, metadata, and API errors.

## Trust Boundaries

1. The browser is public and untrusted. It contains no shared credential and calls only the same-origin `/api` route.
2. The Cloudflare edge terminates public traffic. Static assets and API requests share an origin, but only API routes execute ingestion logic.
3. The Worker is trusted code with bounded access to an optional encrypted GitHub secret, Cache API, assets, and rate limiter.
4. GitHub responses are external, untrusted input even when received over HTTPS.
5. Repository content is public but adversary-controlled. Names and paths can be intentionally malformed or designed to consume resources.
6. CI and npm dependencies are privileged supply-chain inputs and must be treated separately from repository data.

## Threats And Controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| Browser credential extraction | No browser token support; secrets use Cloudflare encrypted bindings and never use `VITE_*` names | A compromised Cloudflare or GitHub account remains privileged |
| Private repository disclosure | Worker rejects private and disabled repositories even when its credential can read them | GitHub metadata classification is trusted only after runtime validation |
| SSRF or credential forwarding | GitHub paths are constructed from validated components; redirects are manual, bounded, exact-origin only, and reject URL userinfo | GitHub itself remains an external dependency |
| Malformed or deceptive data | Runtime validation checks identities, SHAs, modes, paths, hierarchy, counts, language totals, completeness, and sampling metadata | New schema versions require new validators |
| Truncated tree presented as complete | Truncated recursive responses are traversed by bounded direct subtrees; incomplete traversal returns an error | Repositories beyond declared limits are unavailable rather than partial |
| CPU, memory, or subrequest exhaustion | Request, depth, entry, body, output, timeout, CPU, and subrequest limits fail closed | Platform counters and timers cannot interrupt synchronous JavaScript until it yields |
| Public endpoint abuse | A pseudonymous actor bucket allows 3 requests per minute before a 10-request public-ingestion bucket per Cloudflare location; errors return `429` and `Retry-After` | Distributed clients can bypass location-local limits; shared addresses can affect legitimate users; this is not global DDoS or exact quota protection |
| Cache poisoning or mutable results | Cache keys include schema, canonical repository, immutable commit, file limit, and sampling policy; only successful responses are cached | Cache entries are location-local and misses can repeat work |
| XSS or unsafe links | External text uses DOM text nodes; unsafe HTML sinks were removed; GitHub links are constructed from validated identity and immutable SHA | A future rich-text feature would require a new sink review |
| URL-state manipulation | Repository, full commit SHA, and presentation seed are bounded and validated before use | Shared links can still request expensive valid public repositories |
| Sensitive logging | Custom security logs contain request IDs and error classes, not tokens, response bodies, IP addresses, repository identifiers, or exception messages | Cloudflare invocation logs can include full request URLs and follow account retention settings |
| Dependency or CI compromise | Locked dependencies, exact privileged-tool versions, high-severity audits, SHA-pinned CI actions, and least-privilege workflow permissions | Registry or action-owner compromise is not eliminated |

## Abuse-Control Policy

- `INGEST_ACTOR_RATE_LIMITER` uses namespace `10002`, limit `3`, period `60` seconds. Its key is a deterministic SHA-256 pseudonym of the connecting-IP header, used only by the binding and never logged by application code. The header is trusted for RepoCity's documented direct browser-to-edge deployment; same-zone Worker subrequests would require a separate header-trust review.
- `INGEST_GLOBAL_RATE_LIMITER` uses namespace `10001`, limit `10`, period `60` seconds, with the fixed class key `public-repository-ingestion-v1`.
- Both bindings are mandatory. A missing or failing binding returns retryable HTTP `503` rather than allowing unbounded GitHub work.
- Invalid methods and routes are rejected before either limiter. A valid request consumes an actor token first, then a global token if the actor is allowed. Actor rejection does not consume global capacity; global rejection has already consumed actor capacity. Cache hits and GitHub misses consume the same admission tokens.
- Limit rejection is retryable HTTP `429` with `Retry-After: 60` and `Cache-Control: no-store`.
- Counters are local, permissive, and eventually consistent. In the worst declared traversal case, one accepted request can still make up to 190 GitHub calls; distributed traffic can multiply that work across Cloudflare locations.
- Shared addresses, mobile carriers, and privacy relays may share an actor bucket. Production review must measure false positives without logging raw actor addresses.
- Invalid API traffic does not consume these ingestion buckets and can still consume Worker invocations; production launch must configure Cloudflare zone-level DDoS/WAF protections for volumetric and malformed traffic.
- Production launch must alert on sustained 429/5xx and GitHub-quota pressure, then review thresholds using public traffic data. Turnstile or authenticated per-user quotas are the next escalation if distributed abuse appears.
- Namespace IDs must remain unique within the Cloudflare account; change `10001` or `10002` before deployment if either namespace is already used by another Worker.

## Verification And Review

- Node tests cover request parsing, limiter allow/deny/failure behavior, upstream failures, redirects, size limits, traversal, cancellation, and timeout races.
- Workerd tests load Wrangler bindings and cover the configured actor and global thresholds, request signals, streamed bodies, and Cache API behavior.
- Production validation must confirm the encrypted secret, custom domain, rate-limit behavior from deployed traffic, cache MISS/HIT behavior, log redaction, WAF policy, and rollback path.
- Revisit this model before adding OAuth, private repositories, persistence, analytics, user-generated annotations, or new outbound origins.
