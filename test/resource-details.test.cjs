const { test } = require('node:test');
const assert = require('node:assert/strict');
const details = require('../src/resource-details.js');
const kube = require('../src/kube.cjs');
const base = kind => ({ kind, apiVersion: 'v1', metadata: { name: 'synthetic', namespace: 'team', uid: 'uid-1', resourceVersion: '9', creationTimestamp: '2026-10-31T10:00:00Z', labels: { app: 'synthetic' }, annotations: { note: 'synthetic only' } } });
const fields = result => Object.fromEntries(result.fields.map(field => [field.label, field.value]));
test('every built-in resource projects identity without fake Node/IP/container fields', () => {
  const kinds = { pods: 'Pod', deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet', jobs: 'Job', cronjobs: 'CronJob', services: 'Service', ingresses: 'Ingress', configmaps: 'ConfigMap', persistentvolumeclaims: 'PersistentVolumeClaim', nodes: 'Node', namespaces: 'Namespace', events: 'Event', replicasets: 'ReplicaSet', replicationcontrollers: 'ReplicationController', horizontalpodautoscalers: 'HorizontalPodAutoscaler', poddisruptionbudgets: 'PodDisruptionBudget', secrets: 'Secret', resourcequotas: 'ResourceQuota', limitranges: 'LimitRange', serviceaccounts: 'ServiceAccount', endpoints: 'Endpoints', endpointslices: 'EndpointSlice', networkpolicies: 'NetworkPolicy', persistentvolumes: 'PersistentVolume', storageclasses: 'StorageClass', roles: 'Role', rolebindings: 'RoleBinding', clusterroles: 'ClusterRole', clusterrolebindings: 'ClusterRoleBinding', customresourcedefinitions: 'CustomResourceDefinition' };
  assert.deepEqual(Object.keys(kinds).sort(), Object.keys(kube.RESOURCES).sort());
  for (const [resource, kind] of Object.entries(kinds)) {
    const object = base(kind), result = details.model(object, resource), row = fields(result);
    assert.equal(row.Name, 'synthetic', resource); assert.equal(row.UID, 'uid-1', resource);
    assert.ok(result.fields.every(field => typeof field.value === 'string' && field.value !== '—'), resource);
    assert.equal('Node' in row, false, resource); assert.equal('IP' in row, false, resource); assert.deepEqual(result.containers, [], resource);
  }
});
test('ConfigMap detail exposes key metadata but never copies data into general fields', () => {
  const object = { ...base('ConfigMap'), immutable: true, data: { 'app.yaml': 'NOT-GENERAL-DETAIL-CONTENT', blank: '' }, binaryData: { blob: 'AQID' } };
  const row = fields(details.model(object, 'configmaps'));
  assert.equal(row['Data keys'], 'app.yaml, blank'); assert.equal(row['Binary data keys'], 'blob'); assert.equal(row.Immutable, 'true');
  assert.ok(!JSON.stringify(row).includes('NOT-GENERAL-DETAIL-CONTENT'));
  assert.ok(!JSON.stringify(row).includes('AQID'));
});
test('Secret projection uses only identity/type/key metadata, excluding annotations and values', () => {
  const object = { ...base('Secret'), type: 'Opaque', immutable: false, dataKeys: ['password'], data: { password: 'NEVER-COPY' }, stringData: { password: 'NEVER-COPY' } };
  Object.defineProperty(object.metadata, 'annotations', { get() { throw Error('Secret annotations must never be read'); } });
  const result = details.model(object, 'secrets'); assert.equal(fields(result).Keys, 'password'); assert.equal(fields(result).Type, 'Opaque');
  assert.deepEqual(result.annotations, []); assert.deepEqual(result.labels, []); assert.deepEqual(result.containers, []); assert.ok(!JSON.stringify(result).includes('NEVER-COPY'));
  const direct = details.model({ ...base('Secret'), data: { first: 'NEVER-COPY', second: 'NEVER-COPY' } }, 'secrets'); assert.equal(fields(direct).Keys, 'first, second'); assert.ok(!JSON.stringify(direct).includes('NEVER-COPY'));
});
test('Pods include actual container/init/ephemeral status and resource requests/limits', () => {
  const object = { ...base('Pod'), spec: { nodeName: 'worker-a', serviceAccountName: 'runner', restartPolicy: 'Always', containers: [{ name: 'api', image: 'example/api:1', resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } }, ports: [{ name: 'http', containerPort: 8080 }], readinessProbe: { httpGet: { path: '/ready' } }, env: [{ name: 'PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } }] }], initContainers: [{ name: 'migrate', image: 'example/migrate:1' }], ephemeralContainers: [{ name: 'debug', image: 'example/debug:1' }], volumes: [{ name: 'settings', configMap: { name: 'app-settings' } }, { name: 'storage', persistentVolumeClaim: { claimName: 'app-data' } }] }, status: { phase: 'Running', podIP: '10.0.0.5', hostIP: '10.0.0.1', qosClass: 'Burstable', containerStatuses: [{ name: 'api', ready: false, restartCount: 3, state: { waiting: { reason: 'CrashLoopBackOff' } } }], initContainerStatuses: [{ name: 'migrate', ready: true, restartCount: 0, state: { terminated: { exitCode: 0 } } }] } };
  const result = details.model(object, 'pods'), row = fields(result);
  assert.equal(row.Node, 'worker-a'); assert.equal(row['Pod IP'], '10.0.0.5'); assert.equal(row['QoS class'], 'Burstable');
  assert.deepEqual(result.containers.map(c => c.type), ['Container', 'Init container', 'Ephemeral container']);
  const api = fields(result.containers[0]); assert.equal(api.Requests, 'cpu=100m, memory=128Mi'); assert.equal(api.Limits, 'cpu=1, memory=512Mi'); assert.equal(api.Restarts, '3'); assert.equal(api.Ready, 'No'); assert.equal(api.Reason, 'CrashLoopBackOff'); assert.equal(api['readiness probe'], 'httpGet');
  assert.equal(fields(result.containers[1])['Exit code'], '0'); assert.ok(!('Ready' in fields(result.containers[2])));
  assert.ok(result.references.some(r => r.kind === 'Node' && r.name === 'worker-a' && !r.namespace));
  assert.ok(result.references.some(r => r.kind === 'ConfigMap' && r.name === 'app-settings' && r.namespace === 'team'));
  assert.ok(result.references.some(r => r.kind === 'Secret' && r.name === 'db' && r.namespace === 'team'));
  assert.ok(result.references.some(r => r.kind === 'PersistentVolumeClaim' && r.name === 'app-data'));
});
test('workload templates and CronJob nested templates use their own containers without fabricated Pod status', () => {
  for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'ReplicationController', 'Job', 'CronJob']) {
    const pod = { containers: [{ name: 'app', image: 'example/app:1' }] }, spec = kind === 'CronJob' ? { jobTemplate: { spec: { template: { spec: pod } } } } : { template: { spec: pod } };
    const result = details.model({ ...base(kind), spec }, kind.toLowerCase() + 's');
    assert.equal(result.containers[0].image, 'example/app:1', kind); assert.ok(!('Ready' in fields(result.containers[0])), kind);
  }
});
test('Node details include genuine system information/capacity and cluster-scoped owner references', () => {
  const object = { ...base('Node'), metadata: { ...base('Node').metadata, namespace: undefined, labels: { 'node-role.kubernetes.io/worker': '' } }, spec: { unschedulable: true, providerID: 'aws:///zone/synthetic', taints: [{ key: 'maintenance', effect: 'NoSchedule' }] }, status: { capacity: { cpu: '4', memory: '16Gi', pods: '110' }, allocatable: { cpu: '3900m', memory: '15Gi' }, addresses: [{ type: 'InternalIP', address: '10.0.0.1' }], nodeInfo: { architecture: 'arm64', operatingSystem: 'linux', kubeletVersion: 'v1.36.0', containerRuntimeVersion: 'containerd://2.0' }, conditions: [{ type: 'Ready', status: 'True' }] } };
  const row = fields(details.model(object, 'nodes'));
  assert.equal(row.Schedulable, 'No'); assert.equal(row.Roles, 'worker'); assert.equal(row.Architecture, 'arm64'); assert.equal(row.InternalIP, '10.0.0.1'); assert.match(row.Capacity, /pods=110/); assert.match(row.Allocatable, /cpu=3900m/); assert.equal(row.Conditions, 'Ready=True');
});
test('HPA and VPA details retain target namespace and actual metrics/recommendations', () => {
  const target = { kind: 'Deployment', name: 'api', apiVersion: 'apps/v1' };
  const hpa = details.model({ ...base('HorizontalPodAutoscaler'), spec: { minReplicas: 2, maxReplicas: 8, scaleTargetRef: target }, status: { currentReplicas: 2, desiredReplicas: 3, currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 81 } } }] } }, 'horizontalpodautoscalers');
  assert.equal(fields(hpa)['Current metrics'], 'cpu: 81%'); assert.equal(fields(hpa)['Desired Replicas'], '3'); assert.deepEqual(hpa.references[0], { ...target, namespace: 'team' });
  const vpa = details.model({ ...base('VerticalPodAutoscaler'), spec: { targetRef: target, updatePolicy: { updateMode: 'Off' } }, status: { recommendation: { containerRecommendations: [{ containerName: 'app', target: { cpu: '200m' } }] } } }, 'verticalpodautoscalers.autoscaling.k8s.io');
  assert.equal(fields(vpa)['Update Mode'], 'Off'); assert.match(fields(vpa).Recommendations, /app: cpu=200m/); assert.equal(vpa.references[0].namespace, 'team');
});
test('storage and RBAC reference identities preserve declared UID/scope without fabricated remote identifiers', () => {
  const pv = details.model({ ...base('PersistentVolume'), spec: { claimRef: { kind: 'PersistentVolumeClaim', name: 'data', namespace: 'other', uid: 'claim-uid', apiVersion: 'v1' }, storageClassName: 'fast' } }, 'persistentvolumes');
  assert.deepEqual(pv.references[0], { kind: 'PersistentVolumeClaim', name: 'data', namespace: 'other', uid: 'claim-uid', apiVersion: 'v1' }); assert.ok(!pv.references[1].namespace);
  const binding = details.model({ ...base('RoleBinding'), roleRef: { kind: 'ClusterRole', name: 'reader', apiGroup: 'rbac.authorization.k8s.io' }, subjects: [{ kind: 'User', name: 'user' }, { kind: 'ServiceAccount', name: 'runner', namespace: 'jobs' }] }, 'rolebindings');
  assert.equal(binding.references[0].kind, 'ClusterRole'); assert.equal(binding.references[0].namespace, undefined); assert.equal(binding.references[0].uid, undefined); assert.equal(binding.references[1].namespace, 'jobs');
});
test('ConfigMap/non-Pod kinds never acquire fake containers from arbitrary spec.containers', () => {
  const result = details.model({ ...base('Widget'), apiVersion: 'example.test/v1', spec: { containers: [{ name: 'not-a-pod-template', image: 'ignore' }], password: 'DO-NOT-DUMP-SPEC' }, status: { phase: 'Ready', conditions: [{ type: 'Ready', status: 'True' }] } }, 'widgets.example.test');
  assert.equal(fields(result).Phase, 'Ready'); assert.equal(fields(result).Conditions, 'Ready=True'); assert.deepEqual(result.containers, []); assert.ok(!JSON.stringify(result).includes('DO-NOT-DUMP-SPEC'));
});
test('qualified built-in resources infer the same useful profile from their kind', () => {
  const result = details.model({ ...base('Deployment'), spec: { replicas: 3, strategy: { type: 'RollingUpdate' } }, status: { readyReplicas: 2 } }, 'deployments.apps');
  assert.equal(fields(result).Desired, '3'); assert.equal(fields(result).Ready, '2'); assert.equal(fields(result).Strategy, 'RollingUpdate');
});
test('resource models do not mutate their source or coerce nested objects into opaque strings', () => {
  const object = { ...base('Service'), spec: { type: 'ClusterIP', clusterIP: '10.96.0.1', ports: [{ port: 80, protocol: 'TCP' }], selector: { app: 'api' } } }, original = structuredClone(object);
  const result = details.model(object, 'services'); assert.equal(fields(result).Type, 'ClusterIP'); assert.equal(fields(result).Selector, 'app=api'); assert.deepEqual(object, original); assert.ok(!JSON.stringify(result).includes('[object Object]'));
});
