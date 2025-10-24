// File: client_valid.js
const WebSocket = require('ws');
const { ethers } = require('ethers');

// --- Setup ---
const BROKER_URL = 'ws://localhost:8080';
const ws = new WebSocket(BROKER_URL);
const aliceWallet = ethers.Wallet.createRandom();

console.log(`[VALID CLIENT] Client Address: ${aliceWallet.address}`);
console.log(`[VALID CLIENT] Connecting to broker at ${BROKER_URL}...`);

ws.on('open', async () => {
  console.log('[VALID CLIENT] Connected. Sending a LEGITIMATE message...');
  
  // Create and send a single message
  const legitimateMsg = await createMessage(aliceWallet, 10);
  await sendMessage(legitimateMsg);
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  console.log('[VALID CLIENT] RESPONSE FROM BROKER:', response);
  ws.close(); // Close after success
});

ws.on('close', () => console.log('[VALID CLIENT] Disconnected from broker.'));
ws.on('error', (err) => console.error('[VALID CLIENT] WebSocket Error:', err.message));

// --- Helper Functions ---

async function createMessage(wallet, amount) {
  const messageData = {
    type: "app_session_message",
    appSessionId: "0xabc123...",
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