const kube = require('./kube.cjs');
const { TextDecoder } = require('node:util');

function decode(data = {}) {
  return Object.entries(data).map(([key, encoded]) => {
    if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error('Secret contains invalid base64 data');
    const bytes = Buffer.from(encoded, 'base64');
    let value, binary = false;
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) binary = true; } catch { binary = true; }
    return { key, bytes: bytes.length, binary, value: binary ? encoded : value, encoding: binary ? 'base64 (binary)' : 'UTF-8' };
  });
}

async function reveal(input, options = {}) {
  const context = kube.string(input.context, 'context'), namespace = kube.name(input.namespace, 'namespace'), name = kube.name(input.name);
  const uid = kube.string(input.uid, 'Secret UID');
  const object = JSON.parse(await (options.run || kube.run)(['get', 'secrets', name, ...kube.scope({ context, namespace }, 'secrets', true), '-o', 'json']));
  if (object.kind !== 'Secret' || object.metadata?.uid !== uid || object.metadata?.name !== name || object.metadata?.namespace !== namespace) throw Error('Secret identity changed. Refresh and reopen it.');
  return { entries: decode(object.data), uid };
}
module.exports = { decode, reveal };
