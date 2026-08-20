import { createHash } from 'node:crypto';

export function canonicalizeSvg(source) {
  return Buffer.from(source).toString('utf8').replace(/\r\n?/g, '\n');
}

export function computeIconSourceHash(fullSource, smallSource) {
  return createHash('sha256')
    .update(canonicalizeSvg(fullSource))
    .update(canonicalizeSvg(smallSource))
    .digest('hex');
}
