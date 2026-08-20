function unbracket(hostname: string): string {
  const host = hostname.toLowerCase();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function isLocalHost(hostname: string): boolean {
  const host = unbracket(hostname);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isPrivateHost(hostname: string): boolean {
  const host = unbracket(hostname);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return /^(?:0\.|10\.|100\.(?:6[4-9]|[789]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.(?:0\.0\.|0\.2\.|168\.)|198\.(?:1[89]\.|51\.100\.)|203\.0\.113\.|(?:22[4-9]|2[3-9]\d)\.)/.test(host);
  }
  if (host.startsWith('::ffff:')) return isPrivateHost(host.slice(7));
  return host === '::' || host === '::1' || /^(?:fc|fd|fe[89ab]|ff|2001:db8:)/.test(host);
}
