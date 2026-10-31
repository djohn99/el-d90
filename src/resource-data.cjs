// Original, local manifest-data editor. No Kubernetes requests or writes occur here.
const YAML = require('yaml');
const MAX = 2 * 1024 * 1024;
function document(input) {
  if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > MAX) throw Error('Manifest must be text up to 2 MiB');
  const docs = YAML.parseAllDocuments(input.text, { uniqueKeys: true });
  if (docs.length !== 1 || docs[0].errors.length) throw Error('Choose one valid resource manifest');
  const doc = docs[0], object = doc.toJS({ maxAliasCount: 20 });
  if (!['ConfigMap', 'Secret'].includes(object?.kind)) throw Error('Data editing supports ConfigMap and Secret resources');
  const identity = input.identity;
  if (!identity || object.kind !== identity.kind || object.metadata?.name !== identity.name || object.metadata?.namespace !== identity.namespace || !identity.uid || object.metadata?.uid !== identity.uid) throw Error('Resource identity changed. Refresh and reopen it.');
  return { doc, object };
}
function read(input) {
  const { object } = document(input);
  const fields = [];
  for (const property of ['data', ...(object.kind === 'ConfigMap' ? ['binaryData'] : [])]) {
    for (const [key, value] of Object.entries(object[property] || {})) {
      if (typeof value !== 'string') throw Error('Resource data must contain text values');
      fields.push({ key, value, binary: property === 'binaryData' || object.kind === 'Secret' });
    }
  }
  return { fields, immutable: object.immutable === true };
}
function write(input) {
  const { doc, object } = document(input);
  if (object.immutable) throw Error('This resource is immutable');
  if (!Array.isArray(input.fields) || input.fields.length > 5000) throw Error('Choose up to 5,000 data keys');
  const data = new Map(), binary = new Map(), keys = new Set();
  for (const field of input.fields) {
    if (typeof field?.key !== 'string' || !/^[A-Za-z0-9._-]{1,253}$/.test(field.key) || keys.has(field.key)) throw Error('Use unique keys containing letters, digits, dots, dashes or underscores');
    keys.add(field.key);
    if (typeof field.value !== 'string') throw Error('Values must be text');
    if ((field.binary || object.kind === 'Secret') && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(field.value)) throw Error('Binary data must be valid base64');
    (field.binary && object.kind === 'ConfigMap' ? binary : data).set(field.key, field.value);
  }
  for (const [property, values] of [['data', data], ...(object.kind === 'ConfigMap' ? [['binaryData', binary]] : [])]) {
    const current = doc.get(property, true);
    if (current && !YAML.isMap(current)) throw Error('Resource data must be a mapping');
    if (current) for (const pair of [...current.items]) if (!values.has(String(pair.key.value))) doc.deleteIn([property, String(pair.key.value)]);
    for (const [key, value] of values) doc.setIn([property, key], value);
  }
  const text = doc.toString({ lineWidth: 0 });
  if (Buffer.byteLength(text) > MAX) throw Error('Updated manifest exceeds 2 MiB');
  return { text };
}
module.exports = { read, write };
