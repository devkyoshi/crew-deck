import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Fetching a page for a link preview means the server makes a request to an address a user chose, so
 * every step is guarded against server-side request forgery: only http and https on their normal
 * ports, no private, loopback, link-local or otherwise internal addresses (checked on the addresses
 * the connection actually uses, so DNS tricks do not help), a few redirects each re-checked, a small
 * download and a short deadline.
 */

const v4 = (ip: string) => ip.split('.').map(Number) as [number, number, number, number];

/** Reserved IPv4 ranges: [first address, prefix length]. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const num = (ip: string) => {
  const [a, b, c, d] = v4(ip);
  return ((a * 256 + b) * 256 + c) * 256 + d;
};

function privateV4(ip: string) {
  const n = num(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = Math.floor(num(base) / size) * size;
    return n >= start && n < start + size;
  });
}

/** Expands an IPv6 address into eight 16-bit groups (handles `::` and a trailing IPv4 part). */
function groupsOfV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = v4(tail[1]!);
    s =
      s.slice(0, -tail[1]!.length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if ((halves.length === 1 && head.length !== 8) || fill < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  const groups = all.map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/** True for any address a server must never fetch on a user's behalf. Unparseable input counts as private. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const g = groupsOfV6(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, g6, h] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embeddedV4 = `${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`;
  // ::, ::1 and IPv4-mapped / compatible addresses (judged by the IPv4 inside).
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff)
    return privateV4(embeddedV4);
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return true;
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x2001 && b === 0) return true; // Teredo
  if (a === 0x2002) return true; // 6to4
  if (a === 0x64 && b === 0xff9b) return true; // NAT64
  return false;
}

export class BlockedAddressError extends Error {}

/** A `lookup` for http(s).request that refuses internal addresses, whatever the name resolves to. */
export function safeLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number | undefined,
  cb: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) {
  const opts = typeof options === 'object' ? options : {};
  dnsLookup(hostname, { all: true, family: opts.family }, (err, addresses) => {
    if (err) return cb(err, '');
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return cb(
        new BlockedAddressError('That address is not allowed') as NodeJS.ErrnoException,
        '',
      );
    }
    if (opts.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

/** Throws unless this URL may be fetched at all (protocol, port, literal addresses). */
export function assertFetchable(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError('Not a valid address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new BlockedAddressError('Only http and https links');
  if (url.username || url.password)
    throw new BlockedAddressError('Links with credentials are not allowed');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (port !== 80 && port !== 443) throw new BlockedAddressError('Unusual ports are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Literal addresses skip DNS, so they are checked here.
  if (net.isIP(host) && isPrivateAddress(host))
    throw new BlockedAddressError('That address is not allowed');
  if (host === 'localhost' || host.endsWith('.localhost'))
    throw new BlockedAddressError('That address is not allowed');
  return url;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Replaced in tests to reach a local server; production always uses `safeLookup`. */
  lookup?: typeof safeLookup;
  /** Tests only: skips the literal-address and port checks. */
  skipUrlChecks?: boolean;
}

export interface FetchedPage {
  url: string;
  html: string;
}

/** Downloads the start of an HTML page, following a few redirects, with every hop checked. */
export async function fetchPage(raw: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const deadline = Date.now() + timeoutMs;
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = opts.skipUrlChecks ? new URL(current) : assertFetchable(current);
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('Timed out');
    const res = await new Promise<{
      status: number;
      location?: string;
      type: string;
      body: Buffer;
    }>((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(
        url,
        {
          method: 'GET',
          lookup: (opts.lookup ?? safeLookup) as never,
          timeout: left,
          headers: {
            'user-agent': 'CrewDeckBot/1.0 (link preview)',
            accept: 'text/html,application/xhtml+xml',
            'accept-encoding': 'identity',
          },
        },
        (r) => {
          const status = r.statusCode ?? 0;
          const type = String(r.headers['content-type'] ?? '');
          if (status >= 300 && status < 400) {
            r.resume();
            return resolve({ status, location: r.headers.location, type, body: Buffer.alloc(0) });
          }
          if (!/text\/html|application\/xhtml/i.test(type)) {
            r.destroy();
            return resolve({ status, type, body: Buffer.alloc(0) });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          r.on('data', (c: Buffer) => {
            size += c.length;
            chunks.push(c);
            // Titles and meta tags live at the top: stop reading once we have enough.
            if (size >= maxBytes) r.destroy();
          });
          r.on('close', () =>
            resolve({ status, type, body: Buffer.concat(chunks).subarray(0, maxBytes) }),
          );
          r.on('error', () =>
            resolve({ status, type, body: Buffer.concat(chunks).subarray(0, maxBytes) }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out')));
      req.on('error', reject);
      req.end();
    });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, url).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Status ${res.status}`);
    if (res.body.length === 0) throw new Error('Not a web page');
    return { url: url.toString(), html: res.body.toString('utf8') };
  }
  throw new Error('Too many redirects');
}
