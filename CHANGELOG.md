# Changelog

## [0.5.13] - 2026-11-10

- Remove demo workspace buttons from packaged macOS and Windows apps while retaining local development demos.
- Reject normal packaged demo startup; retain explicitly isolated acceptance-test fixtures.
- Check demo-control visibility in packaged desktop and Windows acceptance tests.

## [0.5.12] - 2026-11-10

- Publish public Apple Silicon DMG and Windows x64 portable ZIP downloads, each with checksums and build provenance. No GitHub sign-in is needed.
- Use maintained node-pty/ConPTY support for Windows terminals and share native resize routing across resource terminals and saved sessions.
- Test Windows keyboard input, resizing, Unicode, exit, private cluster context and packaged YAML editing before publishing. Gate publication on successful native builds for both platforms.

## [0.5.11] - 2026-11-10

- Restore visible AWS connection settings with automatic Terminal settings and independent manual overrides.
- Refresh automatic settings without restarting or clearing manual overrides and unsaved edits; show each field’s settings source.
- Normalize uppercase/lowercase proxy variables, tolerate shell startup output, and retain prior automatic settings if refresh fails.
- Add regression coverage for mixed automatic/manual settings and the connection settings UI.

## [0.5.10] - 2026-11-10

- Resolve the seven dependency-advisory package entries, rebuild Monaco from ESM with the patched DOMPurify3.4.17, and gate releases on zero npm advisories.
- Add experimental Windows build infrastructure; defer Windows publication pending native acceptance. Release 0.5.10 ships the Apple Silicon DMG only.

- Clear prior-role namespace search state and retain unsaved ConfigMap data drafts across detail dismissal in memory.

- Confirm all resource deletions without typing names; retain the separate typed confirmation for node drain.
- Start a cluster terminal when opening an empty Terminal & logs panel. Connect resource terminals automatically on opening their tab, reuse active sessions, and reconnect when selecting a different Pod container or shell.
- Keep Connect clusters as a deliberate File-menu page rather than restoring it on startup or cluster switching.
- Simplify connection setup and automatically load searchable, checked namespace choices when selecting an EKS cluster, with manual entry when namespace listing is restricted.
- Save ConfigMap data directly, including Save & Close and keyboard save; retain optional YAML review, multiline/binary values, cancellation drafts and validation feedback.

## [0.5.9] - 2026-11-08

### Fixed

- Open official regional AWS `signin.aws` browser approval pages during SSO sign-in instead of rejecting them before the browser opens.
- Accept official approval pages across AWS regions while retaining HTTPS, hostname, credentials and port checks.
- Show an actionable unsupported sign-in address error and clarify that the IAM Identity Center region can differ from the EKS cluster region.

## [0.5.8] - 2026-11-06

### Added

- In-editor YAML Find with case sensitivity, match counts, next/previous navigation, wraparound and keyboard shortcuts.
- Find controls for plain values/data/settings editors, native rich/comparison editor search, log-filter shortcuts, rendered-page search and local terminal scrollback search.

### Fixed

- Escape closes Find or clears a nonempty log query before closing resource details/settings.
- Plain-text search preserves match offsets after Unicode characters and treats pattern characters literally.
- Terminal viewport adapts to Find controls and retains search matches after resizing.
- Terminal-close acceptance check waits for process and renderer cleanup.

## [0.5.7] - 2026-11-05

### Added

- Priority Classes, Runtime Classes, Leases, admission webhook configurations, admission policies/bindings and Ingress Classes with resource-specific columns.
- Separate Helm Charts and Releases navigation.

### Changed

- Group sidebar resources into Workloads, Config, Network, Storage, Helm, Access Control and Custom Resources, with direct Cluster, Nodes, Namespaces and Events links.
- Move extra utilities to File → Workspace tools and remove unrelated resource controls from Connect clusters.

### Fixed

- Restore valid AWS SSO sessions and account/role selections when reopening connections or restarting; real token expiry and assigned permissions still apply.
- Keep custom API groups visible directly under Custom Resources, with working search and expandable resource links.

## [0.5.6] - 2026-11-05

### Added

- Page controls for large Pod, Node, workload, configuration and Events tables, with 50/100/250 rows per page.
- Compact per-container status squares with hover details for readiness, waiting/error, completion and unavailable states.

### Changed

- Resource lists using the persistent API display received pages while remaining pages load, with a clear loaded/loading count.
- Search, sorting and CSV exports cover the full loaded list. Filters reset the page; metrics and live updates retain the selected page when possible.

### Fixed

- Ignore stale progressive responses after context/request changes and preserve Secret list redaction in incremental updates.

## [0.5.5] - 2026-11-04

### Added

- Search cluster contexts by name or cluster, with keyboard selection and click-away dismissal.
- Node details list assigned Pods across namespaces with search, refresh and direct Pod inspection.

### Changed

- Move occasional tools into the macOS File menu, Services and Ingresses under Network, and HPA/VPA under More Workloads.
- Hide Create resource on Nodes and Cluster, and remove the namespace picker's redundant Done button.
- Connect opens the workspace automatically after success. AWS role selection prepares the profile and loads clusters automatically; selecting a saved profile loads its clusters too.

### Fixed

- Preserve drawer drafts while switching through the searchable context picker.
- Ignore stale AWS account/role responses and clear previous connection choices when changing identity.

## [0.5.4] - 2026-10-31

### Added

- AWS connection diagnostics show the CLI executable/version, selected profile and region, and sanitized identity and EKS checks.
- Optional AWS executable, HTTPS proxy, proxy bypass and CA bundle settings that persist privately on each Mac.
- Drag resource table column edges to resize, with widths saved per resource type, keyboard adjustment and double-click reset.

### Changed

- Finder launches import allowlisted networking and AWS configuration settings from the login shell, including its AWS executable, without importing static AWS credentials.
- Column dividers stay subtle, highlighting only on hover, keyboard focus or drag.
- Resource headers use a compact layout; cluster-scoped pages hide namespace controls and the duplicate All namespaces line is removed.

### Fixed

- AWS CLI requests respect configured endpoint URLs and inherited proxy/CA configuration while retaining certificate verification.

## [0.5.3] - 2026-10-31

### Added

- AWS SSO browser sign-in followed by discovery of assigned accounts and roles, searchable selections, separate role profiles and EKS connections.
- Rich ConfigMap/Secret data controls, resource-specific details and HPA/VPA visibility.
- Hierarchical resource-map grouping, multi-cluster Projects, local Monaco editing/diffs, guided resource forms, curated Helm catalog, read-only GitOps views and declarative extensions.
- Guided kubeconfig import and provider/client diagnostics.

### Changed

- Frequent Kubernetes resource lists, Events, metrics/API reads and watches use persistent, context-isolated API connections. Terminal, log, Helm and mutation CLI workflows remain intact.
- Optional metrics no longer block resource rows or navigation; namespace scopes, pagination, cancellation and stale-result isolation are retained.
- Sidebar headings are bolder and Custom API Groups fully collapses.

### Fixed

- Appearance saves no longer overwrite newer live previews.
- SSO account/role selection uses clickable lists instead of native dropdowns.
- Kubeconfig-relative exec paths and rotating tokenFile credentials are preserved by the API transport; auth failures never switch identities.

## [0.5.2] - 2026-10-30

### Added

- Cluster dashboard and resource map, grouped custom resources, collapsible navigation and resource-specific column pickers.
- CPU/memory history for Nodes and workloads, shared preset/custom time ranges, hover details, drag zoom, PNG/CSV export and monitoring diagnostics.
- Troubleshooting findings, favorites/saved views and metadata search across connected clusters.
- Log search, severity/source filters, JSON formatting and pause/resume, with bounded buffers and regex execution time limits.
- Light/dark/system themes, text sizes, smart palettes and advanced colors with live preview; custom kubeconfig paths through Settings and YAML.
- Production labels, backend-enforced read-only mode, resource permission checks and redacted local action history.
- Manual GitHub update/release-note checks, client dependency checks and setup guidance.

### Changed

- Namespace checkboxes apply immediately while retaining multiple selection, removal and Clear all.
- Pop-ups, resource details and dialogs dismiss on outside clicks; unsaved YAML is retained in memory and cancelled appearance previews revert.
- Startup prioritizes the active workspace; concurrent reads, short-lived in-flight sharing, virtualized tables, debounced filters and cancelled obsolete requests improve responsiveness.

### Fixed

- Oversized Kubernetes lists fall back to pagination rather than failing at the response limit.
- Secret list metadata is reduced, historical CSV formula cells are escaped, and continuous log output no longer postpones viewer repaint indefinitely.
- Namespace restoration, metrics/source reuse and stale asynchronous result handling preserve cluster ownership.

See [detailed 0.5.2 release notes](docs/releases/0.5.2.md) for requirements, validation and installation limitations.

[0.5.2]: https://github.com/djohn99/el-d90/releases/tag/v0.5.2
