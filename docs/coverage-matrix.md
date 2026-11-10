# el-d90 current coverage and release-readiness matrix

Reviewed 2026-11-10 for the 0.5.12 candidate, including the Windows build fix. This is an implementation/acceptance inventory, not a claim of complete parity with current Lens or Freelens. The original 0.5.0 comparison remains in the local research archive, which is excluded from distribution.

## Covered in automated desktop acceptance

| Area | Current implementation | Practical qualification |
| --- | --- | --- |
| AWS connection | Browser-owned SSO, account/role discovery, explicit profiles/regions, private EKS kubeconfigs, automatic searchable namespace choices, visible automatic/manual connection settings with refresh and per-field source labels | Namespace candidates are verified with this identity's Pod access. Kubernetes cannot enumerate unknown namespace names when namespace listing is denied. Manual known-name checks remain available. No role permissions are changed. |
| Workspaces | Concurrent context-owned views, namespaces, terminal/log sessions, preferences and drafts | Connect clusters is opened deliberately from File rather than restored as a normal workspace page. Independent real-cluster and long-running expiry/soak validation still matters. |
| Navigation and tables | Collapsible resource groups, custom API groups, per-resource columns, saved resize widths, sorting, pagination and full-loaded-list search/export | Server data is paginated into a bounded client snapshot; UI pages do not mean constant-memory server-only pagination. |
| ConfigMaps and Secrets | Specialized data cards, direct ConfigMap Save/Save & Close, optional YAML review, decoded Secret controls, immutable/permission handling | Data and YAML draft protection is local memory only. ConfigMap save automatically validates and uses the existing apply confirmation. |
| CRUD and actions | Arbitrary YAML, dry-run/apply, exact resource scope, scale/restart, scheduling/CronJob actions | Resource deletion uses the native confirmation without typed-name input, including Deployments and higher-risk resources. Node drain retains typed confirmation. Broad live mutation coverage is not established by fixture success. |
| Logs and terminals | Pod/Deployment replica logs, filtering, local search, independent terminal/log sessions, resizing and close controls; resource Terminal tabs connect automatically and reuse active sessions | No equivalent full arbitrary-controller/application log aggregation or durable session/archive service is claimed. |
| Metrics | Current workload/node usage, cluster capacity, CPU/memory history for Pods/controllers/Jobs/CronJobs/nodes, time ranges and chart export | Historical coverage depends on Prometheus/exporter/ownership series and retention. No bundled monitoring installer or universal provider coverage. |
| YAML | Local rich editor, comparison/reset, schema assistance, forms, floating find and terminal/log find routing | Resource-document tabs/multiple simultaneous detail panes are not a complete IDE document workspace. |
| Network, storage and access | Dedicated resources/details, relations, localhost Pod/Service port forwards, permission checks | Forwards require explicit ports; automatic allocation, reconnect and restoration after app restart are absent. |
| Helm | Chart/version/values workflow, install/upgrade/rollback/uninstall, history and confirmations | Real mutation and recovery acceptance remains separate from offline tests; external CLI and cluster permissions apply. |
| Map, Projects and GitOps | Bounded topology map, multi-context Projects, read-only Argo/Flux information | Declared relationships do not prove live traffic. GitOps reconcile/sync mutations are not implemented. |
| Extensions | Declarative reviewed manifests, resource pages/details/columns/relations | Arbitrary third-party executable plugin compatibility is intentionally not provided. |
| Node access | Kubernetes shell/debug and advanced SSH workflow | Live privileged debug was declined; successful real SSH/debug sessions are not certified by offline fixtures. |
| Packaging | Apple Silicon DMG and Windows x64 portable ZIP; tagged GitHub Actions releases with checksums and build provenance | Developer ID signing/notarization and Windows Authenticode signing are unavailable. Manual installation/update and platform approval may remain necessary. |
| AI | Disabled by the user's decision | Remains deferred. |

## Before the next release

1. Completed for 0.5.10: rebuilt the rich-editor browser assets with DOMPurify 3.4.17 and resolved the dependency advisory entries. Keep the audit and asset-provenance tests in CI.
2. The final 251 backend checks and 28 packaged desktop suites passed; preserve the distinction between automated fixture results and live acceptance.
3. Verify the new AWS namespace and ConfigMap workflows on the other Mac, including its company proxy/CA environment.
4. Publish a new version only after release authorization. The release workflow publishes the Apple Silicon DMG and Windows x64 ZIP only after both native build jobs pass.

See [the dated review](qa-review-2026-11-09.md) for test results, confirmed fixes and dependency findings.
