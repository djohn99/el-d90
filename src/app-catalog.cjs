// Original curated application catalog. Installation stays in the existing Helm workflow.
const helm = require('./helm.cjs');
const APPS = Object.freeze([
  {id:'prometheus-stack',name:'Prometheus monitoring stack',category:'Observability',description:'Prometheus Operator, Prometheus, Alertmanager and the chart’s optional dashboards/exporters.',repo:{name:'prometheus-community',url:'https://prometheus-community.github.io/helm-charts'},chart:'kube-prometheus-stack',namespace:'monitoring',release:'monitoring',docs:'https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack',requirements:['Review Kubernetes/chart compatibility and resource requests.','Installs cluster-scoped CRDs and controllers.','Review dashboard exposure and storage before installation.']},
  {id:'cert-manager',name:'cert-manager',category:'Security',description:'Certificate lifecycle controllers and certificate/issuer custom resources.',repo:{name:'jetstack',url:'https://charts.jetstack.io'},chart:'cert-manager',namespace:'cert-manager',release:'cert-manager',docs:'https://cert-manager.io/docs/installation/helm/',requirements:['Review CRD installation/upgrade settings for the selected chart version.','Issuers and credentials must be configured separately.','Requires permission to install cluster-scoped controllers and CRDs.']},
  {id:'argo-cd',name:'Argo CD',category:'GitOps',description:'Declarative GitOps application delivery and reconciliation controllers.',repo:{name:'argo',url:'https://argoproj.github.io/argo-helm'},chart:'argo-cd',namespace:'argocd',release:'argocd',docs:'https://github.com/argoproj/argo-helm/tree/main/charts/argo-cd',requirements:['Configure authentication, repository access and application policies separately.','Review server exposure, TLS and resource/storage settings.','Installing a controller does not automatically connect your Git repositories.']},
]);
const clone = value => structuredClone(value);
function get(id) { const app=APPS.find(a=>a.id===id);if(!app)throw Error('Choose a catalog application');return clone(app); }
function list() { return {apps:clone(APPS),categories:[...new Set(APPS.map(a=>a.category))],source:'Curated upstream Helm repositories. No cluster changes are made by browsing.'}; }
async function configure(input,options={}) {
  const app=get(input.id),h=options.helm||helm,repositories=await h.repos();
  const repo=repositories.find(r=>String(r.url).replace(/\/$/,'')===app.repo.url.replace(/\/$/,''));
  if(!repo)return {app,needsRepository:app.repo,versions:[],values:'',chart:null};
  const chart=repo.name+'/'+app.chart,versions=await h.versions({chart});
  const requested=input.version||versions[0]?.version;if(!requested)throw Error('No chart versions are available. Refresh configured Helm repositories.');
  if(!versions.some(v=>v.version===requested))throw Error('Select a version returned by the configured chart repository');
  const values=await h.values({chart,version:requested});
  return {app,chart,version:requested,versions:versions.map(v=>({version:v.version,appVersion:v.app_version||''})),values,name:app.release,namespace:app.namespace,needsRepository:null};
}
function docURL(id) { return get(id).docs; }
module.exports={list,get,configure,docURL};
