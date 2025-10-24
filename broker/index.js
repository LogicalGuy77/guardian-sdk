// File: broker/index.js
const { WebSocketServer } = require('ws');

const WSS_PORT = 8080;
const PKP_GUARDIANS = ["pkp1", "pkp2", "pkp3", "pkp4"];
const THRESHOLD = 3; // 3 out of 4 must approve

// --- New DDoS Detection Logic ---
const clientMessageCounts = new Map();
const RATE_LIMIT_THRESHOLD = 10; // Max 10 messages
const RATE_LIMIT_WINDOW_MS = 1000; // per 1 second (10 req/sec)
// ---

const wss = new WebSocketServer({ port: WSS_PORT });

console.log(`Yellow Network Broker listening on ws://localhost:${WSS_PORT}`);

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`[BROKER] Client connected from IP: ${clientIP}`);

  // Initialize this IP in our tracking map
  if (!clientMessageCounts.has(clientIP)) {
    clientMessageCounts.set(clientIP, []);
  }

  ws.on('message', async (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());
      
      // Validate message structure (removed isAttack check)
      if (!message.data || !message.data.sender || !message.signature) {
        throw new Error("Invalid message format: missing required fields");
      }
      
      // --- New Rate Limit Check ---
      const now = Date.now();
      const timestamps = clientMessageCounts.get(clientIP) || [];
      
      // 1. Filter out timestamps older than our window
      const recentTimestamps = timestamps.filter(ts => (now - ts) < RATE_LIMIT_WINDOW_MS);
      
      // 2. Add the current message timestamp
      recentTimestamps.push(now);
      clientMessageCounts.set(clientIP, recentTimestamps);

      // 3. Check if the count exceeds the threshold
      const isRateLimited = recentTimestamps.length > RATE_LIMIT_THRESHOLD;
      if (isRateLimited) {
        console.log(`[BROKER] Rate limit active for IP ${clientIP}. Count: ${recentTimestamps.length}`);
      }
      // ---

      console.log(`[BROKER] Message received from: ${message.data.sender}`);
      
      // --- PKP Guardian Consultation (Simulated) ---
      // We now pass the rate-limit decision to the mock function
      const decisions = await consultPKPGuardians(message, isRateLimited);

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
        ws.send(JSON.stringify({
          status: "error",
          message: "Transaction rejected by guardians (Rate Limit). Dispute raised."
        }));
      }
    } catch (e) {
      console.error("[BROKER] Error processing message:", e.message);
      ws.send(JSON.stringify({ status: "error", message: "Invalid message format" }));
    }
  });

  ws.on('close', () => {
    console.log(`[BROKER] Client disconnected from IP: ${clientIP}`);
    // Optional: You could clear the IP from the map here,
    // but leaving it helps block IPs that reconnect quickly.
    // For a real app, this map would need a TTL eviction policy.
  });
});

/**
 * MOCK FUNCTION to simulate consulting PKP Guardians.
 * It now bases its decision on the broker's rate-limiting logic.
 */
async function consultPKPGuardians(message, isBlockedByRateLimit) {
  console.log("[BROKER] Consulting PKP Guardians in parallel...");
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  let decisions = [];

  // If the client was flagged by the broker's rate-limiter, simulate a BLOCK
  if (isBlockedByRateLimit) {
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