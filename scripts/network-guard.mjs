// Accidental-use guard for this synthetic server, not a hostile-code sandbox.
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const block = () => { throw new Error('OUTBOUND_NETWORK_BLOCKED: synthetic localhost pilot'); };
const net = require('node:net');
net.Socket.prototype.connect = block;
net.connect = block;
net.createConnection = block;
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = block;
  module.get = block;
}
require('node:tls').connect = block;
require('node:http2').connect = block;
require('node:dgram').createSocket = block;
const dns = require('node:dns');
const originalLookup = dns.lookup;
for (const key of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']) {
  dns[key] = block;
  dns.promises[key] = async () => block();
}
// Node's listener calls lookup even for a literal IPv4 address. Its IP fast path does not resolve DNS.
dns.lookup = (...args) => args[0] === '127.0.0.1' ? originalLookup(...args) : block();
dns.Resolver = class { constructor() { block(); } };
dns.promises.Resolver = class { constructor() { block(); } };
globalThis.fetch = async () => block();
syncBuiltinESMExports();
