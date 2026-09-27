// Parsing des lignes de proxy, repris de background.js (extension Chrome).
// Formats acceptés :
//   host:port
//   host:port:user:pass
//   user:pass@host:port
//   scheme://... (http, https, socks4, socks5)
export function parseProxyLine(line) {
  let s = String(line || '').trim();
  if (!s) return null;

  let scheme = 'http';
  const schemeMatch = s.match(/^(https?|socks[45]):\/\//i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    s = s.slice(schemeMatch[0].length);
  }

  let host, port, username, password;

  if (s.includes('@')) {
    const at = s.lastIndexOf('@');
    const creds = s.slice(0, at);
    const hostPort = s.slice(at + 1);
    const ci = creds.indexOf(':');
    username = ci === -1 ? creds : creds.slice(0, ci);
    password = ci === -1 ? '' : creds.slice(ci + 1);
    [host, port] = hostPort.split(':');
  } else {
    const parts = s.split(':');
    if (parts.length >= 4) {
      [host, port, username] = parts;
      password = parts.slice(3).join(':');
    } else if (parts.length === 2) {
      [host, port] = parts;
    } else {
      return null;
    }
  }

  if (!host || !port || Number.isNaN(Number(port))) return null;
  return {
    scheme,
    host: host.trim(),
    port: Number(port),
    username: username || null,
    password: password || null,
  };
}

// Convertit une ligne de proxy en config attendue par
// browser.newContext({ proxy }) de Playwright.
export function proxyLineToPlaywrightConfig(line) {
  const parsed = line ? parseProxyLine(line) : null;
  if (!parsed) return null;

  const config = { server: `${parsed.scheme}://${parsed.host}:${parsed.port}` };
  if (parsed.username) {
    config.username = parsed.username;
    config.password = parsed.password || '';
  }
  return config;
}

// Pour l'affichage (statut, Discord) : host:port sans les identifiants.
export function maskProxy(line) {
  const p = parseProxyLine(line);
  if (!p) return null;
  return p.username ? `${p.host}:${p.port} (auth)` : `${p.host}:${p.port}`;
}
