/* Original resource manifest starters; arbitrary YAML and installed CRDs remain supported. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.elD90Create=api;})(typeof window!=='undefined'?window:globalThis,function(){
const builtins=[['v1','ConfigMap',true],['v1','Secret',true],['v1','Namespace',false],['v1','Pod',true],['v1','Service',true],['v1','ServiceAccount',true],['v1','PersistentVolumeClaim',true],['apps/v1','Deployment',true],['apps/v1','StatefulSet',true],['apps/v1','DaemonSet',true],['batch/v1','Job',true],['batch/v1','CronJob',true],['networking.k8s.io/v1','Ingress',true],['networking.k8s.io/v1','NetworkPolicy',true],['rbac.authorization.k8s.io/v1','Role',true],['rbac.authorization.k8s.io/v1','RoleBinding',true],['rbac.authorization.k8s.io/v1','ClusterRole',false],['rbac.authorization.k8s.io/v1','ClusterRoleBinding',false],['apiextensions.k8s.io/v1','CustomResourceDefinition',false]];
function catalogue(discovered=[]){const entries=[...discovered,...builtins.map(([apiVersion,kind,namespaced])=>({apiVersion,kind,namespaced}))];return entries.filter((r,i,a)=>r.apiVersion&&r.kind&&a.findIndex(v=>v.apiVersion===r.apiVersion&&v.kind===r.kind)===i).sort((a,b)=>a.kind.localeCompare(b.kind)||a.apiVersion.localeCompare(b.apiVersion));}
function template(resource,name,namespace){if(!resource||!/^[a-z][a-z0-9./-]*$/i.test(resource.apiVersion)||!/^[A-Za-z][A-Za-z0-9]*$/.test(resource.kind))throw Error('Choose a resource type');if(!/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(name)||name.length>253)throw Error('Enter a valid resource name');if(resource.namespaced&&(!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(namespace)||namespace.length>63))throw Error('Choose one namespace for this manifest');
const kind=resource.kind;let text=`apiVersion: ${resource.apiVersion}\nkind: ${kind}\nmetadata:\n  name: ${name}\n${resource.namespaced?'  namespace: '+namespace+'\n':''}`;
const pod=`      containers:\n        - name: app\n          image: nginx:stable\n`;
if(kind==='ConfigMap')text+='data:\n  key: value\n';
else if(kind==='Secret')text+='type: Opaque\nstringData:\n  key: replace-me\n';
else if(['Deployment','StatefulSet','DaemonSet'].includes(kind))text+=`spec:\n${kind==='StatefulSet'?'  serviceName: '+name+'\n':''}${kind!=='DaemonSet'?'  replicas: 1\n':''}  selector:\n    matchLabels:\n      app: ${name}\n  template:\n    metadata:\n      labels:\n        app: ${name}\n    spec:\n${pod}`;
else if(kind==='Pod')text+='spec:\n  containers:\n    - name: app\n      image: nginx:stable\n';
else if(kind==='Service')text+=`spec:\n  selector:\n    app: ${name}\n  ports:\n    - port: 80\n      targetPort: 80\n`;
else if(kind==='PersistentVolumeClaim')text+='spec:\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: 1Gi\n';
else if(kind==='Job')text+='spec:\n  template:\n    spec:\n      restartPolicy: Never\n      containers:\n        - name: job\n          image: busybox:1.37.0\n          command: ["/bin/sh", "-c", "echo hello"]\n';
else if(kind==='CronJob')text+='spec:\n  schedule: "0 * * * *"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          restartPolicy: Never\n          containers:\n            - name: job\n              image: busybox:1.37.0\n              command: ["/bin/sh", "-c", "echo hello"]\n';
else if(['Role','ClusterRole'].includes(kind))text+='rules: []\n';
else if(['RoleBinding','ClusterRoleBinding'].includes(kind))text+=`subjects: []\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: ${kind==='RoleBinding'?'Role':'ClusterRole'}\n  name: replace-me\n`;
else if(!['Namespace','ServiceAccount'].includes(kind))text+='# Add the required fields for this API. Use Load schema or Explain field.\n';
return text;}
return{catalogue,template};});
