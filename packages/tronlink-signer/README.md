# tronlink-signer

Standalone SDK for signing TRON transactions via the TronLink browser wallet. Private keys never leave TronLink — all signing happens in the browser through a local approval page.

## Installation

```bash
npm install tronlink-signer
```

## Quick Start

```ts
import { TronSigner } from "tronlink-signer";

const signer = new TronSigner();
await signer.start();

const { address, network } = await signer.connectWallet();
const { txId, status } = await signer.sendTrx("TXxx...", 1); // status: "success" | "pending" | "failed"
const { txId: txId2, status: s2 } = await signer.signTransaction(tx, "nile", true); // broadcast + auto-confirm
const { balance } = await signer.getBalance("TXxx...");

await signer.stop();
```

## API

### `new TronSigner(config?: Partial<AppConfig>)`

Creates a new signer instance. If no config is provided, it reads from environment variables via `loadConfig()`.

### `signer.start(): Promise<void>`

Starts the local HTTP server for browser approval.

### `signer.stop(): Promise<void>`

Stops the server and clears all pending requests.

### `signer.getConfig(): AppConfig`

Returns the current configuration.

### `signer.connectWallet(network?, options?): Promise<{ address: string; network: string }>`

Opens the browser to connect TronLink and retrieve the wallet address and current network. If the wallet is already connected (same browser tab still open), auto-completes without user interaction.

### `signer.sendTrx(to, amount, network?, options?): Promise<BroadcastResult>`

Sends TRX to a recipient address. Opens a browser approval page for the user to confirm. Returns `{ txId, status, error? }` where `status` is `"success"`, `"pending"`, or `"failed"` (see [Broadcast Result](#broadcast-result)).

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `to` | `string` | Recipient Tron address (base58) |
| `amount` | `string \| number` | Amount of TRX to send |
| `network` | `TronNetwork` | Optional network override |
| `options` | `SignerOptions` | Optional — pass `{ signal }` to enable cancellation |

### `signer.sendTrc20(contractAddress, to, amount, decimals?, network?, options?): Promise<BroadcastResult>`

Sends TRC20 tokens. Opens a browser approval page. Returns `{ txId, status, error? }` — see [Broadcast Result](#broadcast-result).

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `contractAddress` | `string` | TRC20 token contract address |
| `to` | `string` | Recipient Tron address (base58) |
| `amount` | `string` | Amount in human-readable units (e.g., `"1.5"` for 1.5 USDT). Decimals conversion is automatic. |
| `decimals` | `number` | Token decimals (default: 6) |
| `network` | `TronNetwork` | Optional network override |
| `options` | `SignerOptions` | Optional — pass `{ signal }` to enable cancellation |

### `signer.signMessage(message, network?, options?): Promise<{ signature: string }>`

Signs a plain text message.

### `signer.signTypedData(typedData, network?, options?): Promise<{ signature: string }>`

Signs EIP-712 typed data.

```ts
const { signature } = await signer.signTypedData({
  domain: { name: "MyDApp", version: "1", chainId: 728126428 },
  types: {
    Greeting: [{ name: "contents", type: "string" }],
  },
  primaryType: "Greeting",
  message: { contents: "Hello Tron!" },
});
```

### `signer.signTransaction(transaction, network?, broadcast?, options?): Promise<{ signedTransaction; txId?; status?; error? }>`

Signs a raw transaction. When `broadcast` is `true`, the signed transaction is broadcast on-chain via TronLink and the SDK automatically polls for on-chain confirmation — see [Broadcast Result](#broadcast-result) for the possible `status` values.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `transaction` | `Record<string, unknown>` | Raw transaction object to sign |
| `network` | `TronNetwork` | Optional network override |
| `broadcast` | `boolean` | Whether to broadcast after signing (default: `false`) |
| `options` | `SignerOptions` | Optional — cancellation, confirmation control, broadcast callback |

```ts
// Sign only
const { signedTransaction } = await signer.signTransaction(tx);

// Sign, broadcast, and wait for confirmation (default)
const { signedTransaction, txId, status, error } = await signer.signTransaction(tx, "nile", true);
// status === "success" — confirmed on-chain
// status === "pending" — broadcast succeeded but not confirmed within timeout
// status === "failed"  — on-chain execution failed; `error` carries the reason

// Broadcast without waiting for confirmation
const result = await signer.signTransaction(tx, "nile", true, { confirm: false });

// Get notified as soon as the tx enters the mempool
const result = await signer.signTransaction(tx, "nile", true, {
  onBroadcasted: ({ txId }) => console.log("Broadcast:", txId),
});
```

### Broadcast Result

Broadcasting methods (`sendTrx`, `sendTrc20`, and `signTransaction` with `broadcast: true`) return a `BroadcastResult`:

```ts
interface BroadcastResult {
  txId: string;
  status: "success" | "pending" | "failed";
  error?: string; // set when status === "failed"
}
```

`"failed"` means the transaction reached the chain but execution failed (e.g. `OUT_OF_ENERGY`, Solidity revert). **It is not thrown** — inspect `status` instead. The SDK only throws when broadcast itself never happened (signature error, user rejection, network unreachable, etc.).

### `signer.waitForTransaction(txId, network?, options?): Promise<{ status; error? }>`

Polls the network for transaction confirmation. Returns `{ status: "success" }` when confirmed, `{ status: "pending" }` on timeout, or `{ status: "failed", error }` when the transaction reverted / ran out of energy.

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `txId` | `string` | Transaction ID to monitor |
| `network` | `TronNetwork` | Optional network override |
| `options` | `WaitForTransactionOptions` | Optional — `timeoutMs` (default: 30000), `signal` |

```ts
const { status, error } = await signer.waitForTransaction(txId, "nile");
if (status === "success") console.log("Confirmed on-chain");
else if (status === "failed") console.warn("Execution failed:", error);
```

> **Note:** When using `signTransaction` with `broadcast: true`, confirmation polling is automatic — you don't need to call `waitForTransaction` separately unless you set `confirm: false`.

### `signer.getBalance(address, network?): Promise<{ balance: string; balanceSun: number }>`

Gets TRX balance for an address. No browser approval needed.

### `signer.onBrowserDisconnect`

Setter for a callback that fires when the approval page is closed or loses connection (heartbeat timeout). Useful for cleanup or re-prompting the user.

```ts
signer.onBrowserDisconnect = () => {
  console.log("Browser approval page was closed");
};
```

### Cancellation & Options

All signing methods accept an optional `SignerOptions`:

| Option | Type | Description |
| ------ | ---- | ----------- |
| `signal` | `AbortSignal` | Cancels the pending request. If already aborted, the browser page is not opened. |
| `confirm` | `boolean` | Wait for on-chain confirmation after broadcast (default: `true`). Only applies when `broadcast: true`. |
| `confirmTimeoutMs` | `number` | Max time (ms) to wait for confirmation (default: `30000`). |
| `onBroadcasted` | `(info) => void` | Fires after the tx enters the mempool (before confirmation). Callback errors are swallowed. |

```ts
const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

try {
  const { txId } = await signer.sendTrx("TXxx...", 1, undefined, {
    signal: controller.signal,
  });
} catch (e) {
  // e.message === "CANCELLED_BY_CALLER"
}
```

## How It Works

1. Your code calls a signing method (e.g., `signMessage`)
2. A local HTTP server starts on port 3386 and a **single browser tab** opens the approval page
3. The approval page discovers the wallet via **TIP-6963** protocol (fallback to `window.tron`)
4. Auto-unlocks wallet and switches network if needed
5. For `connectWallet`, if the wallet is already connected, it auto-completes without user interaction
6. For signing/sending, the user reviews the transaction details and clicks Approve / Reject
7. The approval page parses transaction types (TRX transfer, TRC20, TRC721 NFT, stake, delegate, vote, etc.) into human-readable display
8. TronLink handles signing in the browser
9. The result is returned to your code — the page stays open and polls for the next request

All subsequent operations reuse the same browser tab. Each server session has a unique ID — old browser tabs from previous sessions are automatically invalidated. The page detects server disconnection via heartbeat and shows a session expired message. The local server binds to `127.0.0.1` only. If port 3386 is in use, it auto-increments. Requests timeout after 5 minutes. The server gracefully shuts down on process exit (SIGINT/SIGTERM).

## Networks

All signing methods accept an optional `network` parameter:

| Network | Full Host | Explorer |
| ------- | --------- | -------- |
| `mainnet` (default) | `https://api.trongrid.io` | `https://tronscan.org` |
| `nile` | `https://nile.trongrid.io` | `https://nile.tronscan.org` |
| `shasta` | `https://api.shasta.trongrid.io` | `https://shasta.tronscan.org` |

## Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `TRON_NETWORK` | Default network | `mainnet` |
| `TRON_HTTP_PORT` | Local HTTP server port | `3386` |
| `TRON_API_KEY` | TronGrid API key (optional) | - |

## Types

```ts
type TronNetwork = "mainnet" | "nile" | "shasta";

interface AppConfig {
  network: TronNetwork;
  httpPort: number;
  apiKey?: string;
}

interface NetworkConfig {
  name: string;
  fullHost: string;
  explorerUrl: string;
}

interface SignerOptions {
  signal?: AbortSignal;
  confirm?: boolean;
  confirmTimeoutMs?: number;
  onBroadcasted?: (info: { txId: string; signedTransaction: Record<string, unknown> }) => void;
}

interface WaitForTransactionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

type BroadcastStatus = "success" | "pending" | "failed";

interface BroadcastResult {
  txId: string;
  status: BroadcastStatus;
  error?: string;
}
```

## Exports

```ts
// Class
export { TronSigner } from "./tron-signer.js";

// Config
export { NETWORKS, DEFAULT_HTTP_PORT, REQUEST_TIMEOUT_MS, loadConfig } from "./config.js";

// Types
export type {
  TronNetwork, NetworkConfig, AppConfig,
  PendingRequestType, PendingRequest,
  SendTrxData, SendTrc20Data,
  SignMessageData, SignTypedDataData, SignTransactionData,
  SignerOptions, WaitForTransactionOptions,
  BroadcastStatus, BroadcastResult,
} from "./types.js";
```

## License

MIT License Copyright (c) 2026 TronLink
