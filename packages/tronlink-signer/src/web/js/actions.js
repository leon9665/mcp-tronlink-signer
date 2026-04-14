// Execute wallet actions (sign, send, connect)
(function() {
  async function executeTronAction(req) {
    await window.TronWallet.ensureConnected();
    var tronWeb = window.TronWallet.getTronWeb();
    var data = req.data || {};

    switch (req.type) {
      case 'connect': {
        return { address: tronWeb.defaultAddress.base58, network: window.TronWallet.getCurrentNetwork() };
      }
      case 'send_trx': {
        var tx = await tronWeb.transactionBuilder.sendTrx(data.to, tronWeb.toSun(data.amount));
        var signedTx = await tronWeb.trx.sign(tx);
        var broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
        return { txId: broadcast.txid };
      }
      case 'send_trc20': {
        var contract = await tronWeb.contract().at(data.contractAddress);
        var decimals = data.decimals || 6;
        var parts = String(data.amount).split('.');
        var whole = parts[0] || '0';
        var fracInput = parts[1] || '';
        if (fracInput.length > decimals) {
          throw new Error('Amount has too many decimal places (max ' + decimals + ' for this token). Got: ' + data.amount);
        }
        var frac = fracInput.padEnd(decimals, '0');
        var rawAmount = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
        if (rawAmount === 0n) {
          throw new Error('Amount is zero after conversion. Please check the amount: ' + data.amount);
        }
        var txId = await contract.methods.transfer(data.to, rawAmount.toString()).send();
        return { txId: txId };
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
