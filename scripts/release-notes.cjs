const version=require('../package.json').version;
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)||process.env.VERSION!==version)throw Error('Release notes version mismatch');
console.log(`Created and maintained by **[David John (@djohn99)](https://github.com/djohn99)**.

## Install on Apple Silicon

1. Download **el-d90-${version}-mac-arm64.dmg** below.
2. Open it and drag **el-d90** into **Applications**.
3. Eject the disk image and open el-d90 from Applications.

Requires **Apple Silicon and macOS 13+**. Install kubectl and configure your own kubeconfig/authentication plugins. Helm is needed for Helm operations; EKS access needs your AWS CLI and sign-in. No credentials are bundled.

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
