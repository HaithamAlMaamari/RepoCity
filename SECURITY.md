# Security Policy

## Supported Status

RepoCity is pre-release and does not yet have a supported production version.

## Reporting

Do not publish suspected secrets or exploitable details in a public issue. Report them privately to the project owner until a dedicated security contact is published.

## Security Boundaries

- Browser code is public and cannot safely contain shared credentials.
- RepoCity must not request, persist, log, or bundle a GitHub personal access token.
- The Cloudflare Worker may use an encrypted `GITHUB_TOKEN` secret for public-repository quota only.
- Private repositories are rejected even if that Worker secret can access them.
- GitHub repository metadata and file paths are untrusted input.
- Browser automation uses isolated temporary profiles and public test data only.
- Third-party packages must be exact-versioned where they execute with browser or operating-system privileges.

## Release Requirements

- Zero known high or critical dependency vulnerabilities
- No client-side secrets
- Runtime validation for network responses
- Bounded upstream redirects, response sizes, traversal depth, entry count, and GitHub request count
- No unsafe HTML insertion from external data
- Documented CSP and deployment security headers
- Tested failure behavior for rate limits, malformed responses, and unsupported GPUs
