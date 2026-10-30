# Changelog

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
