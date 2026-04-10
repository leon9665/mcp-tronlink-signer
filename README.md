# mcp-tronlink-signer

[![npm: mcp-tronlink-signer](https://img.shields.io/npm/v/mcp-tronlink-signer)](https://www.npmjs.com/package/mcp-tronlink-signer)
[![npm: tronlink-signer](https://img.shields.io/npm/v/tronlink-signer?label=npm%3A%20tronlink-signer)](https://www.npmjs.com/package/tronlink-signer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

MCP Server for signing TRON transactions via TronLink browser wallet. Private keys never leave TronLink — all signing happens in the browser through a local approval page.

Also provides a standalone SDK ([tronlink-signer](./packages/tronlink-signer)) for direct integration without MCP.

## Quick Start

### Claude Code

```bash
claude mcp add -s user tronlink-signer -- npx mcp-tronlink-signer
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "tronlink-signer": {
      "command": "npx",
      "args": ["mcp-tronlink-signer"]
    }
  }
}
```

## MCP Tools

| Tool | Description | Parameters |
| ---- | ----------- | ---------- |
| `connect_wallet` | Connect TronLink wallet | `network?` |
| `send_trx` | Send TRX to an address | `to`, `amount`, `network?` |
| `send_trc20` | Send TRC20 tokens | `contractAddress`, `to`, `amount`, `decimals?`, `network?` |
| `sign_message` | Sign a message | `message`, `network?` |
| `sign_typed_data` | Sign EIP-712 typed data | `typedData`, `network?` |
| `sign_transaction` | Sign a raw transaction | `transaction`, `network?` |
| `get_balance` | Get TRX balance | `address`, `network?` |

All tools support an optional `network` parameter (`mainnet` / `nile` / `shasta`), defaulting to `mainnet`.

## Standalone SDK Usage

```ts
import { TronSigner } from "tronlink-signer";

const signer = new TronSigner();
await signer.start();

// Each signing operation automatically handles wallet connection
// and network switching in a single approval page.
const { signature } = await signer.signMessage("hello world");
const { txId } = await signer.sendTrx("TXxx...", 1);
const { balance } = await signer.getBalance("TXxx..."); // No browser needed

await signer.stop();
```

See [tronlink-signer README](./packages/tronlink-signer) for full API documentation.

## How It Works

1. AI agent (or your code) calls a signing method (e.g., `send_trx`)
2. Local HTTP server starts on port 3386 and browser opens an approval page
3. Approval page discovers wallet via **TIP-6963** protocol (fallback to `window.tron` / `window.tronLink`)
4. Auto-unlocks wallet and switches network if needed
5. User reviews the request and clicks Approve / Reject
6. TronLink extension handles signing in the browser
7. Result is returned to the caller

Private keys never leave the TronLink wallet.

## Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `TRON_NETWORK` | Default network (mainnet/nile/shasta) | `mainnet` |
| `TRON_HTTP_PORT` | Local HTTP server port | `3386` |
| `TRON_API_KEY` | TronGrid API key (optional) | - |

## Packages

| Package | Description |
| ------- | ----------- |
| [mcp-tronlink-signer](./packages/mcp-tronlink-signer) | MCP Server — exposes signing tools for Claude and other AI clients |
| [tronlink-signer](./packages/tronlink-signer) | Standalone SDK — direct integration without MCP |

## Development

```bash
pnpm install
pnpm build        # Build all packages
pnpm typecheck    # Type check all packages
```

## Project Structure

```text
packages/
├── tronlink-signer/            # Standalone SDK (publishable to npm)
│   └── src/
│       ├── tron-signer.ts      # Core signing class
│       ├── pending-store.ts    # Async request queue
│       ├── http-server.ts      # Local HTTP server
│       ├── browser.ts          # Browser open helper
│       ├── config.ts           # Network config
│       ├── types.ts            # Type definitions
│       └── web/index.html      # Approval page SPA (TIP-6963)
└── mcp-tronlink-signer/        # MCP Server layer
    └── src/
        ├── server.ts           # MCP tools/resources/prompts
        ├── schemas.ts          # Zod validation schemas
        └── index.ts            # Entry point
```

## License

MIT License Copyright (c) 2026 TronLink
