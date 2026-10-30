/* Shared history capabilities and Pod container paths. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.elD90WorkloadHistory=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const direct=Object.freeze({statefulsets:'StatefulSet',daemonsets:'DaemonSet',jobs:'Job',replicasets:'ReplicaSet',replicationcontrollers:'ReplicationController'});
 const chains=Object.freeze({deployments:{podOwner:'ReplicaSet',metric:'kube_replicaset_owner',label:'replicaset',owner:'Deployment'},cronjobs:{podOwner:'Job',metric:'kube_job_owner',label:'job_name',owner:'CronJob'}});
 const resources=Object.freeze(['pods',...Object.keys(direct),...Object.keys(chains),'nodes']);
 function containers(object){const spec=object?.spec;return spec?.containers||spec?.template?.spec?.containers||spec?.jobTemplate?.spec?.template?.spec?.containers||[];}
 return{direct,chains,resources,containers};
});
