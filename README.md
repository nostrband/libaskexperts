# libaskexperts - Create Your Own Experts

A TypeScript library to create experts based on [NIP-174](https://github.com/nostrband/askexperts/blob/main/NIP-174.md) (AskExperts) protocol.

AskExperts is intended to be used by MCP tools as clients to find experts and ask them questions in exchange for a Lightning Network payment.

## Overview

This library provides an `Expert` class that encapsulates all the logic of the NIP-174 protocol, handling Nostr events and Lightning payments. It allows you to create your own expert by implementing two callback functions:

- `onAsk`: Called when a new ask is received, returns a bid if the expert wants to participate
- `onQuestion`: Called when a question is received, returns an answer to the question

## Installation

```bash
npm install libaskexperts
```

## Usage

```typescript
import { Expert } from 'libaskexperts';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nwc } from '@getalby/sdk';

// Create a wallet for generating invoices
const nwcClient = new nwc.NWCClient({ nostrWalletConnectUrl: "your-nwc-string" });

// Generate expert keypair
const expertPrivateKey = generateSecretKey();
const expertPublicKey = getPublicKey(expertPrivateKey);

// Create an expert instance
const expert = new Expert({
  nwcString,
  expertPrivkey: expertPrivateKey,
  askRelays: ["wss://relay.nostr.band", "wss://relay.damus.io"],
  questionRelays: ["wss://relay.nostr.band", "wss://relay.damus.io"],
  hashtags: ["ai", "programming"], // Listen for asks with these hashtags
  onAsk: async (ask) => {
    // Evaluate the ask and decide whether to bid
    return {
      content: "I can help with your programming question!",
      bid_sats: 100, // Charge 100 sats for an answer
    };
  },
  onQuestion: async (ask, bid, question) => {
    // Generate an answer to the question
    return {
      content: "Here's the answer to your question...",
    };
  },
  bidTimeout: 600, // 10 minutes
});

// Start the expert
expert.start();

// To stop the expert and clean up resources
expert[Symbol.dispose]();
```

## API

### Expert Class

```typescript
class Expert {
  constructor(params: ExpertParams);
  start(): void;
  [Symbol.dispose](): void;
}
```

### ExpertParams Interface

```typescript
interface ExpertParams {
  nwcString: string;
  expertPrivkey: Uint8Array;
  askRelays: string[];
  questionRelays: string[];
  hashtags: string[];
  onAsk: (ask: Ask) => Promise<Bid | undefined>;
  onQuestion: (ask: Ask, bid: Bid, question: Question) => Promise<Answer>;
  bidTimeout?: number;
}
```

## License

MIT
