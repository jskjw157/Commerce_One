import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('default runtime refuses outbound fetch, sockets, TLS, HTTP(S), HTTP2, DNS and UDP before dialing',()=>{
  const code=`
    const assert = (await import('node:assert/strict')).default;
    const require = (await import('node:module')).createRequire(import.meta.url);
    const blocked = fn => assert.throws(fn, /OUTBOUND_NETWORK_BLOCKED/);
    await assert.rejects(fetch('https://example.invalid'), /OUTBOUND_NETWORK_BLOCKED/);
    blocked(() => require('node:net').connect(443,'example.invalid'));
    blocked(() => require('node:tls').connect(443,'example.invalid'));
    blocked(() => require('node:http').get('http://example.invalid'));
    blocked(() => require('node:https').get('https://example.invalid'));
    blocked(() => require('node:http2').connect('https://example.invalid'));
    blocked(() => require('node:dgram').createSocket('udp4'));
    blocked(() => require('node:dns').lookup('example.invalid',()=>{}));
    await assert.rejects(require('node:dns').promises.lookup('example.invalid'), /OUTBOUND_NETWORK_BLOCKED/);
    console.log('all blocked');
  `;
  const child=spawnSync(process.execPath,['--import','./scripts/network-guard.mjs','--input-type=module','-e',code],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr); assert.match(child.stdout,/all blocked/);
});
