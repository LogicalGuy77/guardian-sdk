// File: client_flood_attack.js
const WebSocket = require('ws');
const { ethers } = require('ethers');

// --- Setup ---
const BROKER_URL = 'ws://localhost:8080';
const ws = new WebSocket(BROKER_URL);
const attackerWallet = ethers.Wallet.createRandom();

// --- Config ---
// Set higher than the broker's 10 msg/sec threshold
const MESSAGES_PER_SECOND = 50; 
const DURATION_SECONDS = 10;
const MESSAGE_INTERVAL = 1000 / MESSAGES_PER_SECOND; // ~20ms

console.log(`[ATTACK CLIENT] Attacker Address: ${attackerWallet.address}`);
console.log(`[ATTACK CLIENT] Connecting to broker at ${BROKER_URL}...`);

let messageCount = 0;
let floodInterval;

ws.on('open', async () => {
  console.log(`[ATTACK CLIENT] Connected. Starting flood: ${MESSAGES_PER_SECOND} msgs/sec for ${DURATION_SECONDS} sec.`);
  
  floodInterval = setInterval(async () => {
    messageCount++;
    console.log(`[ATTACK CLIENT] Sending attack message #${messageCount}`);
    
    // Create and send the message
    const attackMsg = await createMessage(attackerWallet, 1);
    await sendMessage(attackMsg);

  }, MESSAGE_INTERVAL);

  // Stop the attack after the specified duration
  setTimeout(() => {
    clearInterval(floodInterval);
    const totalMessages = MESSAGES_PER_SECOND * DURATION_SECONDS;
    console.log(`[ATTACK CLIENT] Flood finished. Sent ~${totalMessages} messages.`);
    ws.close();
  }, DURATION_SECONDS * 1000);
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  // We expect to get a stream of "error" responses
  console.log('[ATTACK CLIENT] RESPONSE FROM BROKER:', response);
});

ws.on('close', () => console.log('[ATTACK CLIENT] Disconnected from broker.'));
ws.on('error', (err) => console.error('[ATTACK CLIENT] WebSocket Error:', err.message));

// --- Helper Functions ---

async function createMessage(wallet, amount) {
  const messageData = {
    type: "app_session_message",
    appSessionId: "0xdef456...",
    sender: wallet.address,
    recipient: "0xBob...",
    amount: amount.toString(),
    timestamp: Date.now(),
    nonce: Math.floor(Math.random() * 10000)
  };
  const messageString = JSON.stringify(messageData);
  const signature = await wallet.signMessage(messageString);
  return { data: messageData, signature: signature };
}

async function sendMessage(signedMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(signedMessage));
  }
}