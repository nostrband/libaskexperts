import { Expert, Ask, Bid, Question, Answer, QuestionAnswerPair } from "../src";
import { generateSecretKey, getPublicKey } from "nostr-tools";

// Default relays to connect to
const DEFAULT_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

/**
 * Test implementation of an expert using the Expert class
 */
import { createWallet } from "nwc-enclaved-utils";

async function runTestExpert() {
  console.log("Starting test expert...");

  // Create a wallet for generating invoices
  console.log("Creating wallet...");
  const { nwcString, lnAddress } = await createWallet();
  console.log("Wallet created with lnAddress:", lnAddress);

  // Generate expert keypair
  const expertPrivateKey = generateSecretKey();
  const expertPublicKey = getPublicKey(expertPrivateKey);
  console.log(`Expert pubkey: ${expertPublicKey}`);

  // Create an expert instance
  const expert = new Expert({
    nwcString,
    expertPrivkey: expertPrivateKey,
    askRelays: DEFAULT_RELAYS,
    questionRelays: DEFAULT_RELAYS,
    hashtags: ["test"], // Listen for asks with the "test" hashtag
    onAsk: handleAsk,
    onQuestion: handleQuestion,
    bidTimeout: 600, // 10 minutes
  });

  // Start the expert
  expert.start();
  console.log("Expert started, listening for asks...");

  // Keep the process running
  process.on("SIGINT", () => {
    console.log("Shutting down expert...");
    expert[Symbol.dispose]();
    process.exit(0);
  });

  /**
   * Handle an ask event
   *
   * @param ask The ask to handle
   * @returns A bid if the expert wants to participate, otherwise undefined
   */
  async function handleAsk(ask: Ask): Promise<Bid | undefined> {
    console.log(`Handling ask: ${JSON.stringify(ask)}`);

    // In a real implementation, you would evaluate the ask and decide whether to bid
    // For this test, we'll always bid 10 sats
    return {
      content:
        "I'm a test expert and I can provide a real answer to your question!",
      bid_sats: 10,
    };
  }

  /**
   * Handle a question event
   *
   * @param ask The original ask
   * @param bid The bid that was accepted
   * @param question The question to answer
   * @returns An answer to the question
   */
  async function handleQuestion(
    ask: Ask,
    bid: Bid,
    question: Question,
    history?: QuestionAnswerPair[]
  ): Promise<Answer> {
    console.log(`Handling question: ${JSON.stringify(question)}`);

    // Log history if available
    if (history && history.length > 0) {
      console.log(`Question history (${history.length} previous exchanges):`);
      history.forEach((pair, index) => {
        console.log(`Exchange ${index + 1}:`);
        console.log(`- Question: ${pair.question.content}`);
        console.log(`- Answer: ${pair.answer.content}`);
      });
    }

    // In a real implementation, you would generate a thoughtful answer based on the question
    // For this test, we'll just return a simple answer

    // If this is a first question, offer a followup option
    if (!history || history.length === 0) {
      return {
        content: `This is a test answer to your question: "${question.content}". In a real implementation, this would be a thoughtful response based on the expert's knowledge. You can ask a followup question if needed.`,
        followup_sats: 5, // Allow followup questions for 5 sats
      };
    } else {
      // For followup questions, don't offer another followup
      return {
        content: `This is a followup answer to your question: "${question.content}". I see we've had ${history.length} previous exchanges.`,
      };
    }
  }
}

// If this file is run directly, start the test expert
if (
  process.argv[1].endsWith("expert.test.ts") ||
  process.argv[1].endsWith("expert.test.js")
) {
  runTestExpert().catch((error) => {
    console.error("Error running test expert:", error);
    process.exit(1);
  });
}
