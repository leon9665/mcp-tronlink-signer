// Wallet discovery, connection, and network management
(function() {
  var _providerDetail = null;

  function discoverWallets() {
    window.addEventListener('TIP6963:announceProvider', function(e) {
      if (!_providerDetail) {
        _providerDetail = e.detail;
      }
    });
    window.dispatchEvent(new Event('TIP6963:requestProvider'));
  }

  function getProviderDetail() {
    return _providerDetail;
  }

  function getProvider() {
    if (_providerDetail && _providerDetail.provider) {
      return _providerDetail.provider;
    }
    return window.tron || window.tronLink || null;
  }

  function getTronWeb() {
    var provider = getProvider();
    if (provider && provider.tronWeb) {
      return provider.tronWeb;
    }
    return window.tronWeb || null;
  }

  function waitForWallet(maxWait) {
    maxWait = maxWait || 5000;
    discoverWallets();

    return new Promise(function(resolve, reject) {
      if (getProvider()) { resolve(true); return; }

      var elapsed = 0;
      var interval = setInterval(function() {
        elapsed += 200;
        if (getProvider()) {
          clearInterval(interval);
          resolve(true);
        } else if (elapsed >= maxWait) {
          clearInterval(interval);
          reject(new Error('No TRON wallet found. Please install TronLink extension.'));
        }
      }, 200);
    });
  }

  var NETWORK_CHAIN_IDS = {
    mainnet: '0x2b6653dc',
    nile: '0xcd8690dc',
    shasta: '0x94a9059e'
  };

  var NETWORK_FULL_HOSTS = {
    mainnet: 'https://api.trongrid.io',
    nile: 'https://nile.trongrid.io',
    shasta: 'https://api.shasta.trongrid.io'
  };

  function isConnected() {
    var tronWeb = getTronWeb();
    return !!(tronWeb && tronWeb.defaultAddress && tronWeb.defaultAddress.base58);
  }

  function getAddress() {
    var tronWeb = getTronWeb();
    return (tronWeb && tronWeb.defaultAddress && tronWeb.defaultAddress.base58) || null;
  }

  async function ensureConnected() {
    if (isConnected()) return;
    await getProvider().request({ method: 'tron_requestAccounts' });
    await new Promise(function(r) { setTimeout(r, 500); });
  }

  async function ensureWalletReady(expectedNetwork, setStatus) {
    var provider = getProvider();
    if (!provider) {
      throw new Error('No TRON wallet found. Please install TronLink extension and refresh.');
    }

    // Skip connection prompt if already connected
    if (!isConnected()) {
      setStatus('Connecting wallet...', 'waiting');
      try {
        var accountRes = await provider.request({ method: 'eth_requestAccounts' });
        if (accountRes && accountRes.code === 4001) {
          throw new Error('User rejected wallet connection.');
        }
      } catch (e) {
        throw new Error(e.message || 'Wallet connection failed. Please click Retry.');
      }
    }

    var tronWeb = getTronWeb();
    if (!tronWeb || !tronWeb.defaultAddress || !tronWeb.defaultAddress.base58) {
      await new Promise(function(r) { setTimeout(r, 1000); });
      tronWeb = getTronWeb();
      if (!tronWeb || !tronWeb.defaultAddress || !tronWeb.defaultAddress.base58) {
        throw new Error('Wallet not ready. Please unlock TronLink and refresh.');
      }
    }

    if (expectedNetwork) {
      var currentHost = tronWeb.fullNode.host;
      var expectedHost = NETWORK_FULL_HOSTS[expectedNetwork];
      if (expectedHost && currentHost !== expectedHost) {
        setStatus('Switching to ' + expectedNetwork + ' network...', 'waiting');
        var chainId = NETWORK_CHAIN_IDS[expectedNetwork];
        if (chainId) {
          try {
            await provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: chainId }]
            });
            await new Promise(function(r) { setTimeout(r, 1500); });
          } catch (switchErr) {
            throw new Error('Please switch TronLink to ' + expectedNetwork + ' network manually then click Retry.');
          }
        }
      }
    }
  }

  var HOST_TO_NETWORK = {
    'https://api.trongrid.io': 'mainnet',
    'https://nile.trongrid.io': 'nile',
    'https://api.shasta.trongrid.io': 'shasta'
  };

  function getCurrentNetwork() {
    var tw = getTronWeb();
    if (tw && tw.fullNode) {
      return HOST_TO_NETWORK[tw.fullNode.host] || 'unknown';
    }
    return 'unknown';
  }

  // Expose to global
  window.TronWallet = {
    discoverWallets: discoverWallets,
    getProviderDetail: getProviderDetail,
    getProvider: getProvider,
    getTronWeb: getTronWeb,
    waitForWallet: waitForWallet,
    isConnected: isConnected,
    getAddress: getAddress,
    ensureConnected: ensureConnected,
    ensureWalletReady: ensureWalletReady,
    getCurrentNetwork: getCurrentNetwork
  };
})();
