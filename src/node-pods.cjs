'use strict';
const kube=require('./kube.cjs');
async function list(input,request){
 const nodeName=kube.name(input.nodeName,'node name');
 const result=await kube.pagedList({context:kube.string(input.context,'context'),namespace:'*',nodeName},'pods',request);
 return {items:result.items.filter(pod=>pod.spec?.nodeName===nodeName)};
}
module.exports={list};
