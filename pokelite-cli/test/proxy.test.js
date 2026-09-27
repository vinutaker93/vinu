import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProxyLine, proxyLineToPlaywrightConfig, maskProxy } from '../src/proxy.js';

test('parseProxyLine: host:port', () => {
  assert.deepEqual(parseProxyLine('1.2.3.4:8080'), {
    scheme: 'http',
    host: '1.2.3.4',
    port: 8080,
    username: null,
    password: null,
  });
});

test('parseProxyLine: host:port:user:pass', () => {
  const p = parseProxyLine('1.2.3.4:8080:bob:secret');
  assert.equal(p.host, '1.2.3.4');
  assert.equal(p.port, 8080);
  assert.equal(p.username, 'bob');
  assert.equal(p.password, 'secret');
});

test('parseProxyLine: user:pass@host:port', () => {
  const p = parseProxyLine('bob:secret@1.2.3.4:8080');
  assert.equal(p.host, '1.2.3.4');
  assert.equal(p.port, 8080);
  assert.equal(p.username, 'bob');
  assert.equal(p.password, 'secret');
});

test('parseProxyLine: scheme prefix', () => {
  const p = parseProxyLine('socks5://1.2.3.4:1080');
  assert.equal(p.scheme, 'socks5');
  assert.equal(p.host, '1.2.3.4');
  assert.equal(p.port, 1080);
});

test('parseProxyLine: invalid returns null', () => {
  assert.equal(parseProxyLine(''), null);
  assert.equal(parseProxyLine('not-a-proxy'), null);
  assert.equal(parseProxyLine('host:notaport'), null);
});

test('proxyLineToPlaywrightConfig: with auth', () => {
  const cfg = proxyLineToPlaywrightConfig('bob:secret@1.2.3.4:8080');
  assert.equal(cfg.server, 'http://1.2.3.4:8080');
  assert.equal(cfg.username, 'bob');
  assert.equal(cfg.password, 'secret');
});

test('proxyLineToPlaywrightConfig: without auth omits credentials', () => {
  const cfg = proxyLineToPlaywrightConfig('1.2.3.4:8080');
  assert.equal(cfg.server, 'http://1.2.3.4:8080');
  assert.equal('username' in cfg, false);
});

test('proxyLineToPlaywrightConfig: null for empty line', () => {
  assert.equal(proxyLineToPlaywrightConfig(''), null);
  assert.equal(proxyLineToPlaywrightConfig(null), null);
});

test('maskProxy: hides credentials', () => {
  assert.equal(maskProxy('bob:secret@1.2.3.4:8080'), '1.2.3.4:8080 (auth)');
  assert.equal(maskProxy('1.2.3.4:8080'), '1.2.3.4:8080');
  assert.equal(maskProxy(''), null);
});
