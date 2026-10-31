// Static local worker for the YAML editor/diff. Prepared from the pinned Monaco package.
importScripts('../assets/monaco/editor-worker.js');
self.postMessage({type:'vscode-worker-ready'});
