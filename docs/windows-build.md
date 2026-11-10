# Windows x64 build

Download the [Windows x64 ZIP](https://github.com/djohn99/el-d90/releases/download/v0.5.12/el-d90-0.5.12-windows-x64.zip) from the [0.5.12 release](https://github.com/djohn99/el-d90/releases/tag/v0.5.12). No GitHub sign-in is required. Extract the entire ZIP before opening `el-d90.exe`.

Requires Windows 10 1809+ or Windows 11 on Intel/AMD x64. Install kubectl.exe, AWS CLI v2 and Helm as needed on PATH. Restart the app after changing PATH. The app is not Authenticode signed; managed PCs may require administrator approval.

Compare `Get-FileHash .\el-d90-0.5.12-windows-x64.zip -Algorithm SHA256` with the matching `.sha256` file.

## Native validation

The tests load the actual packaged native module inside Electron. They exercise Command Prompt and PowerShell repeated keyboard input, terminal resizing, Unicode output, clean exit, real kubectl.exe discovery, a private metadata-only cluster-context overlay and cleanup, and packaged Monaco YAML editing with no page errors. Fixtures do not establish live AWS, Kubernetes exec/log streaming, SSH or Helm mutation acceptance on another PC.

The Windows terminal path uses Microsoft’s maintained MIT-licensed node-pty 1.1.0, including its bundled ConPTY DLL and worker files outside ASAR. macOS retains the existing native helper. Both resource terminals and saved sessions share the same platform transport and resize API.

To validate Windows alone, dispatch the release workflow from the intended branch with `test_windows=true`. This builds and tests a candidate and retains its ZIP/checksum; it does not publish a release. A regular version tag builds both macOS and Windows and publishes both installers only after all native checks pass.
