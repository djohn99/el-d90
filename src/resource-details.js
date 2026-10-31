// Original resource-specific detail projection. This module performs no I/O.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./resource-columns.js') : root.elD90Columns);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.elD90ResourceDetails = api;
})(typeof window !== 'undefined' ? window : globalThis, function (columns) {
  const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
  const dictionary = value => Object.entries(value || {}).filter(([, v]) => scalar(v) !== '').map(([key, value]) => key + '=' + scalar(value)).join(', ');
  const list = values => (values || []).map(scalar).filter(Boolean).join(', ');
  const keys = object => object && typeof object === 'object' ? Object.keys(object) : [];
  const workloadKinds = new Set(['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'ReplicationController', 'Job', 'CronJob']);
  const kindResources = { Pod: 'pods', Node: 'nodes', ConfigMap: 'configmaps', Secret: 'secrets', HorizontalPodAutoscaler: 'horizontalpodautoscalers', VerticalPodAutoscaler: 'verticalpodautoscalers.autoscaling.k8s.io' };
  function podSpec(object) {
    if (!workloadKinds.has(object.kind)) return null;
    return object.kind === 'Pod' ? object.spec || {} : object.kind === 'CronJob' ? object.spec?.jobTemplate?.spec?.template?.spec || {} : object.spec?.template?.spec || {};
  }
  function model(object = {}, resource = '') {
    const metadata = object.metadata || {}, spec = object.spec || {}, status = object.status || {};
    const secret = object.kind === 'Secret' || resource.split('.')[0] === 'secrets';
    const result = { fields: [], containers: [], references: [], annotations: [], labels: [] };
    const seenLabels = new Set(), seenReferences = new Set();
    function field(label, value) {
      const text = scalar(value);
      if (!text || text === '—' || seenLabels.has(label)) return;
      seenLabels.add(label); result.fields.push({ label, value: text });
    }
    function reference(target, namespace, defaults = {}) {
      if (!target || typeof target.kind !== 'string' || typeof target.name !== 'string' || !target.kind || !target.name) return;
      const ref = { kind: target.kind, name: target.name };
      const ns = target.namespace ?? namespace;
      if (typeof ns === 'string' && ns) ref.namespace = ns;
      if (typeof target.uid === 'string' && target.uid) ref.uid = target.uid;
      const version = target.apiVersion || defaults.apiVersion;
      if (typeof version === 'string' && version) ref.apiVersion = version;
      const id = JSON.stringify(ref);
      if (!seenReferences.has(id)) { seenReferences.add(id); result.references.push(ref); }
    }
    field('Name', metadata.name); field('Namespace', metadata.namespace);
    field('Kind', object.kind); field('API version', object.apiVersion);
    field('Created', metadata.creationTimestamp); field('UID', metadata.uid);
    field('Resource version', metadata.resourceVersion); field('Generation', metadata.generation);
    if (secret) {
      field('Type', object.type); field('Immutable', object.immutable);
      // Reading names only never decodes or serializes Secret data/annotations.
      field('Keys', list(Array.isArray(object.dataKeys) ? object.dataKeys : Array.isArray(object._dataKeys) ? object._dataKeys : keys(object.data)) || 'None');
      return result;
    }
    result.labels = Object.entries(metadata.labels || {}).map(([key, value]) => ({ key, value: scalar(value) }));
    result.annotations = Object.entries(metadata.annotations || {}).map(([key, value]) => ({ key, value: scalar(value) }));
    const inferredResource=kindResources[object.kind]||({Ingress:'ingresses',Endpoints:'endpoints',StorageClass:'storageclasses'}[object.kind])||(scalar(object.kind).toLowerCase()+'s');
    const profile = object.kind==='ConfigMap'?null:columns?.profiles?.[resource] || columns?.profiles?.[inferredResource];
    for (const column of profile || []) {
      if (['name', 'namespace', 'age', 'actions', 'labels', 'status'].includes(column.key) || typeof column.read !== 'function') continue;
      try { field(column.label, column.read(object)); } catch { /* A malformed optional field must not hide the resource identity. */ }
    }
    field('Phase', status.phase); field('Conditions', (status.conditions || []).map(condition=>condition.type+'='+condition.status).join(', '));
    for (const owner of metadata.ownerReferences || []) reference(owner, metadata.namespace);
    if (object.kind === 'ConfigMap') {
      field('Data keys', list(keys(object.data)) || 'None'); field('Binary data keys', list(keys(object.binaryData)) || 'None'); field('Immutable', object.immutable);
    }
    if (object.kind === 'Pod') {
      field('Node', spec.nodeName); field('Pod IP', status.podIP); field('Host IP', status.hostIP);
      field('QoS class', status.qosClass); field('Service account', spec.serviceAccountName);
      field('Restart policy', spec.restartPolicy); field('Start time', status.startTime);
      field('Priority class', spec.priorityClassName); field('Priority', spec.priority);
      field('Runtime class', spec.runtimeClassName); field('Termination grace period', spec.terminationGracePeriodSeconds === undefined ? undefined : spec.terminationGracePeriodSeconds + ' seconds');
      if (spec.nodeName) reference({ kind: 'Node', name: spec.nodeName, apiVersion: 'v1' });
    }
    if (object.kind === 'Node') {
      field('Schedulable', spec.unschedulable ? 'No' : 'Yes');
      field('Roles', keys(metadata.labels).filter(key => key.startsWith('node-role.kubernetes.io/')).map(key => key.slice('node-role.kubernetes.io/'.length)).join(', '));
      field('Taints', (spec.taints || []).map(t => t.key + (t.value ? '=' + t.value : '') + ':' + t.effect).join(', ') || 'None');
      field('Provider ID', spec.providerID); field('Pod CIDRs', list(spec.podCIDRs) || spec.podCIDR);
      for (const address of status.addresses || []) field(address.type, address.address);
      field('Capacity', dictionary(status.capacity)); field('Allocatable', dictionary(status.allocatable));
      const info = status.nodeInfo || {};
      for (const [label, key] of [['Kubelet version', 'kubeletVersion'], ['Container runtime', 'containerRuntimeVersion'], ['Operating system', 'operatingSystem'], ['OS image', 'osImage'], ['Architecture', 'architecture'], ['Kernel version', 'kernelVersion']]) field(label, info[key]);
    }
    const ps = podSpec(object);
    if (ps) {
      field('Service account', ps.serviceAccountName); field('Node selector', dictionary(ps.nodeSelector));
      field('Pod selector', dictionary(spec.selector?.matchLabels || spec.selector));
      if (ps.serviceAccountName) reference({ kind: 'ServiceAccount', name: ps.serviceAccountName, apiVersion: 'v1' }, metadata.namespace);
      for (const volume of ps.volumes || []) {
        if (volume.persistentVolumeClaim?.claimName) reference({ kind: 'PersistentVolumeClaim', name: volume.persistentVolumeClaim.claimName, apiVersion: 'v1' }, metadata.namespace);
        if (volume.configMap?.name) reference({ kind: 'ConfigMap', name: volume.configMap.name, apiVersion: 'v1' }, metadata.namespace);
        if (volume.secret?.secretName) reference({ kind: 'Secret', name: volume.secret.secretName, apiVersion: 'v1' }, metadata.namespace);
        for (const source of volume.projected?.sources || []) for (const [key, kind] of [['configMap', 'ConfigMap'], ['secret', 'Secret']]) if (source[key]?.name) reference({ kind, name: source[key].name, apiVersion: 'v1' }, metadata.namespace);
      }
      const groups = [['containers', 'containerStatuses', 'Container'], ['initContainers', 'initContainerStatuses', 'Init container'], ['ephemeralContainers', 'ephemeralContainerStatuses', 'Ephemeral container']];
      for (const [specKey, statusKey, type] of groups) for (const container of ps[specKey] || []) {
        const current = object.kind === 'Pod' ? (status[statusKey] || []).find(item => item.name === container.name) : null;
        const fields = [], add = (label, value) => { const text = scalar(value); if (text !== '') fields.push({ label, value: text }); };
        add('Image pull policy', container.imagePullPolicy); add('Requests', dictionary(container.resources?.requests)); add('Limits', dictionary(container.resources?.limits));
        add('Ports', (container.ports || []).map(p => (p.name ? p.name + ': ' : '') + p.containerPort + '/' + (p.protocol || 'TCP')).join(', '));
        add('Command', list(container.command)); add('Arguments', list(container.args));
        add('Mounts', (container.volumeMounts || []).map(m => m.name + ': ' + m.mountPath + (m.readOnly ? ' (read-only)' : '')).join(', '));
        for (const key of ['readinessProbe', 'livenessProbe', 'startupProbe']) if (container[key]) add(key.replace('Probe', ' probe'), ['httpGet', 'tcpSocket', 'grpc', 'exec'].find(method => container[key][method]) || 'Configured');
        if (current) {
          add('Ready', current.ready === undefined ? undefined : current.ready ? 'Yes' : 'No'); add('Restarts', current.restartCount);
          const stateKey = keys(current.state)[0], details = stateKey ? current.state[stateKey] : {};
          add('State', stateKey); add('Reason', details?.reason); add('Started', details?.startedAt); add('Finished', details?.finishedAt); add('Exit code', details?.exitCode);
          add('Container ID', current.containerID);
        }
        result.containers.push({ name: scalar(container.name), image: scalar(container.image), type, fields });
        for (const env of container.env || []) {
          if (env.valueFrom?.secretKeyRef?.name) reference({ kind: 'Secret', name: env.valueFrom.secretKeyRef.name, apiVersion: 'v1' }, metadata.namespace);
          if (env.valueFrom?.configMapKeyRef?.name) reference({ kind: 'ConfigMap', name: env.valueFrom.configMapKeyRef.name, apiVersion: 'v1' }, metadata.namespace);
        }
        for (const source of container.envFrom || []) for (const [key, kind] of [['secretRef', 'Secret'], ['configMapRef', 'ConfigMap']]) if (source[key]?.name) reference({ kind, name: source[key].name, apiVersion: 'v1' }, metadata.namespace);
      }
    }
    if (object.kind === 'HorizontalPodAutoscaler') {
      reference(spec.scaleTargetRef, metadata.namespace);
      field('Current metrics', (status.currentMetrics || []).map(metric => {
        const source = metric.resource || metric.containerResource || metric.pods || metric.object || metric.external || {};
        const current = source.current || {};
        return (source.name || source.metric?.name || metric.type) + ': ' + (current.averageUtilization !== undefined ? current.averageUtilization + '%' : current.averageValue ?? current.value ?? 'Not reported');
      }).join(', '));
      field('Last scale time', status.lastScaleTime);
    }
    if (object.kind === 'VerticalPodAutoscaler') reference(spec.targetRef, metadata.namespace);
    if (object.kind === 'StatefulSet' && spec.serviceName) reference({ kind: 'Service', name: spec.serviceName, apiVersion: 'v1' }, metadata.namespace);
    if (object.kind === 'PersistentVolumeClaim' && spec.volumeName) reference({ kind: 'PersistentVolume', name: spec.volumeName, apiVersion: 'v1' });
    if (object.kind === 'PersistentVolume') reference(spec.claimRef);
    if (['PersistentVolume', 'PersistentVolumeClaim'].includes(object.kind) && spec.storageClassName) reference({ kind: 'StorageClass', name: spec.storageClassName, apiVersion: 'storage.k8s.io/v1' });
    if (['RoleBinding', 'ClusterRoleBinding'].includes(object.kind)) {
      reference(spec.roleRef || object.roleRef, (spec.roleRef || object.roleRef)?.kind === 'Role' ? metadata.namespace : undefined, { apiVersion: 'rbac.authorization.k8s.io/v1' });
      for (const subject of object.subjects || []) if (subject.kind === 'ServiceAccount' && subject.namespace) reference(subject, undefined, { apiVersion: 'v1' });
    }
    if (object.kind === 'ServiceAccount') for (const entry of [...(object.secrets || []), ...(object.imagePullSecrets || [])]) reference({ kind: 'Secret', name: entry.name, apiVersion: 'v1' }, metadata.namespace);
    if (object.kind === 'CustomResourceDefinition') {
      field('Group', spec.group); field('Scope', spec.scope); field('Resource kind', spec.names?.kind); field('Plural', spec.names?.plural);
      field('Served versions', (spec.versions || []).filter(v => v.served).map(v => v.name).join(', ')); field('Storage version', (spec.versions || []).find(v => v.storage)?.name);
    }
    if (object.kind === 'Service') { field('External name', spec.externalName); field('Selector', dictionary(spec.selector)); }
    if (object.kind === 'Endpoints') for (const subset of object.subsets || []) for (const address of [...(subset.addresses || []), ...(subset.notReadyAddresses || [])]) reference(address.targetRef);
    if (object.kind === 'EndpointSlice') {
      const serviceName = metadata.labels?.['kubernetes.io/service-name'];
      if (serviceName) reference({ kind: 'Service', name: serviceName, apiVersion: 'v1' }, metadata.namespace);
      for (const endpoint of object.endpoints || []) reference(endpoint.targetRef);
    }
    if (object.kind === 'Ingress') for (const backend of [spec.defaultBackend, ...(spec.rules || []).flatMap(rule => (rule.http?.paths || []).map(path => path.backend))].filter(Boolean)) if (backend.service?.name) reference({ kind: 'Service', name: backend.service.name, apiVersion: 'v1' }, metadata.namespace);
    return result;
  }
  return { model };
});
