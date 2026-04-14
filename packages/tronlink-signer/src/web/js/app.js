// Main app: polling, request lifecycle, UI events
(function() {
  var statusEl = document.getElementById('status');
  var detailsEl = document.getElementById('details');
  var typeBadgeEl = document.getElementById('typeBadge');
  var networkBadgeEl = document.getElementById('networkBadge');
  var buttonGroup = document.getElementById('buttonGroup');
  var retryGroup = document.getElementById('retryGroup');
  var retryBtn = document.getElementById('retryBtn');
  var approveBtn = document.getElementById('approveBtn');
  var rejectBtn = document.getElementById('rejectBtn');

  var pendingRequest = null;
  var currentRequestId = null;
  var polling = false;

  var NETWORK_NAMES = {
    mainnet: 'Mainnet',
    nile: 'Nile Testnet',
    shasta: 'Shasta Testnet'
  };

  // Heartbeat — detect server disconnect
  var heartbeatFailCount = 0;
  var sessionExpired = false;
  setInterval(function() {
    fetch('/api/heartbeat', { method: 'POST' })
      .then(function(res) {
        if (res.ok) {
          heartbeatFailCount = 0;
        } else {
          heartbeatFailCount++;
        }
      })
      .catch(function() {
        heartbeatFailCount++;
      })
      .finally(function() {
        if (heartbeatFailCount >= 3 && !sessionExpired) {
          sessionExpired = true;
          setStatus('Session expired. Please restart and try again.', 'error');
          buttonGroup.style.display = 'none';
          retryGroup.style.display = 'none';
          approveBtn.disabled = true;
          rejectBtn.disabled = true;
        }
      });
  }, 3000);

  // --- UI helpers ---

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addDetail(label, value) {
    var row = document.createElement('div');
    row.className = 'detail-row';
    row.innerHTML = '<span class="label">' + label + '</span><span class="value">' + escapeHtml(String(value)) + '</span>';
    detailsEl.appendChild(row);
  }

  function disableButtons() {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
  }

  // --- Render request details ---

  function renderDetails(req) {
    typeBadgeEl.textContent = req.type;
    typeBadgeEl.style.display = 'inline-block';
    if (req.network) {
      networkBadgeEl.textContent = NETWORK_NAMES[req.network] || req.network;
      networkBadgeEl.style.display = 'inline-block';
    }
    detailsEl.innerHTML = '';

    var data = req.data || {};
    switch (req.type) {
      case 'connect':
        addDetail('Action', 'Connect Wallet');
        break;
      case 'send_trx':
        addDetail('To', data.to);
        addDetail('Amount', data.amount + ' TRX');
        break;
      case 'send_trc20':
        addDetail('Contract', data.contractAddress);
        addDetail('To', data.to);
        addDetail('Amount', data.amount);
        addDetail('Decimals', data.decimals);
        break;
      case 'sign_message':
        addDetail('Message', data.message);
        break;
      case 'sign_typed_data':
        addDetail('Typed Data', JSON.stringify(data.typedData, null, 2));
        break;
      case 'sign_transaction': {
        var parsed = window.TxParser.parseTransaction(data.transaction);
        if (parsed) {
          addDetail('Type', parsed.label);
          parsed.details.forEach(function(d) { addDetail(d.l, d.v); });
          if (parsed._trc20) {
            window.TxParser.fetchTrc20Info(parsed._trc20, detailsEl);
          }
          if (parsed._withdrawOwner) {
            window.TxParser.fetchWithdrawAmount(parsed._withdrawOwner, detailsEl);
          }
        } else {
          addDetail('Transaction', JSON.stringify(data.transaction, null, 2));
        }
        break;
      }
    }
  }

  // --- Wallet readiness ---

  async function tryEnsureWallet() {
    retryGroup.style.display = 'none';
    buttonGroup.style.display = 'none';
    try {
      await window.TronWallet.ensureWalletReady(pendingRequest.network, setStatus);

      // Auto-complete connect requests once wallet is ready
      if (pendingRequest.type === 'connect') {
        // Wait a bit for tronWeb.defaultAddress to populate
        for (var i = 0; i < 10; i++) {
          var addr = window.TronWallet.getAddress();
          if (addr) {
            setStatus('Wallet connected: ' + addr, 'success');
            await completeRequest(currentRequestId, true, { address: addr, network: window.TronWallet.getCurrentNetwork() });
            startPollingAfterDone();
            return;
          }
          await new Promise(function(r) { setTimeout(r, 300); });
        }
      }

      setStatus('Ready. Review and approve or reject.', 'info');
      buttonGroup.style.display = 'flex';
    } catch (e) {
      setStatus(e.message || 'Wallet connection failed. Please try again.', 'error');
      retryGroup.style.display = 'flex';
    }
  }

  // --- Request lifecycle ---

  async function completeRequest(id, success, resultOrError) {
    var body = success
      ? { success: true, result: resultOrError }
      : { success: false, error: resultOrError };
    await fetch('/api/complete/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function handleRequest(req) {
    pendingRequest = req;
    currentRequestId = req.id;

    renderDetails(req);

    // Wait for wallet extension to inject first
    setStatus('Discovering wallets...', 'waiting');
    try {
      await window.TronWallet.waitForWallet(5000);
      var detail = window.TronWallet.getProviderDetail();
      if (detail && detail.info) {
        setStatus('Found wallet: ' + detail.info.name, 'info');
      }
    } catch (e) {
      setStatus(e.message, 'error');
      return;
    }

    await tryEnsureWallet();
  }

  // --- Polling ---

  async function pollForRequests() {
    if (polling) return;
    polling = true;
    if (!currentRequestId) {
      setStatus('Waiting for request...', 'info');
    }

    var interval = 500;
    var maxInterval = 5000;

    while (true) {
      try {
        var res = await fetch('/api/pending/next');
        if (res.ok) {
          var req = await res.json();
          if (req.id !== currentRequestId) {
            buttonGroup.style.display = 'none';
            retryGroup.style.display = 'none';
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
            polling = false;
            await handleRequest(req);
            return;
          }
        }
        interval = Math.min(interval * 1.5, maxInterval);
      } catch (e) {
        interval = maxInterval;
      }
      await new Promise(function(r) { setTimeout(r, interval); });
    }
  }

  function startPollingAfterDone() {
    polling = false;
    pollForRequests();
  }

  // --- Event listeners ---

  retryBtn.addEventListener('click', function() {
    tryEnsureWallet();
  });

  approveBtn.addEventListener('click', async function() {
    disableButtons();
    setStatus('Processing with wallet...', 'waiting');
    try {
      var result = await window.TronActions.execute(pendingRequest);
      await completeRequest(currentRequestId, true, result);
      setStatus('Approved and completed successfully.', 'success');
      startPollingAfterDone();
    } catch (e) {
      var msg = e.message || String(e);
      await completeRequest(currentRequestId, false, msg);
      setStatus('Error: ' + msg, 'error');
      startPollingAfterDone();
    }
  });

  rejectBtn.addEventListener('click', async function() {
    disableButtons();
    setStatus('Rejected.', 'error');
    await completeRequest(currentRequestId, false, 'USER_REJECTED');
    startPollingAfterDone();
  });

  // --- Init ---
  window.TronWallet.discoverWallets();
  pollForRequests();
})();
