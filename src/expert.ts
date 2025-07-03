import {
  SimplePool,
  Event,
  Filter,
  UnsignedEvent,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  validateEvent,
  verifyEvent
} from "nostr-tools";
import {
  NOSTR_EVENT_KIND_ASK,
  NOSTR_EVENT_KIND_BID,
  NOSTR_EVENT_KIND_BID_PAYLOAD,
  NOSTR_EVENT_KIND_QUESTION,
  NOSTR_EVENT_KIND_ANSWER,
} from "./constants";
import * as sdk from "@getalby/sdk";
import {
  ExpertParams,
  Ask,
  Bid,
  Question,
  Answer,
  ActiveBid,
} from "./types";

/**
 * Expert class that implements the NIP-174 protocol
 * 
 * This class encapsulates all the logic of working with nostr and lightning payments
 * for experts who want to participate in the Ask Experts protocol.
 */
export class Expert {
  // Private properties
  private pool: SimplePool;
  private nwcClient: any; // Using any type for NWCClient
  private expertPrivkey: Uint8Array;
  private expertPubkey: string;
  private askRelays: string[];
  private questionRelays: string[];
  private hashtags: string[];
  private onAskCallback: (ask: Ask) => Promise<Bid | undefined>;
  private onQuestionCallback: (ask: Ask, bid: Bid, question: Question) => Promise<Answer>;
  private bidTimeout: number;
  private activeBids: Map<string, ActiveBid>;
  private subscriptions: any[];

  /**
   * Create a new Expert
   * 
   * @param params Configuration parameters for the expert
   */
  constructor({
    nwcString,
    expertPrivkey,
    askRelays,
    questionRelays,
    hashtags,
    onAsk,
    onQuestion,
    bidTimeout = 600 // Default 10 minutes
  }: ExpertParams) {
    this.nwcClient = new sdk.nwc.NWCClient({ nostrWalletConnectUrl: nwcString });
    this.expertPrivkey = expertPrivkey;
    this.expertPubkey = getPublicKey(expertPrivkey);
    this.askRelays = askRelays;
    this.questionRelays = questionRelays;
    this.hashtags = hashtags;
    this.onAskCallback = onAsk;
    this.onQuestionCallback = onQuestion;
    this.bidTimeout = bidTimeout;
    this.pool = new SimplePool();
    this.activeBids = new Map();
    this.subscriptions = [];
  }

  /**
   * Start listening for asks
   */
  public start(): void {
    // Create a filter for ask events
    const filter: Filter = {
      kinds: [NOSTR_EVENT_KIND_ASK],
      since: Math.floor(Date.now() / 1000) - 10, // Only get new events from now
    };

    // Add hashtag filter if hashtags are provided
    if (this.hashtags.length > 0) {
      filter["#t"] = this.hashtags;
    }

    // Subscribe to ask events
    const sub = this.pool.subscribeMany(this.askRelays, [filter], {
      onevent: (event: Event) => {
        // Basic validation before proceeding
        if (!validateEvent(event)) {
          console.error(`Invalid ask event: ${JSON.stringify(event)}`);
          return;
        }

        if (event.kind !== NOSTR_EVENT_KIND_ASK) {
          console.error(`Unexpected event kind: ${event.kind}, expected: ${NOSTR_EVENT_KIND_ASK}`);
          return;
        }

        this.handleAskEvent(event).catch(error => {
          console.error("Error handling ask event:", error);
        });
      },
      oneose: () => {
        console.log("End of stored events, now listening for new events in real-time");
      }
    });

    this.subscriptions.push(sub);
  }

  /**
   * Clean up resources when the expert is disposed
   */
  public [Symbol.dispose](): void {
    // Close all subscriptions
    for (const sub of this.subscriptions) {
      sub.close();
    }
    this.subscriptions = [];

    // Close all active bid subscriptions and clear timeouts
    for (const [_, bidInfo] of this.activeBids.entries()) {
      if (bidInfo.subscription) {
        bidInfo.subscription.close();
      }
      if (bidInfo.timeoutId) {
        clearTimeout(bidInfo.timeoutId);
      }
    }
    this.activeBids.clear();

    // Close all relay connections
    this.pool.close(this.askRelays);
    this.pool.close(this.questionRelays);
  }

  /**
   * Handle an ask event
   * 
   * @param askEvent The ask event to handle
   */
  private async handleAskEvent(askEvent: Event): Promise<void> {
    try {
      console.log(`Received ask event: ${JSON.stringify(askEvent)}`);

      // Check if the event kind is correct
      if (askEvent.kind !== NOSTR_EVENT_KIND_ASK) {
        console.error(`Unexpected event kind: ${askEvent.kind}, expected: ${NOSTR_EVENT_KIND_ASK}`);
        return;
      }

      // Convert the ask event to our Ask type
      const ask: Ask = {
        id: askEvent.id,
        pubkey: askEvent.pubkey,
        content: askEvent.content,
        created_at: askEvent.created_at,
        tags: askEvent.tags
      };

      // Call the onAsk callback to get a bid
      const bid = await this.onAskCallback(ask);

      // If no bid is returned, ignore this ask
      if (!bid) {
        console.log(`No bid returned for ask ${askEvent.id}, ignoring`);
        return;
      }

      // Generate a random keypair for the bid
      const bidPrivateKey = generateSecretKey();
      const bidPublicKey = getPublicKey(bidPrivateKey);

      // Generate an invoice for the bid amount
      const { invoice, payment_hash } = await this.nwcClient.makeInvoice({
        amount: bid.bid_sats * 1000, // Convert sats to millisats
        description: `Bid for ask ${askEvent.id}`,
      });

      console.log(`Generated invoice: ${invoice}`);
      console.log(`Payment hash: ${payment_hash}`);

      // Create the bid payload event
      const bidPayload: UnsignedEvent = {
        kind: NOSTR_EVENT_KIND_BID_PAYLOAD,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.expertPubkey,
        content: bid.content,
        tags: [
          ["invoice", invoice],
          ...this.questionRelays.map(relay => ["relay", relay]),
          ...(bid.tags || [])
        ],
      };

      // Sign the bid payload
      const signedBidPayload = finalizeEvent(bidPayload, this.expertPrivkey);
      console.log(`Created bid payload: ${JSON.stringify(signedBidPayload)}`);

      // Encrypt the bid payload for the ask pubkey
      let encryptedContent;
      try {
        // Generate the conversation key for encryption
        const conversationKey = nip44.getConversationKey(
          bidPrivateKey,
          askEvent.pubkey
        );

        // Convert payload to string
        const payloadString = JSON.stringify(signedBidPayload);

        // Encrypt using the conversation key
        encryptedContent = nip44.encrypt(payloadString, conversationKey);
      } catch (error) {
        console.error("Error encrypting bid payload:", error);
        throw error;
      }

      // Create the bid event
      const bidEvent: UnsignedEvent = {
        kind: NOSTR_EVENT_KIND_BID,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: bidPublicKey,
        content: encryptedContent,
        tags: [["e", askEvent.id]],
      };

      // Sign the bid event
      const signedBidEvent = finalizeEvent(bidEvent, bidPrivateKey);
      console.log(`Created bid event: ${JSON.stringify(signedBidEvent)}`);

      // Publish the bid event to the relays
      try {
        // pool.publish returns an array of promises - one for each relay
        const publishPromises = this.pool.publish(this.askRelays, signedBidEvent);

        // Wait for all promises to resolve
        const results = await Promise.allSettled(publishPromises);

        // Check results
        const successful = results.filter(
          (result) => result.status === "fulfilled"
        ).length;
        const failed = results.filter(
          (result) => result.status === "rejected"
        ).length;

        console.log(
          `Bid published to ${successful} relays, failed on ${failed} relays`
        );

        if (successful > 0) {
          console.log(`Bid published successfully`);

          // Set up a subscription for questions related to this bid
          this.setupQuestionSubscription(askEvent, signedBidEvent, signedBidPayload, payment_hash, bid);
        } else {
          console.error(`Failed to publish bid to any relay`);
        }
      } catch (error) {
        console.error(`Failed to publish bid: ${error}`);
      }
    } catch (error) {
      console.error("Error handling ask event:", error);
    }
  }

  /**
   * Set up a subscription for questions related to a bid
   * 
   * @param askEvent The original ask event
   * @param bidEvent The bid event
   * @param bidPayloadEvent The bid payload event
   * @param paymentHash The payment hash for the invoice
   * @param bid The bid object returned by onAsk
   */
  private setupQuestionSubscription(
    askEvent: Event,
    bidEvent: Event,
    bidPayloadEvent: Event,
    paymentHash: string,
    bid: Bid
  ): void {
    // Create a filter for question events that tag our bid payload ID
    const filter: Filter = {
      kinds: [NOSTR_EVENT_KIND_QUESTION],
      "#e": [bidPayloadEvent.id],
    };

    // Subscribe to question events
    const subscription = this.pool.subscribeMany(this.questionRelays, [filter], {
      onevent: async (questionEvent: Event) => {
        try {
          console.log(
            `Received question event for bid payload ${bidPayloadEvent.id}: ${JSON.stringify(
              questionEvent
            )}`
          );

          // Get the active bid from the map
          const activeBid = this.activeBids.get(bidPayloadEvent.id);
          
          if (!activeBid) {
            console.error(`No active bid found for bid payload ${bidPayloadEvent.id}`);
            return;
          }

          // Handle the question
          await this.handleQuestionEvent(questionEvent, activeBid);
        } catch (error) {
          console.error(`Error handling question event: ${error}`);
        }
      },
      oneose: () => {
        console.log(
          `End of stored events for bid payload ${bidPayloadEvent.id}, now listening for new events`
        );
      },
    });

    // Set a timeout for the bid
    const timeoutId = setTimeout(() => {
      console.log(
        `Timeout reached for bid payload ${bidPayloadEvent.id}, closing subscription`
      );
      subscription.close();
      this.activeBids.delete(bidPayloadEvent.id);
    }, this.bidTimeout * 1000);

    // Store the active bid
    this.activeBids.set(bidPayloadEvent.id, {
      askEvent,
      bidEvent,
      bidPayloadEvent,
      sessionPubkey: askEvent.pubkey,
      paymentHash,
      timestamp: Math.floor(Date.now() / 1000),
      subscription,
      timeoutId,
      bid
    });
  }

  /**
   * Handle a question event
   * 
   * @param questionEvent The question event to handle
   * @param activeBid The active bid associated with this question
   */
  private async handleQuestionEvent(questionEvent: Event, activeBid: ActiveBid): Promise<void> {
    try {
      // Check if the event kind is correct
      if (questionEvent.kind !== NOSTR_EVENT_KIND_QUESTION) {
        console.error(`Unexpected event kind: ${questionEvent.kind}, expected: ${NOSTR_EVENT_KIND_QUESTION}`);
        return;
      }

      // Check if the question event tags the correct bid payload
      const eTag = questionEvent.tags.find(tag => tag[0] === 'e');
      if (!eTag || eTag[1] !== activeBid.bidPayloadEvent.id) {
        console.error(`Question event does not tag the correct bid payload: ${JSON.stringify(questionEvent)}`);
        return;
      }

      // Decrypt the question content
      let questionPayload;
      try {
        // Generate the conversation key for decryption
        const conversationKey = nip44.getConversationKey(
          this.expertPrivkey,
          activeBid.sessionPubkey
        );

        // Decrypt the question content
        const decryptedContent = nip44.decrypt(
          questionEvent.content,
          conversationKey
        );
        questionPayload = JSON.parse(decryptedContent);
        console.log(
          `Decrypted question: ${JSON.stringify(questionPayload)}`
        );
      } catch (error) {
        console.error(`Failed to decrypt question: ${error}`);
        throw error;
      }

      // Extract the preimage from the question payload
      const preimage = questionPayload.tags.find(
        (tag: string[]) => tag[0] === "preimage"
      )?.[1];

      if (!preimage) {
        console.error(`No preimage found in question payload`);
        throw new Error(`No preimage found in question payload`);
      }

      // Look up the invoice to check if it's been paid
      console.log(`Looking up invoice with payment_hash: ${activeBid.paymentHash}`);
      const invoiceStatus = await this.nwcClient.lookupInvoice({
        payment_hash: activeBid.paymentHash
      });

      console.log(`Invoice status: ${JSON.stringify(invoiceStatus)}`);

      // Check if the invoice has been settled (paid)
      if (!invoiceStatus.settled_at || invoiceStatus.settled_at <= 0) {
        console.log(`Invoice for bid payload ${activeBid.bidPayloadEvent.id} has not been paid, ignoring question`);
        throw new Error(`Invoice for bid payload ${activeBid.bidPayloadEvent.id} has not been paid, ignoring question`);
      }

      console.log(`Invoice for bid payload ${activeBid.bidPayloadEvent.id} has been paid, proceeding with answer`);

      // Create a Question object
      const question: Question = {
        id: questionEvent.id,
        content: questionPayload.content,
        preimage,
        tags: questionPayload.tags
      };

      // Call the onQuestion callback to get an answer
      const answer = await this.onQuestionCallback(
        {
          id: activeBid.askEvent.id,
          pubkey: activeBid.askEvent.pubkey,
          content: activeBid.askEvent.content,
          created_at: activeBid.askEvent.created_at,
          tags: activeBid.askEvent.tags
        },
        activeBid.bid,
        question
      );

      // Create the answer payload
      const answerPayload = {
        content: answer.content,
        tags: answer.tags || [],
      };

      // Encrypt the answer payload for the question pubkey
      const answerConversationKey = nip44.getConversationKey(
        this.expertPrivkey,
        activeBid.sessionPubkey
      );
      const encryptedAnswerContent = nip44.encrypt(
        JSON.stringify(answerPayload),
        answerConversationKey
      );

      // Generate a random keypair for the answer
      const answerPrivateKey = generateSecretKey();
      const answerPublicKey = getPublicKey(answerPrivateKey);

      // Create the answer event
      const answerEvent: UnsignedEvent = {
        kind: NOSTR_EVENT_KIND_ANSWER,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: answerPublicKey,
        content: encryptedAnswerContent,
        tags: [["e", questionEvent.id]],
      };

      // Sign the answer event
      const signedAnswerEvent = finalizeEvent(
        answerEvent,
        answerPrivateKey
      );
      console.log(
        `Created answer event: ${JSON.stringify(signedAnswerEvent)}`
      );

      // Publish the answer event
      const publishPromises = this.pool.publish(
        this.questionRelays,
        signedAnswerEvent
      );
      const results = await Promise.allSettled(publishPromises);

      const successful = results.filter(
        (result) => result.status === "fulfilled"
      ).length;
      const failed = results.filter(
        (result) => result.status === "rejected"
      ).length;

      console.log(
        `Answer published to ${successful} relays, failed on ${failed} relays`
      );

      // Clean up
      if (activeBid.timeoutId) {
        clearTimeout(activeBid.timeoutId);
      }
      if (activeBid.subscription) {
        activeBid.subscription.close();
      }

      // Remove the active bid
      this.activeBids.delete(activeBid.bidPayloadEvent.id);
    } catch (error) {
      console.error(`Error handling question event: ${error}`);
    }
  }
}