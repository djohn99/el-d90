# el-d90

An independent, local Kubernetes desktop workspace for macOS. Open multiple cluster workspaces, select several namespaces, inspect resources, and work with YAML, logs and terminals in context.

## Features

- Concurrent cluster tabs with independent namespace sets, views and connection state.
- Workloads, networking, storage, RBAC, Events and dynamically discovered APIs/custom resources.
- Resource creation/import, YAML editing, local validation, server dry-run and confirmed apply.
- Deployment logs aggregated across replicas, Pod logs and interactive Pod shells.
- General local cluster terminals with multiple terminal/log sessions per cluster. Drag the panel’s top edge to resize; close individual sessions or dismiss the panel.
- Prometheus historical charts through the Kubernetes Service proxy.
- Helm repositories, chart search, version-pinned install/upgrade previews, rollback and uninstall.
- Port forwarding, scaling, rollout restart and resource management.
- Declared application topology, editor helpers and opt-in Kubernetes watches.
- Node SSH using existing configuration, and separately confirmed privileged Kubernetes debug sessions.

Features remain subject to the selected cluster’s APIs, RBAC, admission and installed tools. This is an independent project, not affiliated with Lens or Mirantis, and does not claim complete feature parity. AI integration is not enabled.

## Requirements

The current packaged application targets Apple Silicon Macs running macOS 13 or later.

- Install `kubectl` and configure your own kubeconfig and authentication plugins.
- EKS access requires a compatible AWS CLI and your own AWS authentication.
- Install Helm for Helm operations.
- Historical charts require an existing Prometheus service with the appropriate exporters and retention. The app does not install monitoring components.

Credentials and local profiles are not included in source or installers. Each CLI retains its normal authentication and authorization behavior.

## Run from source

Development requires Node.js/npm and macOS Command Line Tools (`clang`).

```sh
npm ci
npm start
```

Use `npm run demo` for disconnected sample data. `EL_D90_KUBECTL` and `EL_D90_HELM` can select absolute executable paths. `EL_D90_USER_DATA` selects an isolated application profile for development.

## Usage

Choose a kubeconfig context to open a cluster workspace. Open another context for another cluster tab. In **Namespaces**, check multiple namespaces and apply their union. Single-resource actions keep the selected object’s exact namespace.

Use **Terminal & logs** to open the session panel. Start local terminals or exact Pod/Deployment log sessions. Drag the top edge up or down; the focused handle also supports arrow keys. **Close session** or a tab’s × stops that session. The panel’s top-right × hides the panel while sessions continue. Disconnecting a cluster or quitting ends its owned processes.

Local terminals start with a private, metadata-only kubeconfig overlay referencing existing configuration. Application initialization leaves existing kubeconfig files and the global current context unchanged. A local shell retains your account permissions; commands you explicitly enter can change files or cluster resources. With several namespaces selected, a terminal starts in the context’s default namespace rather than implicitly issuing commands across all selected namespaces.

Use **Create resource** for arbitrary YAML/JSON, multiple documents and installed custom resources. Complete required fields, validate, then apply. Mutations require native confirmation. Node debug additionally requires explicit consent to create a privileged Pod with host access; the app tracks its identity for cleanup.

Session output and YAML drafts stay in memory. Workspace preferences retain context names, namespace sets, views and historical source settings. A legacy `Harbor` profile directory is retained for compatibility with early development builds.

## Tests

```sh
npm test
npm run test:desktop-all
```

The backend suite has 108 checks. Seven desktop suites use isolated profiles and offline CLI fixtures. They cover resources/YAML, concurrent workspaces, Helm/history, node access/resource creation, Events, scaling and independent sessions. The session suite also checks drag/keyboard resizing, panel dismissal and selected-session closure.

To test an existing package, set `EL_D90_APP_EXECUTABLE` to its executable path. Automated tests do not require real cluster credentials. Live node SSH, privileged debug and Helm mutations are not established by fixture tests.

## Package for macOS

```sh
npm run package
```

The build compiles the original PTY helper and creates `dist/el-d90-darwin-arm64/el-d90.app`. Apply your chosen signing process before distribution. No Developer ID identity or notarization credentials are included.

The DMG builder creates a Finder window with the app, an arrow and an Applications shortcut:

```sh
python3 -m venv /tmp/el-d90-dmg-tools
/tmp/el-d90-dmg-tools/bin/pip install -r scripts/requirements-dmg.txt
/tmp/el-d90-dmg-tools/bin/python scripts/build-dmg.py \
  --app dist/el-d90-darwin-arm64/el-d90.app
```

The current local release uses an ad-hoc integrity signature, not a Developer ID signature or Apple notarization. macOS may require user security approval. No protections are disabled by the installer.

## Security and provenance

A source review identified and remediated a low-severity historical CSV formula issue. Historical and table exports share formula-prefix neutralization while preserving finite numeric samples. Secret list responses expose only identity metadata, type and key names; full Secret YAML requires confirmation. These controls are not a universal guarantee that Helm manifests, release values, logs or operator-entered content contain no sensitive data.

A dependency advisory check on 2026-10-29 returned no published npm advisories. This is a point-in-time result, not a guarantee against unknown vulnerabilities. Report security concerns through the repository’s private security reporting channel when available; do not publish credentials or cluster details.

See [PROVENANCE.md](PROVENANCE.md) for the bounded source/asset comparison and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency licenses. Local reverse-engineering evidence, live environment records, dependencies, compiled helpers and release outputs are excluded from Git.

## License

Original project source and visual identity are MIT licensed. Dependencies retain their own licenses.
