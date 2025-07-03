import { Event } from "nostr-tools";
// Using any type for NWCClient since the import structure may vary

/**
 * Parameters for initializing an Expert
 */
export interface ExpertParams {
  /** NWC connection string for the lightning wallet */
  nwcString: string;
  
  /** Private key of the expert */
  expertPrivkey: Uint8Array;
  
  /** Relays to watch for new asks */
  askRelays: string[];
  
  /** Relays which will be returned in bids and watched for questions and used to send answers */
  questionRelays: string[];
  
  /** Hashtags to watch for ask events ("#t" filter if hashtags not empty) */
  hashtags: string[];
  
  /** 
   * Callback that expert class will call when new ask is received
   * Returns a Bid if expert wants to participate, otherwise undefined
   */
  onAsk: (ask: Ask) => Promise<Bid | undefined>;
  
  /**
   * Callback that expert class will call when a question is received
   * corresponding to one of the ask-bid pairs
   * Returns an Answer that will be sent back to the asker
   */
  onQuestion: (ask: Ask, bid: Bid, question: Question) => Promise<Answer>;
  
  /** Time in seconds after which the bid is considered expired even if paid (default: 600) */
  bidTimeout?: number;
}

/**
 * Represents an Ask event from a client
 */
export interface Ask {
  /** Event ID */
  id: string;
  
  /** Public key of the asker (session key) */
  pubkey: string;
  
  /** Content of the ask (summary of the question) */
  content: string;
  
  /** Timestamp of the ask */
  created_at: number;
  
  /** Tags of the ask (including hashtags) */
  tags: string[][];
}

/**
 * Represents a Bid from an expert
 */
export interface Bid {
  /** Content of the bid (offer text) */
  content: string;
  
  /** Amount in satoshis to charge for the answer */
  bid_sats: number;
  
  /** Additional tags for the bid payload */
  tags?: string[][];
}

/**
 * Represents a Question from a client
 */
export interface Question {
  /** Event ID */
  id: string;
  
  /** Content of the question */
  content: string;
  
  /** Payment preimage to verify payment */
  preimage: string;
  
  /** Additional tags */
  tags?: string[][];
}

/**
 * Represents an Answer from an expert
 */
export interface Answer {
  /** Content of the answer */
  content: string;
  
  /** Additional tags */
  tags?: string[][];
}

/**
 * Internal interface for tracking active bids
 */
export interface ActiveBid {
  /** The original ask event */
  askEvent: Event;
  
  /** The bid event sent by the expert */
  bidEvent: Event;
  
  /** The bid payload event */
  bidPayloadEvent: Event;
  
  /** The session pubkey of the asker */
  sessionPubkey: string;
  
  /** The payment hash for the invoice */
  paymentHash: string;
  
  /** Timestamp when the bid was created */
  timestamp: number;
  
  /** The subscription for listening to questions */
  subscription: any;
  
  /** The timeout ID for bid expiration */
  timeoutId: NodeJS.Timeout | null;
  
  /** The bid object returned by onAsk */
  bid: Bid;
}