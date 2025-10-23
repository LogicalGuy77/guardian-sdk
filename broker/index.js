const { WebSocketServer } = require('ws');

const WSS_PORT = 8080;
const PKP_GUARDIANS = ["pkp1", "pkp2", "pkp3", "pkp4"];
const THRESHOLD = 3; // 3 out of 4 must approve

const wss = new WebSocketServer({ port: WSS_PORT });

console.log(`Yellow Network Broker listening on ws://localhost:${WSS_PORT}`);

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`[BROKER] Client connected from IP: ${clientIP}`);

  ws.on('message', async (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());
      
      // Debug: log the received message structure
      console.log(`\n[BROKER] Raw message received:`, JSON.stringify(message, null, 2));
      
      // Validate message structure
      if (!message.data || !message.data.sender || !message.signature) {
        console.error("[BROKER] Message validation failed. Structure:", {
          hasData: !!message.data,
          hasSender: !!(message.data && message.data.sender),
          hasSignature: !!message.signature
        });
        throw new Error("Invalid message format: missing required fields");
      }
      
      console.log(`[BROKER] Message received from: ${message.data.sender}`);
      
      // --- PKP Guardian Consultation (Simulated) ---
      // This is where you would use the Lit SDK to call the 4 PKPs
      // For this demo, we'll just mock the responses.
      const decisions = await consultPKPGuardians(message);

      // --- Consensus Check ---
      const approvals = decisions.filter(d => d.decision === "ALLOW");
      console.log(`[BROKER] PKP Consensus: ${approvals.length}/${PKP_GUARDIANS.length} approved.`);

      if (approvals.length >= THRESHOLD) {
        // --- Happy Path ---
        console.log("[BROKER] ✅ Processing message in state channel.");
        ws.send(JSON.stringify({
          status: "success",
          message: "Transaction processed off-chain"
        }));
      } else {
        // --- Dispute Path ---
        console.log("[BROKER] ❌ Rejected. Submitting to Arcology for dispute resolution.");
        // This is where you would call the Arcology contract
        // await submitToArcology(message, decisions);
        ws.send(JSON.stringify({
          status: "error",
          message: "Transaction rejected by guardians. Dispute raised."
        }));
      }
    } catch (e) {
      console.error("[BROKER] Error processing message:", e.message);
      ws.send(JSON.stringify({ status: "error", message: "Invalid message format" }));
    }
  });
});

/**
 * MOCK FUNCTION to simulate consulting PKP Guardians.
 * In a real app, this would use the Lit Protocol SDK to execute
 * the code in `lit-actions/guardian-action.js` on 4 nodes.
 */
async function consultPKPGuardians(message) {
  console.log("[BROKER] Consulting PKP Guardians in parallel...");
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  let decisions = [];

  // If the client sent a message with `isAttack: true`, simulate a BLOCK
  if (message.data.isAttack) {
    decisions = [
      { decision: "ALLOW", pkp: "pkp1" }, // 1 says ALLOW
      { decision: "BLOCK", pkp: "pkp2" }, // 3 say BLOCK
      { decision: "BLOCK", pkp: "pkp3" },
      { decision: "BLOCK", pkp: "pkp4" }
    ];
  } else {
    // Otherwise, simulate a clean pass
    decisions = [
      { decision: "ALLOW", pkp: "pkp1" },
      { decision: "ALLOW", pkp: "pkp2" },
      { decision: "ALLOW", pkp: "pkp3" },
      { decision: "ALLOW", pkp: "pkp4" }
    ];
  }

  return decisions;
}

// async function submitToArcology(message, decisions) {
//   // const provider = new ethers.providers.JsonRpcProvider(ARCOLOGY_RPC_URL);
//   // const signer = new ethers.Wallet(BROKER_PRIVATE_KEY, provider);
//   // const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
//   // const disputeData = formatDispute(message, decisions);
//   // await contract.submitDisputes([disputeData]);
//   console.log("[ARCOLOGY] (Simulated) Dispute transaction sent.");
// }