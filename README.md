# el-d90

Created and maintained by **[David John (@djohn99)](https://github.com/djohn99)**.

An independent, local Kubernetes desktop workspace for macOS. Open multiple cluster workspaces, select several namespaces, inspect resources, and work with YAML, logs and terminals in context.

## Download and install

**[⬇ Download the latest release for Apple Silicon](https://github.com/djohn99/el-d90/releases/latest)**

[Direct DMG download for 0.5.1](https://github.com/djohn99/el-d90/releases/download/v0.5.1/el-d90-0.5.1-mac-arm64.dmg)

Requires **macOS 13 or later** on an **Apple Silicon Mac**. [Release notes](https://github.com/djohn99/el-d90/releases/tag/v0.5.1) · [All releases](https://github.com/djohn99/el-d90/releases)

1. Download the DMG using the link above.
2. Open the DMG and drag **el-d90** onto the **Applications** shortcut.
3. Eject the disk image, then open **el-d90** from your Applications folder.
4. Install `kubectl` and configure your own kubeconfig and authentication plugins, then select your cluster context in the app. EKS users need a compatible AWS CLI and their own AWS sign-in. Install Helm if you want to manage Helm releases.

Credentials and local profiles are not included in the download.

### If macOS says “el-d90” Not Opened

Until Apple Developer ID signing and notarization are available, macOS may say it could not verify that el-d90 is free of malware. This build is **ad-hoc signed**, not Developer ID signed or Apple notarized.

Only use this exception if you downloaded el-d90 from [this repository’s official releases](https://github.com/djohn99/el-d90/releases) and trust the download. You can verify the DMG with the checksum instructions below.

1. In the warning, click **Done** rather than **Move to Trash**.
2. Open **Apple menu → System Settings → Privacy & Security**.
3. Scroll to **Security** and find the message that el-d90 was blocked.
4. Click **Open Anyway**, authenticate with your Mac password or Touch ID if prompted, then confirm **Open**.
5. You should then be able to launch el-d90 normally from **Applications**.

If the blocked-app message is missing, try opening el-d90 from Applications again, then return to Privacy & Security. Managed Macs may require your administrator’s approval.

This grants an exception for el-d90; you do not need to disable Gatekeeper or other system protections. See [Apple’s instructions for opening a blocked app](https://support.apple.com/guide/mac-help/mh40617/mac).

To verify the download, save the [SHA-256 checksum file](https://github.com/djohn99/el-d90/releases/download/v0.5.1/el-d90-0.5.1-mac-arm64.dmg.sha256) beside the DMG and run this command in that directory:

```sh
shasum -a 256 -c el-d90-0.5.1-mac-arm64.dmg.sha256
```

## Screenshots

Cluster overview with workload health and recent activity:

![el-d90 cluster overview showing workload health, namespaces and recent Events](docs/images/overview.png)

Deployment inspection with combined replica logs:

![el-d90 Deployment detail drawer with combined replica logs](docs/images/deployment-logs.png)

*Captured from el-d90 0.5.1 in disconnected demo mode using sample data. No real cluster details or credentials are shown.*

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

The backend suite has 111 checks. Seven desktop suites use isolated profiles and offline CLI fixtures. They cover resources/YAML, concurrent workspaces, Helm/history, node access/resource creation, Events, scaling and independent sessions. The session suite also checks drag/keyboard resizing, panel dismissal and selected-session closure.

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

## Author and official builds

**David John ([@djohn99](https://github.com/djohn99))** created and maintains el-d90. The repository is owned by `djohn99`, original source carries David John’s MIT copyright, and future packaged builds show the author credit in **el-d90 → About**.

Download official builds from [this repository’s Releases](https://github.com/djohn99/el-d90/releases). Releases produced by the automated workflow include GitHub build-provenance attestations linking the DMG to this repository, its commit and its workflow. Verify a downloaded automated build with `gh attestation verify <downloaded-file.dmg> --repo djohn99/el-d90`. The manually published 0.5.1 release predates this workflow and has no attestation. An attestation establishes build origin; it is separate from Apple Developer ID signing and notarization.

## Automated releases

Pushing a `v*` version tag triggers [Apple Silicon DMG release](.github/workflows/release.yml). The tag must exactly match `package.json`, for example `v0.5.2` for version `0.5.2`. The workflow validates the runner/version, installs locked dependencies, runs backend and packaged desktop checks, ad-hoc signs the app, builds and verifies the drag-to-install DMG, records provenance, and publishes the DMG and SHA-256 checksum. Prerelease versions are marked as prereleases. Existing published release assets are never replaced by reruns.

After committing your next changes:

```sh
npm version patch
# npm updates package.json/package-lock.json and creates the matching commit and tag.
git push origin main --follow-tags
```

The workflow uses GitHub’s temporary `GITHUB_TOKEN`; no personal access token or Apple certificate secret is required for ad-hoc builds. `contents: write` is limited to the publishing job; the build job has provenance permissions. The separate **Run workflow** button builds, tests and retains a downloadable Actions artifact without publishing a release or creating a new version tag. It can be used to validate changes to the pipeline.
