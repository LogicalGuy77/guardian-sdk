const hre = require("hardhat");
var frontendUtil = require('@arcologynetwork/frontend-util/utils/util')
const nets = require('../network.json');
const ProgressBar = require('progress');
const { ethers } = require("hardhat");

async function main() {
  accounts = await ethers.getSigners();
  const provider = new ethers.providers.JsonRpcProvider(nets[hre.network.name].url);
  const pkCreator = nets[hre.network.name].accounts[0]
  const signerCreator = new ethers.Wallet(pkCreator, provider);
  const txbase = 'benchmark/status/txs';
  frontendUtil.ensurePath(txbase);

  let i, tx;

  console.log('======start deploying contract======')
  const status_factory = await ethers.getContractFactory("Status");
  const status = await status_factory.deploy();
  await status.deployed();
  console.log(`Deployed Status Test at ${status.address}`)

  console.log('======start generating TXs calling storeStatus======')
  let accountsLength = accounts.length
  frontendUtil.ensurePath(txbase + '/status');
  const handle_status = frontendUtil.newFile(txbase + '/status/status.out');

  const bar = new ProgressBar('Generating Tx data [:bar] :percent :etas', {
    total: 100,
    width: 40,
    complete: '*',
    incomplete: ' ',
  });

  const percent = accountsLength / 100;
  let pk, signer;

  // Generate a mock transaction hash
  const mockTxHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test transaction"));
  
  for (i = 0; i < accountsLength; i++) {
    pk = nets[hre.network.name].accounts[i];
    signer = new ethers.Wallet(pk, provider);

    // Create guardian statuses - simulating multiple guardians voting on a transaction
    const guardianStatuses = [
      {
        guardian_id: i % 5, // Using modulo to cycle through 5 guardian IDs
        txHash: mockTxHash,
        approval: i % 2 === 0, // Alternating between approve and reject
        reason: i % 2 === 0 ? "Transaction approved" : "Transaction rejected"
      },
      {
        guardian_id: (i + 1) % 5,
        txHash: mockTxHash,
        approval: (i + 1) % 2 === 0,
        reason: (i + 1) % 2 === 0 ? "Transaction approved" : "Transaction rejected"
      },
      {
        guardian_id: (i + 2) % 5,
        txHash: mockTxHash,
        approval: (i + 2) % 2 === 0,
        reason: (i + 2) % 2 === 0 ? "Transaction approved" : "Transaction rejected"
      }
    ];

    // Store status
    tx = await status.connect(accounts[i]).populateTransaction.storeStatus(mockTxHash, guardianStatuses);
    await frontendUtil.writePreSignedTxFile(handle_status, signer, tx);

    if (i > 0 && i % percent == 0) {
      bar.tick(1);
    }
  }
  bar.tick(1);

  if (bar.complete) {
    console.log(`Test data generation completed: ${accountsLength}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });