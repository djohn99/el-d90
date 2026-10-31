# Declarative extension SDK v1

el-d90 extensions are **JSON manifests**, not executable JavaScript. They can add resource pages, detail sections, table columns and map relations. Headlamp or Lens plugins cannot be loaded. Extensions cannot define commands, IPC channels, network requests, HTML, scripts or mutations. Kubernetes reads still use the selected context, namespaces, API discovery and current identity.

Open **Extensions → Install/update manifest…**, choose a reviewed JSON file, inspect its contribution summary in the native confirmation, then install it. Install the bundled **Workload ownership** example to try all four surfaces. Enabled state is local and persistent. Disable or remove an extension from the same page. To update it, import a manifest with the same `id` and a different semantic `version`; the existing enabled state is retained. A changed manifest cannot replace the same version silently.

The complete example is [workload-ownership.extension.json](examples/workload-ownership.extension.json).

```json
{
  "schemaVersion": 1,
  "id": "example.pod-status",
  "name": "Pod status",
  "version": "1.0.0",
  "description": "A small status page",
  "contributions": {
    "pages": [{
      "id": "pod-status",
      "title": "Pod status",
      "resource": "pods",
      "fields": [
        {"id":"pod-name", "title":"Pod", "path":"metadata.name"},
        {"id":"phase", "title":"Phase", "path":"status.phase"}
      ]
    }]
  }
}
```

## Contribution fields

Every contribution has an `id` unique within its surface and a `title`. Resource names are Kubernetes plural resource keys, including API group suffixes for custom resources (for example `certificates.cert-manager.io`). The resource must be discoverable/listable in the selected context.

- `pages`: `resource` and `fields` (1–20). Each field has `id`, `title`, `path`.
- `details`: the same shape; fields appear when inspecting that resource type.
- `columns`: `resource` and `path`; the host table provides the column picker.
- `relations`: `fromResource`, `toResource`, `fromPath`, `toPath`. Scalar values are compared exactly within the **same cluster and namespace**. Relations are labelled inferred matches, not ownership or traffic proof. To represent an owner reference, match its UID, not its name.

Paths can be dot-delimited strings or arrays of literal key segments. Array paths are required for keys containing dots, such as `["metadata","labels","app.kubernetes.io/name"]`. `*` traverses bounded array members, for example `["metadata","ownerReferences","*","uid"]`. Supported metadata starts with name, namespace, UID, creationTimestamp, labels, ownerReferences or generation. Status fields are also supported. Prototype keys, sensitive key names, annotations and managed fields are rejected. Secret and authorization-review resources are not available to extensions. Output values are bounded and common credential formats are redacted, but authors should still avoid projecting confidential values from arbitrary custom-resource status fields.

Manifests are bounded to 128 KiB, 32 installed extensions, 20 contributions of each kind and 20 fields per page/detail. Pages return at most 1,000 resources. Map relations are bounded to 500 edges over at most 1,500 supplied graph records. Installations live in the local app profile; no credentials are stored in the manifest or bundled with the app.
