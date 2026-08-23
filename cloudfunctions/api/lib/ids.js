'use strict';

const crypto = require('crypto');

function stableEntityId(prefix, ...parts) {
  const label = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 18) || 'entity';
  const material = parts.map((part) => String(part)).join('\u001f');
  const hash = crypto.createHash('sha256').update(material).digest('hex');
  return `${label}_${hash.slice(0, 56)}`;
}

module.exports = {
  stableEntityId
};
