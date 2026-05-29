// Tests for actions.js executeTronAction — the browser-side execution: amount→raw
// encoding for send_trx / send_trc20 (the highest correctness-risk path), the
// broadcastOnly success/failure + hex-error decoding, sign_message,
// sign_transaction (±broadcast), connect, and unknown-type. vm sandbox with a
// mocked tronWeb that records calls. (sign_typed_data is covered separately.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'src', 'web', 'js', 'actions.js'), 'utf8');

const hexOf = (s) => Buffer.from(s, 'utf8').toString('hex');
const word = (n) => BigInt(n).toString(16).padStart(64, '0'); // 32-byte uint return

// Mock tronWeb. opts.decimalsHex controls the auto-detect decimals() result
// (null => no result); opts.broadcast controls sendRawTransaction's return.
function makeTronWeb(opts = {}) {
  const calls = { sendTrx: [], triggerConst: [], triggerSmart: [], sign: [], sendRaw: [], signMsg: [] };
  const tw = {
    defaultAddress: { base58: 'TFromAddr00000000000000000000000000' },
    transactionBuilder: {
      sendTrx: async (to, sun) => { calls.sendTrx.push({ to, sun }); return { __trx: true, to, sun }; },
      triggerConstantContract: async (addr, sel, _o, params) => {
        calls.triggerConst.push({ addr, sel, params });
        if (sel === 'decimals()') return { constant_result: opts.decimalsHex == null ? [] : [opts.decimalsHex] };
        return { constant_result: [] };
      },
      triggerSmartContract: async (addr, sig, _o, params) => {
        calls.triggerSmart.push({ addr, sig, params });
        return { result: { result: true }, transaction: { __trc20: true } };
      },
    },
    trx: {
      sign: async (tx) => { calls.sign.push(tx); return Object.assign({ __signed: true }, tx); },
      sendRawTransaction: async (signed) => { calls.sendRaw.push(signed); return opts.broadcast || { result: true, txid: 'TXID123' }; },
      signMessageV2: async (msg) => { calls.signMsg.push(msg); return '0xSIGNATURE'; },
    },
  };
  return { tw, calls };
}

function load(tw, currentNetwork = 'nile') {
  const sandbox = {
    console, TextDecoder, setTimeout, clearTimeout,
    window: { TronWallet: { ensureConnected: async () => {}, getTronWeb: () => tw, getCurrentNetwork: () => currentNetwork } },
  };
  vm.runInNewContext(SRC, sandbox);
  return sandbox.window.TronActions.execute;
}
const run = (tw, type, data, cb) => load(tw)({ type, data: data || {} }, cb || {});

// --- send_trx amount → sun ---------------------------------------------------

test('send_trx: "1.5" encodes to 1500000 sun and broadcasts', async () => {
  const { tw, calls } = makeTronWeb();
  const r = await run(tw, 'send_trx', { to: 'Tto', amount: '1.5' });
  assert.equal(calls.sendTrx[0].sun, '1500000');
  assert.equal(r.txId, 'TXID123');
  assert.equal(r.status, 'pending');
});

test('send_trx: rejects bad format, >6 decimals, and zero', async () => {
  const bad = async (amount, re) => {
    const { tw } = makeTronWeb();
    await assert.rejects(run(tw, 'send_trx', { to: 'Tto', amount }), re);
  };
  await bad('1.', /Invalid TRX amount/);
  await bad('abc', /Invalid TRX amount/);
  await bad('.5', /Invalid TRX amount/);
  await bad('1.5000001', /max 6 decimals/);
  await bad('0', /amount is zero/);
  await bad('0.000000', /amount is zero/);
});

test('send_trx: large value keeps full precision (no float loss)', async () => {
  const { tw, calls } = makeTronWeb();
  await run(tw, 'send_trx', { to: 'Tto', amount: '1000000.123456' });
  assert.equal(calls.sendTrx[0].sun, '1000000123456');
});

// --- send_trc20 amount → raw (decimals) -------------------------------------

test('send_trc20: explicit 18 decimals — "0.0001" -> 1e14 raw, no decimals() probe', async () => {
  const { tw, calls } = makeTronWeb();
  await run(tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '0.0001', decimals: 18 });
  assert.equal(calls.triggerConst.length, 0, 'explicit decimals must skip auto-detect');
  assert.equal(calls.triggerSmart[0].params[1].value, '100000000000000'); // 0.0001 * 1e18
});

test('send_trc20: auto-detects decimals via decimals() when omitted', async () => {
  const { tw, calls } = makeTronWeb({ decimalsHex: word(6) });
  await run(tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '1.5' });
  assert.equal(calls.triggerConst[0].sel, 'decimals()');
  assert.equal(calls.triggerSmart[0].params[1].value, '1500000'); // 1.5 * 1e6
});

test('send_trc20: auto-detect failure and out-of-range both throw (no silent default)', async () => {
  const noResult = makeTronWeb({ decimalsHex: null });
  await assert.rejects(run(noResult.tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '1' }), /Could not auto-detect/);
  const tooBig = makeTronWeb({ decimalsHex: word(30) });
  await assert.rejects(run(tooBig.tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '1' }), /out of range/);
});

test('send_trc20: too many decimal places, decimals>18, and zero-after-conversion throw', async () => {
  const t = makeTronWeb();
  await assert.rejects(run(t.tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '1.123', decimals: 2 }), /too many decimal places/);
  await assert.rejects(run(t.tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '1.5', decimals: 20 }), /Decimals too large/);
  await assert.rejects(run(t.tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '0', decimals: 6 }), /Amount is zero/);
});

test('send_trc20: 0-decimals token encodes the whole number as-is', async () => {
  const { tw, calls } = makeTronWeb();
  await run(tw, 'send_trc20', { contractAddress: 'Tc', to: 'Tto', amount: '42', decimals: 0 });
  assert.equal(calls.triggerSmart[0].params[1].value, '42');
});

// --- broadcastOnly: success / failure / hex error decode --------------------

test('broadcastOnly: success fires onBroadcast and returns {txId, pending}', async () => {
  const { tw } = makeTronWeb({ broadcast: { result: true, txid: 'ABC' } });
  let seen = null;
  const r = await run(tw, 'send_trx', { to: 'Tto', amount: '1' }, { onBroadcast: (i) => { seen = i; } });
  assert.equal(r.txId, 'ABC');
  assert.equal(r.status, 'pending');
  assert.equal(seen.txId, 'ABC');
  assert.ok(seen.signedTransaction, 'onBroadcast receives the signed tx');
});

test('broadcastOnly: a code + hex message decodes to readable text', async () => {
  const { tw } = makeTronWeb({ broadcast: { code: 'CONTRACT_VALIDATE_ERROR', message: hexOf('balance is not sufficient') } });
  await assert.rejects(
    run(tw, 'send_trx', { to: 'Tto', amount: '1' }),
    /Broadcast failed: CONTRACT_VALIDATE_ERROR: balance is not sufficient/,
  );
});

test('broadcastOnly: result !== true (no code) is still a failure', async () => {
  const { tw } = makeTronWeb({ broadcast: { result: false } });
  await assert.rejects(run(tw, 'send_trx', { to: 'Tto', amount: '1' }), /Broadcast failed/);
});

// --- sign_message / sign_transaction / connect / unknown --------------------

test('sign_message returns the signature from signMessageV2', async () => {
  const { tw, calls } = makeTronWeb();
  const r = await run(tw, 'sign_message', { message: 'hello' });
  assert.equal(r.signature, '0xSIGNATURE');
  assert.equal(calls.signMsg[0], 'hello');
});

test('sign_transaction: broadcast=false signs only; broadcast=true also sends', async () => {
  const noB = makeTronWeb();
  const r1 = await run(noB.tw, 'sign_transaction', { transaction: { raw: 1 }, broadcast: false });
  assert.ok(r1.signedTransaction && r1.signedTransaction.__signed);
  assert.equal(r1.txId, undefined);
  assert.equal(noB.calls.sendRaw.length, 0, 'must not broadcast');

  const withB = makeTronWeb({ broadcast: { result: true, txid: 'TX9' } });
  const r2 = await run(withB.tw, 'sign_transaction', { transaction: { raw: 1 }, broadcast: true });
  assert.ok(r2.signedTransaction);
  assert.equal(r2.txId, 'TX9');
  assert.equal(r2.status, 'pending');
});

test('connect returns the active address + network; unknown type throws', async () => {
  const { tw } = makeTronWeb();
  const r = await run(tw, 'connect', {});
  assert.equal(r.address, 'TFromAddr00000000000000000000000000');
  assert.equal(r.network, 'nile');
  await assert.rejects(run(tw, 'frobnicate', {}), /Unknown request type: frobnicate/);
});
