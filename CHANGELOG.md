# Changelog

## [0.5.35] - 2026-11-26

- EL-D90 opens at the available size of the display under the pointer. Move the window between a laptop and an external monitor and it fits the destination work area.

## [0.5.34] - 2026-11-26

- In an open log tab, choose 300, 1,000, 5,000, or 10,000 lines per container. The same tab reloads the history and resumes streaming with your filters in place.

## [0.5.32] - 2026-11-24

- Save a named view directly from the Pods table. Reopening it restores the selected namespaces, filters, sort column and direction.
- Each resource table remembers its sort while you switch between views in the same cluster.

## [0.5.31] - 2026-11-24

- Sorting Pods by Status keeps the newest pods first within each group across namespaces and pages. Refresh places new and changed pods in the correct group and keeps tied rows in a consistent order.

## [0.5.30] - 2026-11-24

- Pods now sort by creation time across namespaces and pages. Refresh keeps newly discovered pods in chronological order when Age is selected.

## [0.5.29] - 2026-11-20

- Use macOS-trusted company and public CA certificates automatically for AWS CLI, EKS credentials, and AWS SSO, with explicit CA bundle overrides still supported.
- Prevent kubeconfig folder refreshes from cancelling newly started EKS credential providers. Show safe credential diagnostics without exposing tokens.
- Connect to multiple namespaces entered with commas or spaces. Check access to each namespace and open the workspace with all selected; existing single-namespace connections remain supported.
- Keep AWS dropdowns attached while scrolling and close other floating menus only when their controls move. Show namespace guidance beneath the field in the accent color.
- Request 10,000 initial log lines, browse retained history in smaller pages, and download filtered logs with icon-only buttons.

## [0.5.28] - 2026-11-19

- Choose an EKS region from a searchable list of region codes and locations, while retaining profile defaults and manual region entry.

## [0.5.27] - 2026-11-19

- Use only contexts from the kubeconfig files or folders selected with **Use these files**, and open the context picker immediately after loading.
- Restore the previous kubeconfig sources with Refresh when the selected source has no contexts, including an accidentally selected empty folder.

## [0.5.26] - 2026-11-19

- Link a kubeconfig file or folder by entering its path or using the file and folder pickers. Linked sources load immediately.
- Automatically refresh saved contexts when linked files change or kubeconfigs are added to or removed from a linked folder. Folders scan files directly inside them.

## [0.5.25] - 2026-11-18

- Use the disconnected welcome screen to pick a saved cluster context, import an existing kubeconfig, or open the AWS SSO connection flow.
- Show whether saved contexts were found and make kubeconfig import the primary action when none are available.

## [0.5.24] - 2026-11-17

- Open actions from the three-dot menu or by right-clicking a row across Kubernetes resource lists and Helm releases. Menus offer operations appropriate to each resource.
- Trigger a one-off Job from a Cron Job and suspend or resume Jobs from their row menus.
- Read Cron Job schedules in plain language in the table and resource details. The original cron expression remains available in the tooltip, details, and CSV export.

## [0.5.23] - 2026-11-17

- Keep the workspace, sidebar, and panels in the selected color family while preserving clear text, controls, and table headers.
- Keep ready, waiting, and error container colors consistent across themes.
- Compact paginated table controls, place the column menu at the far right, and move Pod metrics explanations into the CPU and memory column tooltips.

## [0.5.22] - 2026-11-16

- Let paginated resource tables use the available workspace height, with scrolling inside the table.

## [0.5.20] - 2026-11-16

- Make AWS account and role dropdowns easier to identify. Highlight sign-in status and the current EKS setup step.
- Align cluster controls and namespace options. Make connection settings actions easier to distinguish.
- Collapse Kubernetes discovery errors to a one-line summary with expandable diagnostics.
- Fit wrapped sidebar labels and align the terminal dock with the sidebar divider.
- Add Medium text size. Close Settings after applying changes and show a confirmation.
- Refresh Workloads Overview and resource tables quietly every 15 seconds, preserving the current row order, sort, page and scroll position.

## [0.5.18] - 2026-11-15

- Fit resource tables to the window without horizontal scrolling, including paginated lists.
- Make Nodes rows more compact with CPU, memory, and disk capacity bars.
- Save relative column widths so resized columns continue to fit when the window changes size. (#17)

## [0.5.17] - 2026-11-12

- Request compressed Kubernetes API responses to reduce transfer size for large lists.
- Remove redundant JSON serialization during pagination and retain decoded response limits.

## [0.5.16] - 2026-11-12

- Package the AWS account picker improvements for both platforms through GitHub Actions.

## [0.5.15] - 2026-11-12

- Show readable AWS account labels and badges for recognized environments. Keep original AWS names and account IDs searchable.
- Add search icons to the AWS account, role and namespace fields.

## [0.5.14] - 2026-11-12

- Start cluster setup with a choice between AWS SSO and kubeconfig import. Keep saved AWS profiles and diagnostics available in collapsible sections. (#15)
- Guide AWS SSO users through sign-in, account, role and cluster selection with clear progress and recovery feedback. (#14)
- Open account, role and namespace pickers over the form, with search and keyboard navigation. (#13)

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
