// Native destinations keep occasional tools out of the resource sidebar.
const FILE_VIEWS=Object.freeze([['catalog','App catalog'],['gitops','GitOps'],['extensions','Extensions'],['connections','Connect clusters'],['resources','API explorer'],['changes','Change history'],['updates','Updates & setup']]);
const WORKSPACE_TOOLS=[['applications','Applications'],['issues','Troubleshooting'],['metrics','Metrics'],['node-sessions','Node sessions'],['map','Resource map'],['gateway-api','Gateway API'],['device-api','Devices / DRA'],['admission-api','Admission']];
function fileMenu(onNavigate){return{label:'File',submenu:[...FILE_VIEWS.map(([view,label])=>({id:'navigate-'+view,label,click:()=>onNavigate(view)})),{id:'workspace-tools',label:'Workspace tools',submenu:WORKSPACE_TOOLS.map(([view,label])=>({id:'navigate-'+view,label,click:()=>onNavigate(view)}))}]};}
module.exports={FILE_VIEWS,fileMenu};
