// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;
import "@arcologynetwork/concurrentlib/lib/commutative/U256Cum.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

struct GuardianStatus {
  uint16 guardian_id;
  bytes32 txHash;
  bool approval;
  string reason;
}

struct TxStatus {
  bool txApproval;
  mapping(uint16 => GuardianStatus) guradianStatus;
}

contract Status {
  mapping(bytes32 => TxStatus) public txStatus;
  U256Cumulative totalTxVerified = new U256Cumulative(0, type(uint256).max);
  U256Cumulative totalBlockedTx = new U256Cumulative(0, type(uint256).max);

  event QueryTotalTxVerified(uint256 totalTxVerified);
  event QueryTotalBlockedTx(uint256 totalBlockedTx);

  error TxHashDoesNotMatch(bytes32 transactionTxHash, bytes32 statusTxHash);

  function storeStatus(
    bytes32 txHash,
    GuardianStatus [] calldata statuses
  ) external {
    uint16 numApproved = 0;
    TxStatus storage currStatus = txStatus[txHash];

    for(uint i=0; i < statuses.length; i++){
      if(statuses[i].txHash != txHash){
        revert TxHashDoesNotMatch(txHash, statuses[i].txHash);
      }

      if(statuses[i].approval){
        numApproved ++;
      }

      currStatus.guradianStatus[statuses[i].guardian_id] = statuses[i];
    }

    if(numApproved >= statuses.length / 2){
      currStatus.txApproval = true;
    }
    else{
      currStatus.txApproval = false;
      totalBlockedTx.add(1);
    }

    totalTxVerified.add(1);
  }

  function getTotalTxVerfied() external {
    emit QueryTotalTxVerified(totalTxVerified.get());
  }

  function getTotalBlockedTx() external {
    emit QueryTotalBlockedTx(totalBlockedTx.get());
  }
}