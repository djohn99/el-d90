const version=require('../package.json').version;
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)||process.env.VERSION!==version)throw Error('Release notes version mismatch');
console.log(`Created and maintained by **[David John (@djohn99)](https://github.com/djohn99)**.

## Install on Apple Silicon

1. Download **el-d90-${version}-mac-arm64.dmg** below.
2. Open it and drag **el-d90** into **Applications**.
3. Eject the disk image and open el-d90 from Applications.

Requires **Apple Silicon and macOS 13+**. Install kubectl and configure your own kubeconfig/authentication plugins. Helm is needed for Helm operations; EKS access needs your AWS CLI and sign-in. No credentials are bundled.

This app is **ad-hoc signed**, not Developer ID signed or Apple notarized. macOS may require user security approval.

## Verify the download

Download the matching checksum file beside the DMG, then run:

\`\`\`sh
shasum -a 256 -c el-d90-${version}-mac-arm64.dmg.sha256
\`\`\`

Automated builds include GitHub build provenance identifying the repository and workflow. With GitHub CLI:

\`\`\`sh
gh attestation verify el-d90-${version}-mac-arm64.dmg --repo djohn99/el-d90
\`\`\`

Build provenance verifies the GitHub build origin; it does not provide Apple notarization. Source, license and build history are available in this repository.
`);
