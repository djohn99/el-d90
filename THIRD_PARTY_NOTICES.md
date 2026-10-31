# Third-party notices

Original el-d90 source is covered by the root MIT license. The following direct dependencies retain their upstream licenses; this project does not relicense them.

| Package | Use | Upstream license |
| --- | --- | --- |
| Electron | Desktop runtime | MIT; Chromium and other bundled components have additional notices included in Electron distributions |
| @xterm/xterm | Terminal renderer | MIT |
| @xterm/addon-fit | Terminal sizing | MIT |
| @aws-sdk/client-sso, @aws-sdk/client-sso-oidc | IAM Identity Center account/role discovery and browser authorization | Apache-2.0 |
| @kubernetes/client-node | Kubeconfig authentication, TLS and proxy configuration for persistent Kubernetes reads | Apache-2.0 |
| yaml | YAML parsing | ISC |
| @electron/packager | Build tooling | BSD-2-Clause |
| Playwright | Desktop acceptance tooling | Apache-2.0 |
| dmgbuild | Optional DMG build tooling | MIT |
| Pillow | Optional installer artwork tooling | MIT-CMU |

Consult each installed distribution’s LICENSE/NOTICE files for full terms and transitive notices. Runtime distributions include their upstream notices. kubectl, Helm, AWS CLI and SSH are external tools supplied by the operator; they are not bundled here.

## Monaco Editor

The optional rich editor uses Monaco Editor 0.57.0, published by Microsoft under the MIT license. Its browser runtime and license are prepared from the locked npm development dependency; `assets/monaco/LICENSE` is included in packaged applications. Monaco source is available at https://github.com/microsoft/monaco-editor.
