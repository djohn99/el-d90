const kube=require('./kube.cjs');
async function forResource(input){const context=kube.string(input.context,'context'),uid=kube.string(input.uid,'resource UID',128);if(!/^[A-Za-z0-9-]+$/.test(uid))throw Error('Invalid resource UID');const args=['get','events','--context',context,'--request-timeout=20s','--field-selector','involvedObject.uid='+uid];if(input.namespace&&input.namespace!=='*')args.push('--namespace',kube.name(input.namespace,'namespace'));else args.push('--all-namespaces');args.push('-o','json');return JSON.parse(await kube.run(args));}
module.exports={forResource};
