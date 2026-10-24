// Safety rules: which addresses may be recorded, where secrets come from, and text that must never appear.

const LOCAL = ['localhost', '*.localhost', '127.0.0.1', '[::1]', '::1'];

/** Does a host match a pattern such as "localhost", "*.localhost" or "demo.example.test"? */
export function hostMatches(host, pattern) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const p = pattern.toLowerCase().replace(/^\[|\]$/g, '');
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p;
}

/** Hosts a scenario may visit: this machine, plus whatever the scenario lists in `target.allowHosts`. */
export function allowedHosts(extra = []) {
  return [...LOCAL, ...extra];
}

/** Throws unless the address is on this machine or in the scenario's allow list. A demo must never run on production by accident. */
export function assertUrlAllowed(url, extra = []) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid address`);
  }
  if (!['http:', 'https:', 'about:', 'data:'].includes(parsed.protocol)) throw new Error(`The address "${url}" uses ${parsed.protocol}, which is not allowed`);
  if (parsed.protocol === 'about:' || parsed.protocol === 'data:') return parsed;
  const hosts = allowedHosts(extra);
  if (!hosts.some((p) => hostMatches(parsed.hostname, p))) {
    throw new Error(
      `Refusing to record ${parsed.hostname}. Demos run only on this machine (${LOCAL.join(', ')}). ` +
        'If this really is a safe demo site, list its host in "target.allowHosts" of the scenario.',
    );
  }
  return parsed;
}

/** Replaces ${ENV:NAME} in a string with the environment value. A missing variable is an error, never an empty password. */
export function expandEnv(text, env = process.env) {
  return String(text).replace(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (env[name] === undefined || env[name] === '') throw new Error(`The environment variable ${name} is not set`);
    return env[name];
  });
}

/** Values that should never be printed: anything that came from ${ENV:...}. */
export function secretValues(text, env = process.env) {
  const out = [];
  String(text).replace(/\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (env[name]) out.push(env[name]);
    return '';
  });
  return out;
}

export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out;
}

/** Compiles the scenario's "forbidden" list of regular expressions. */
export function compileForbidden(patterns = []) {
  return patterns.map((p) => {
    try {
      return new RegExp(p, 'i');
    } catch {
      throw new Error(`The forbidden pattern "${p}" is not a valid regular expression`);
    }
  });
}

/** Returns the first forbidden pattern that appears in the text, or null. */
export function findForbidden(text, compiled) {
  for (const re of compiled) {
    const m = re.exec(text);
    if (m) return { pattern: re.source, match: m[0] };
  }
  return null;
}
