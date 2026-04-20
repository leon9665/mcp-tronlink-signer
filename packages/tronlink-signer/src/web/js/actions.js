// Execute wallet actions (sign, send, connect)
(function() {
  // Tron broadcast errors return message as plain hex (UTF-8 string, not ABI-encoded).
  function decodeHexUtf8(hex) {
    if (typeof hex !== 'string' || !hex) return null;
    var s = hex.indexOf('0x') === 0 ? hex.slice(2) : hex;
    if (s.length === 0 || s.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(s)) return null;
    try {
      var bytes = [];
      for (var i = 0; i < s.length; i += 2) bytes.push(parseInt(s.slice(i, i + 2), 16));
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (_) {
      return null;
    }
  }

  function broadcastErrorMessage(broadcast) {
    var raw = broadcast && broadcast.message;
    var decoded = decodeHexUtf8(raw);
    var text = decoded || raw || broadcast.code || 'unknown error';
    return broadcast.code ? (broadcast.code + ': ' + text) : text;
  }

  // Broadcast + notify server, then return immediately. On-chain confirmation
  // is polled on the SDK side (using the server's tronWeb which carries the
  // TRON-PRO-API-KEY). Keeping the confirm loop out of the browser avoids
  // rate-limit issues and decouples the confirm timeout from the pending-store
  // 5-minute total timeout.
  async function broadcastOnly(tronWeb, signedTx, callbacks) {
    var broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
    // Tron returns either { result: true, txid } on success, or { code, txid, message }
    // (often hex-encoded) on validation failure. The presence of `code` — or the absence
    // of `result: true` — means the tx was rejected and never made it to any mempool;
    // the txid in the response is just the signed tx's hash, not on-chain.
    if (broadcast.code || broadcast.result !== true) {
      throw new Error('Broadcast failed: ' + broadcastErrorMessage(broadcast));
    }
    var txId = broadcast.txid;
    if (callbacks && typeof callbacks.onBroadcast === 'function') {
      try { await callbacks.onBroadcast({ txId: txId, signedTransaction: signedTx }); } catch (_) {}
    }
    return { txId: txId, status: 'pending' };
  }

  async function executeTronAction(req, callbacks) {
    await window.TronWallet.ensureConnected();
    var tronWeb = window.TronWallet.getTronWeb();
    var data = req.data || {};

    switch (req.type) {
      case 'connect': {
        return { address: tronWeb.defaultAddress.base58, network: window.TronWallet.getCurrentNetwork() };
      }
      case 'send_trx': {
        var trxStr = String(data.amount).trim();
        if (!/^\d+(\.\d+)?$/.test(trxStr)) {
          throw new Error('Invalid TRX amount: ' + data.amount);
        }
        var trxParts = trxStr.split('.');
        var trxWhole = trxParts[0] || '0';
        var trxFracInput = trxParts[1] || '';
        if (trxFracInput.length > 6) {
          throw new Error('TRX has max 6 decimals, got: ' + data.amount);
        }
        var trxFrac = trxFracInput.padEnd(6, '0');
        var sun = BigInt(trxWhole) * 1000000n + BigInt(trxFrac || '0');
        if (sun === 0n) {
          throw new Error('TRX amount is zero: ' + data.amount);
        }
        var tx = await tronWeb.transactionBuilder.sendTrx(data.to, sun.toString());
        var signedTx = await tronWeb.trx.sign(tx);
        return await broadcastOnly(tronWeb, signedTx, callbacks);
      }
      case 'send_trc20': {
        var decimals = (data.decimals !== undefined && data.decimals !== null) ? data.decimals : 6;
        var amountStr = String(data.amount).trim();
        if (!/^\d+(\.\d+)?$/.test(amountStr)) {
          throw new Error('Invalid amount format: ' + data.amount);
        }
        var parts = amountStr.split('.');
        var whole = parts[0] || '0';
        var fracInput = parts[1] || '';
        if (fracInput.length > decimals) {
          throw new Error('Amount has too many decimal places (max ' + decimals + ' for this token). Got: ' + data.amount);
        }
        if (decimals > 18) {
          throw new Error('Decimals too large (max 18). Got: ' + decimals);
        }
        var frac = decimals > 0 ? fracInput.padEnd(decimals, '0') : '';
        var multiplier = 10n ** BigInt(decimals);
        var rawAmount = decimals > 0
          ? BigInt(whole) * multiplier + BigInt(frac)
          : BigInt(whole);
        if (rawAmount === 0n) {
          throw new Error('Amount is zero after conversion. Please check the amount: ' + data.amount);
        }
        // Build + sign manually so we can broadcast + confirm via the shared helper,
        // giving us the same {txId, status, error?} contract as the other paths.
        var tx20 = await tronWeb.transactionBuilder.triggerSmartContract(
          data.contractAddress,
          'transfer(address,uint256)',
          {},
          [
            { type: 'address', value: data.to },
            { type: 'uint256', value: rawAmount.toString() },
          ],
          tronWeb.defaultAddress.base58
        );
        if (!tx20 || !tx20.result || !tx20.result.result || !tx20.transaction) {
          throw new Error('Failed to build TRC20 transfer transaction');
        }
        var signed20 = await tronWeb.trx.sign(tx20.transaction);
        return await broadcastOnly(tronWeb, signed20, callbacks);
      }
      case 'sign_message': {
        var signature = await tronWeb.trx.signMessageV2(data.message);
        return { signature: signature };
      }
      case 'sign_typed_data': {
        var typedData = data.typedData;
        var domain = typedData.domain;
        var types = Object.assign({}, typedData.types);
        delete types.EIP712Domain;
        var message = typedData.message;
        var sig = await tronWeb.trx._signTypedData(domain, types, message);
        return { signature: sig };
      }
      case 'sign_transaction': {
        var signed = await tronWeb.trx.sign(data.transaction);
        if (data.broadcast) {
          var broadcasted = await broadcastOnly(tronWeb, signed, callbacks);
          return Object.assign({ signedTransaction: signed }, broadcasted);
        }
        return { signedTransaction: signed };
      }
      default:
        throw new Error('Unknown request type: ' + req.type);
    }
  }

  window.TronActions = {
    execute: executeTronAction
  };
})();
