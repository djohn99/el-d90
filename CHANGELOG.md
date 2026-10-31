# Changelog

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
