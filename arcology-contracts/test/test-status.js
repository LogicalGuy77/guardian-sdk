const hre = require("hardhat");
var frontendUtil = require('@arcologynetwork/frontend-util/utils/util');
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function main() {
    const accounts = await ethers.getSigners();
    const mockTxHash = ethers.keccak256(ethers.toUtf8Bytes("0x123")); // Example transaction hash

    console.log('======start deploying contract======');
    const status_factory = await ethers.getContractFactory("Status");
    const status = await status_factory.deploy();
    console.log(`Deployed Status contract at ${status.address}`);

    // Test case 1: Store status with majority approval
    console.log('======Testing majority approval case======');
    const approvedStatuses = [
        {
            guardian_id: 1,
            txHash: mockTxHash,
            approval: true,
            reason: "Valid transaction"
        },
        {
            guardian_id: 2,
            txHash: mockTxHash,
            approval: true,
            reason: "Valid transaction"
        },
        {
            guardian_id: 3,
            txHash: mockTxHash,
            approval: false,
            reason: "Suspicious activity"
        }
    ];

    await frontendUtil.waitingTxs([
        frontendUtil.generateTx(function([status, from]) {
            return status.connect(from).storeStatus(mockTxHash, approvedStatuses);
        }, status, accounts[0])
    ]);

    // Test case 2: Store status with majority rejection
    console.log('======Testing majority rejection case======');
    const rejectedTxHash = ethers.keccak256(ethers.toUtf8Bytes("0x456"));
    const rejectedStatuses = [
        {
            guardian_id: 1,
            txHash: rejectedTxHash,
            approval: false,
            reason: "Suspicious pattern"
        },
        {
            guardian_id: 2,
            txHash: rejectedTxHash,
            approval: false,
            reason: "Invalid signature"
        },
        {
            guardian_id: 3,
            txHash: rejectedTxHash,
            approval: true,
            reason: "Looks valid"
        }
    ];

    await frontendUtil.waitingTxs([
        frontendUtil.generateTx(function([status, from]) {
            return status.connect(from).storeStatus(rejectedTxHash, rejectedStatuses);
        }, status, accounts[0])
    ]);

    // Test case 3: Query totals
    console.log('======Testing total queries======');
    await frontendUtil.waitingTxs([
        frontendUtil.generateTx(function([status, from]) {
            return status.connect(from).getTotalTxVerfied();
        }, status, accounts[0]),
        frontendUtil.generateTx(function([status, from]) {
            return status.connect(from).getTotalBlockedTx();
        }, status, accounts[0])
    ]);

    // Test case 4: Try submitting mismatched txHash (should fail)
    console.log('======Testing txHash mismatch======');
    const mismatchedStatuses = [
        {
            guardian_id: 1,
            txHash: ethers.keccak256(ethers.toUtf8Bytes("0x789")), // Different hash
            approval: true,
            reason: "Valid transaction"
        }
    ];

    try {
        await frontendUtil.waitingTxs([
            frontendUtil.generateTx(function([status, from]) {
                return status.connect(from).storeStatus(mockTxHash, mismatchedStatuses);
            }, status, accounts[0])
        ]);
    } catch (error) {
        console.log("Expected error caught: TxHash mismatch");
    }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});