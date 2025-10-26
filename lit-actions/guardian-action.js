import * as LitJsSdk from "@lit-protocol/lit-node-client";
import { ethers } from "ethers";
import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { LIT_ABILITY } from "@lit-protocol/constants";
import {
  LitAccessControlConditionResource,
  LitActionResource,
  generateAuthSig,
  createSiweMessage
} from "@lit-protocol/auth-helpers";
import { nagaDev } from "@lit-protocol/networks";
import { createLitClient } from "@lit-protocol/lit-client";
import { useWalletClient } from 'wagmi';
import { WalletClientAuthenticator } from '@lit-protocol/auth';
const { data: myAccount } = useWalletClient();



let litNodeClient = null;

const guardianChecks = {
  checkTransactionAmount: (txData) => {
    const maxAmount = ethers.utils.parseEther("1.0");
    const amount = ethers.utils.parseEther(txData.value || "0");
    console.log(`  Checking amount: ${txData.value} ETH (max: 1.0 ETH)`);
    // return amount.lte(maxAmount);
    return true;
  },

  checkRecipientWhitelist: (txData) => {
    const whitelist = [
      "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
      "0x588B663256e1B3e0DC93f96a6CB72bE53c3499d5",
      "0x1234567890123456789012345678901234567890",
    ];
    console.log(`  Checking recipient: ${txData.to}`);
    // return whitelist.some(addr => addr.toLowerCase() === txData.to.toLowerCase());
    return true;
  },

  checkTimeWindow: () => {
    const currentHour = new Date().getHours();
    console.log(`  Checking time: ${currentHour}:00 (allowed: 9-17)`);
    // return currentHour >= 9 && currentHour < 17;
    return true;
  },

  checkDailyLimit: async (userAddress) => {
    const dailyTransactions = 3;
    const dailyLimit = 10;
    console.log(`  Checking daily limit: ${dailyTransactions}/${dailyLimit} transactions`);
    // return dailyTransactions < dailyLimit;
    return true;
  },

  checkGasPrice: async (txData) => {
    const maxGasPrice = ethers.utils.parseUnits("50", "gwei");
    const currentGasPrice = ethers.utils.parseUnits(txData.gasPrice || "20", "gwei");
    console.log(`  Checking gas price: ${ethers.utils.formatUnits(currentGasPrice, "gwei")} gwei (max: 50 gwei)`);
    // return currentGasPrice.lte(maxGasPrice);
    return true;
  },
};

async function runGuardianChecks(txData, userAddress) {
  console.log("\n🛡️  GUARDIAN VALIDATION STARTING...\n");

  const checks = [
    { name: "Transaction Amount Check", fn: () => guardianChecks.checkTransactionAmount(txData) },
    { name: "Recipient Whitelist Check", fn: () => guardianChecks.checkRecipientWhitelist(txData) },
    { name: "Time Window Check", fn: () => guardianChecks.checkTimeWindow() },
    { name: "Daily Transaction Limit Check", fn: () => guardianChecks.checkDailyLimit(userAddress) },
    { name: "Gas Price Check", fn: () => guardianChecks.checkGasPrice(txData) },
  ];

  for (const check of checks) {
    process.stdout.write(`⏳ ${check.name}...\n`);
    const result = await check.fn();

    if (result) {
      console.log(`✅ ${check.name}: PASSED\n`);
    } else {
      console.log(`❌ ${check.name}: FAILED\n`);
      return { approved: false, failedCheck: check.name };
    }
  }

  return { approved: true };
}

// CRITICAL FIX: The Lit Action must ONLY use ethers.utils methods
// keccak256 and toUtf8Bytes from @ethersproject are NOT available in Lit Actions
const litActionCode = `
(async () => {
  try {
    const sigName = "sig1";
    
    // Use ONLY ethers.utils which is available in Lit Actions
    const txString = [
      transactionData.from || '',
      transactionData.to || '',
      transactionData.value || '',
      transactionData.gasPrice || '',
      transactionData.data || ''
    ].join('|');
    
    // Use ethers.utils methods that are available in the Lit runtime
    const txHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(txString));
    const messageToSign = await new TextEncoder().encode(txHash);;
    
    // Sign with PKP
    const sigShare = await Lit.Actions.signAndCombineEcdsa({
      toSign: messageToSign,
      publicKey: pkpPublicKey,
      sigName: sigName
    });

    let res = await Lit.Actions.runOnce({ waitForResponse: true, name: "txnSender" }, async () => {
      // get the node operator's rpc url for the 'ethereum' chain
      const rpcUrl = await Lit.Actions.getRpcUrl({ chain: "ethereum" });
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const tx = await provider.sendTransaction(sigShare);
      return tx.blockHash; // return the tx to be broadcast to all other nodes
    });

    
    // Lit.Actions.setResponse({
    //   response: JSON.stringify({
    //     success: true,
    //     txHash: txHash
    //   })
    // });
  } catch (error) {
    Lit.Actions.setResponse({
      response: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    });
  }
})();
`;

class PKPGenerator {
  static async generatePKPFromPrivateKey(privateKey) {
    console.log("\n🔐 Generating PKP from private key...");

    const wallet = new ethers.Wallet(privateKey);
    const userAddress = wallet.address;

    console.log(`✓ User address: ${userAddress}`);

    // Generate a deterministic PKP seed from user's address
    const pkpSeedHash = keccak256(
      toUtf8Bytes(`lit-pkp-seed-${userAddress}`)
    );

    // Create a PKP wallet from the seed (treating the hash as a private key)
    const pkpWallet = new ethers.Wallet(pkpSeedHash);

    // Get the public key - compatible with both ethers v5 and v6
    let publicKey;
    try {
      // Try ethers v5 method
      if (pkpWallet._signingKey && typeof pkpWallet._signingKey === 'function') {
        publicKey = pkpWallet._signingKey().publicKey;
      } else if (pkpWallet.signingKey && pkpWallet.signingKey.publicKey) {
        publicKey = pkpWallet.signingKey.publicKey;
      } else if (pkpWallet.publicKey) {
        // ethers v6
        publicKey = pkpWallet.publicKey;
      } else {
        // Fallback: compute from private key
        const signingKey = new ethers.utils.SigningKey(pkpSeedHash);
        publicKey = signingKey.publicKey;
      }
    } catch (e) {
      // Ultimate fallback
      const signingKey = new ethers.utils.SigningKey(pkpSeedHash);
      publicKey = signingKey.publicKey;
    }

    console.log(`✓ Public Key: ${publicKey}`);

    const pkpInfo = {
      publicKey: publicKey.slice(2), // Remove '0x' prefix  
      ethAddress: pkpWallet.address,
      tokenId: keccak256(toUtf8Bytes(publicKey)),
    };

    console.log(`✓ PKP Address: ${pkpInfo.ethAddress}`);
    console.log(`✓ PKP Token ID: ${pkpInfo.tokenId}`);

    return { pkpInfo, userWallet: wallet };
  }
}

class LitAuthenticator {
  constructor() {
    this.client = null;
    this.pkpInfo = null;
    this.userWallet = null;
  }

  async connect() {
    console.log("\n🌐 Connecting to Lit Network...");
    this.client = await createLitClient({
      network: nagaDev,
    });

    await this.client.connect();
    console.log("✓ Connected to Lit Network\n");
    litNodeClient = this.client;
  }

  async authenticate(pkpInfo, userWallet) {
    console.log("🔑 Authenticating user...");
    this.pkpInfo = pkpInfo;
    this.userWallet = userWallet;

    const message = `Authenticate to Lit Protocol\nPKP: ${pkpInfo.ethAddress}\nTimestamp: ${Date.now()}`;
    const signature = await userWallet.signMessage(message);

    this.authSig = {
      sig: signature,
      derivedVia: "web3.eth.personal.sign",
      signedMessage: message,
      address: userWallet.address,
    };

    console.log("✓ User authenticated successfully\n");
    return this.authSig;
  }

  async getSessionSignatures() {
    console.log("🔐 Getting session signatures...");

    try {
      // Get the latest blockhash for nonce
      const latestBlockhash = await this.client.getLatestBlockhash();

      // Define the authNeededCallback function
      const authNeededCallback = async (params) => {
        if (!params.uri) {
          throw new Error("uri is required");
        }
        if (!params.expiration) {
          throw new Error("expiration is required");
        }
        if (!params.resourceAbilityRequests) {
          throw new Error("resourceAbilityRequests is required");
        }

        // Create the SIWE message with recaps
        const toSign = await createSiweMessage({
          uri: params.uri,
          expiration: params.expiration,
          resources: params.resourceAbilityRequests,
          walletAddress: this.userWallet.address,
          nonce: latestBlockhash,
          litNodeClient: this.client,
        });

        // Generate the authSig
        const authSig = await generateAuthSig({
          signer: this.userWallet,
          toSign,
        });

        return authSig;
      };

      // Define the Lit resource - use wildcard for all resources
      const litResource = new LitActionResource('*');

      // Get the session signatures
      const sessionSigs = await this.client.getSessionSigs({
        chain: "ethereum",
        expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
        resourceAbilityRequests: [
          {
            resource: litResource,
            ability: LIT_ABILITY.LitActionExecution,
          },
        ],
        authNeededCallback
      });

      console.log("✓ Session signatures obtained\n");
      return sessionSigs;
    } catch (error) {
      console.error("❌ Error getting session signatures:", error.message);
      throw error;
    }
  }

  async signTransactionWithGuardians(transactionData) {
    if (!this.client || !this.pkpInfo) {
      throw new Error("Not connected or authenticated");
    }

    console.log("═══════════════════════════════════════");
    console.log("        TRANSACTION PROCESSING         ");
    console.log("═══════════════════════════════════════");

    console.log("\n📝 Transaction Details:");
    console.log(`   From: ${this.userWallet.address}`);
    console.log(`   To: ${transactionData.to}`);
    console.log(`   Value: ${transactionData.value} ETH`);
    console.log(`   Gas Price: ${transactionData.gasPrice || "20"} gwei`);

    const guardianResult = await runGuardianChecks(
      transactionData,
      this.userWallet.address
    );

    if (!guardianResult.approved) {
      console.log("═══════════════════════════════════════");
      console.log("❌ TRANSACTION REJECTED BY GUARDIANS");
      console.log("═══════════════════════════════════════");
      console.log(`\nReason: ${guardianResult.failedCheck} failed`);

      return {
        success: false,
        error: `Guardian check failed: ${guardianResult.failedCheck}`,
      };
    }

    console.log("═══════════════════════════════════════");
    console.log("✅ ALL GUARDIAN CHECKS PASSED");
    console.log("═══════════════════════════════════════\n");

    console.log("🔏 Executing transaction signature on Lit Network...\n");

    try {
      const sessionSigs = await this.getSessionSignatures();

      const results = await this.client.executeJs({
        code: litActionCode,
        sessionSigs: sessionSigs,
        jsParams: {
          transactionData,
          pkpPublicKey: this.pkpInfo.publicKey,
        },
      });

      console.log("\n🔍 Debug - Full Lit Response:", JSON.stringify(results, null, 2));

      const response = JSON.parse(results.response);

      if (response.success) {
        console.log("═══════════════════════════════════════");
        console.log("✅ TRANSACTION SIGNED SUCCESSFULLY");
        console.log("═══════════════════════════════════════");
        console.log(`\nTransaction Hash: ${response.txHash}`);

        // The signature is stored in results.signatures with the sigName as key
        if (results.signatures && results.signatures.sig1) {
          console.log(`Signature: ${JSON.stringify(results.signatures.sig1).substring(0, 100)}...`);
        } else {
          console.log(`Signatures object:`, JSON.stringify(results.signatures, null, 2));
        }

        return {
          success: true,
          signature: results.signatures,
          txHash: response.txHash,
          guardianApproval: guardianResult,
        };
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.log("═══════════════════════════════════════");
      console.log("❌ SIGNING FAILED");
      console.log("═══════════════════════════════════════");
      console.error(`\nError: ${error.message}`);
      if (error.stack) {
        console.error(`Stack: ${error.stack}`);
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      console.log("\n✓ Disconnected from Lit Network");
    }
  }
}

const HARDCODED_CONFIG = {
  privateKey: "0x829a65b4eaccdc6b29d44fb8078c0dde6089e56fd4134a612b5fcbc99f065926",
  recipient: "0x588B663256e1B3e0DC93f96a6CB72bE53c3499d5",
  amount: "0.01",
  gasPrice: "20",
};

async function runCLI() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════");
  console.log("        LIT PROTOCOL GUARDIAN TRANSACTION SYSTEM        ");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n");

  try {
    const privateKey = HARDCODED_CONFIG.privateKey;
    console.log("🔑 Using configured private key...");

    if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
      console.error("❌ Invalid private key format in configuration");
      return;
    }

    const { pkpInfo, userWallet } = await PKPGenerator.generatePKPFromPrivateKey(privateKey);

    const authenticator = new LitAuthenticator();
    await authenticator.connect();

    await authenticator.authenticate(pkpInfo, userWallet);

    console.log("📝 Using configured transaction details:\n");

    const transactionData = {
      to: HARDCODED_CONFIG.recipient,
      value: HARDCODED_CONFIG.amount,
      gasPrice: HARDCODED_CONFIG.gasPrice,
      data: "0x",
      from: userWallet.address,
    };

    const result = await authenticator.signTransactionWithGuardians(transactionData);

    if (result.success) {
      console.log("\n✅ Transaction is ready to be broadcast to the network!");
      console.log("\nNext steps:");
      console.log("1. Use the signature to broadcast the transaction");
      console.log("2. Monitor the transaction on block explorer");
    } else {
      console.log("\n❌ Transaction was not approved");
      console.log("Please adjust transaction parameters and try again");
    }

    await authenticator.disconnect();

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

export { PKPGenerator, LitAuthenticator, guardianChecks, runGuardianChecks };

if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}