importScripts('log-model.js');
self.onmessage=event=>{try{const rows=self.elD90LogModel.filter(event.data.buffer,event.data.options);self.postMessage({id:event.data.id,rows});}catch(error){self.postMessage({id:event.data.id,error:error.message});}};
