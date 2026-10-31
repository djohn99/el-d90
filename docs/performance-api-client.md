# Persistent Kubernetes API read transport

Measured on 2026-10-31 against the existing cluster, using read-only namespace lists with 23 results. Each role/transport performed three sequential requests. The first API request includes credential-provider startup and the initial connection. These are observations from this Mac and network, not a guarantee for other clusters or a comparison with Lens/Headlamp.

| Role | Transport | First request | Subsequent requests |
| --- | --- | --- | --- |
| AdministratorAccess | api | 1059 ms | 206 ms, 150 ms |
| AdministratorAccess | cli | 919 ms | 860 ms, 880 ms |
| EditOnlyAccess | api | 990 ms | 150 ms, 149 ms |
| EditOnlyAccess | cli | 867 ms | 854 ms, 912 ms |

Both roles connected a Pod watch in the staging namespace, passed the readiness check, and listed 14 staging Helm releases. AdministratorAccess saw 16 Ready nodes and 16 node metric samples. EditOnlyAccess received the expected node Forbidden result and unavailable-node-metrics warning. No role permissions or cluster resources were changed.

Resource lists use paginated HTTP GETs. Raw API/metrics GETs and resource Events use the same authenticated connection pools. Watches resume from resourceVersion, relist after 410, pause on authorization failure, and send only invalidation metadata to the renderer. Resource objects are not cached across refreshes or identities. Context-local exec credentials are cached until refresh; plugin execution is bounded and cancelled on disconnect. Existing kubeconfig CA, TLS server name, client-certificate, proxy-url and impersonation settings are retained. Mutations, interactive terminals, logs, port forwarding and Helm retain their CLI paths.

Validation includes local HTTP/TLS tests for keep-alive reuse, credential isolation, plaintext readiness, Secret redaction, namespace scopes, cancellation, expired authentication, redirect refusal, exec refresh/timeout/output limits, watch recovery and authorization failures. A packaged desktop fixture forces API mode and verifies that lists, metrics and watches produce no kubectl get requests. Existing desktop regression suites cover terminal, log and Helm behavior. An explicit `EL_D90_KUBE_TRANSPORT=cli` diagnostic override remains available; no automatic identity or CLI fallback occurs after a permission failure.
