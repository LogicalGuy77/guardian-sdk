const WebSocket = require('ws');
const { ethers } = require('ethers');

// --- Setup ---
const BROKER_URL = 'ws://localhost:8080';
const ws = new WebSocket(BROKER_URL);

// Create a new random wallet for Alice
const aliceWallet = ethers.Wallet.createRandom();
console.log(`Client (Alice) Address: ${aliceWallet.address}`);

ws.on('open', async () => {
  console.log('Connected to Yellow Network Broker.\n');
  
  // 1. Send a LEGITIMATE message
  const legitimateMsg = await createMessage(aliceWallet, 10, false);
  await sendMessage(legitimateMsg);
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 2. Send an ATTACK message
  console.log("\nSending a simulated ATTACK message...");
  const attackMsg = await createMessage(aliceWallet, 1, true);
  await sendMessage(attackMsg);
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  console.log('RESPONSE FROM BROKER:', response);
});

ws.on('close', () => {
  console.log('Disconnected from broker.');
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err.message);
});

/**
 * Creates and signs a new message
 */
async function createMessage(wallet, amount, isAttack) {
  const messageData = {
    type: "app_session_message",
    appSessionId: "0xabc123...",
    sender: wallet.address,
    recipient: "0xBob...",
    amount: amount.toString(),
    timestamp: Date.now(),
    nonce: Math.floor(Math.random() * 10000),
    isAttack: isAttack // Simple flag for our demo
  };

  // Sign the JSON stringified message data
  const messageString = JSON.stringify(messageData);
  const signature = await wallet.signMessage(messageString);
  
  return {
    data: messageData,
    signature: signature
  };
}

/**
 * Sends the message to the broker
 */
async function sendMessage(signedMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(signedMessage));
  } else {
    console.log("WebSocket not open. Waiting...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    await sendMessage(signedMessage);
  }
}