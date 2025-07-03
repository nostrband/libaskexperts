/**
 * Nostr event kinds as defined in NIP-174
 */

// Ask event (client publishes a summary of their question with hashtags)
export const NOSTR_EVENT_KIND_ASK = 20174;

// Bid event (expert responds to an ask with an encrypted offer)
export const NOSTR_EVENT_KIND_BID = 20175;

// Bid payload event (the content of the bid, encrypted in the bid event)
export const NOSTR_EVENT_KIND_BID_PAYLOAD = 20176;

// Question event (client sends an encrypted question to an expert)
export const NOSTR_EVENT_KIND_QUESTION = 20177;

// Answer event (expert sends an encrypted answer to a client)
export const NOSTR_EVENT_KIND_ANSWER = 20178;