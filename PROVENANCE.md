# Implementation provenance

el-d90 is an independent Kubernetes desktop application with its own source, interface, branding, icon and native PTY helper. Lens was studied as a reference for desired functionality, including inspection of locally installed source-map material. This was not a formal clean-room process. No recovered reference source, source maps, images or evidence bundles are included in this repository.

Before initial publication, the following checks were performed on 2026-10-29:

- Reviewed first-party source and declared dependencies for Lens/Mirantis imports, bundled code, assets and licensing material. No such dependency or imported implementation was found.
- Compared 710 nontrivial source lines across 28 first-party source files against 24,968 entries in the reference application’s shipped JavaScript/CSS source maps. No exact line matches were found after whitespace normalization, using a minimum of 120 non-whitespace characters per line.
- Compared project PNG/ICNS/image asset hashes against the reference archive’s image assets. No identical assets were found.
- Excluded the entire local research directory, including recovered source observations and live-environment records, from version control.
- Excluded dependency trees, native build outputs, installers, credentials and local profiles from the publication set.

These checks support the source and asset provenance assessment. They do not prove the absence of every possible transformed or short similarity, or determine legal clearance. Standard Electron, terminal and Kubernetes API patterns may naturally resemble other applications using those public interfaces.

The application is not affiliated with, endorsed by or distributed by Lens or Mirantis. Third-party packages are installed from their upstream distributions and keep their own licenses.
