// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ArcologyDisputeResolver is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    /* ============ EVENTS ============ */
    event DisputeSubmitted(bytes32 indexed disputeId, address indexed attacker, bytes32 messageHash, uint256 timestamp);
    event DisputeResolved(bytes32 indexed disputeId, address indexed attacker, bool confirmed, uint256 slashedAmount);
    event PKPRegistered(address indexed pkp);
    event PKPUnregistered(address indexed pkp);
    event StakeDeposited(address indexed who, uint256 amount);
    event StakeWithdrawn(address indexed who, uint256 amount);
    event RewardsDistributed(bytes32 indexed disputeId, uint256 totalReward);

    /* ============ STRUCTS ============ */

    enum Decision { UNKNOWN, ALLOW, BLOCK }

    struct PKPDecision {
        address pkp;      // PKP address (registered)
        Decision decision; // ALLOW or BLOCK
        bytes signature;  // signature over the canonical payload (see verify)
    }

    struct Dispute {
        bytes32 disputeId;
        address attacker;
        bytes32 messageHash;
        uint256 timestamp;
        bool resolved;
        uint256 totalVotes;
        uint256 blockVotes;
        // We store minimal evidence on-chain (pkp addresses + decisions). Signatures are not stored to save gas,
        // but their validity is checked at submission time. The broker should keep the full evidence off-chain for audit.
    }

    /* ============ STORAGE ============ */

    // registry for allowed PKPs
    mapping(address => bool) public isPKP;

    // attacker stakes - collateral that can be slashed
    mapping(address => uint256) public stakes;

    // disputes storage
    mapping(bytes32 => Dispute) public disputes;

    // policy parameters
    uint256 public minBlockVotes;     // e.g., 3
    uint256 public minTotalPKPs;      // e.g., 4 (for checks)
    uint256 public slashAmountWei;    // fixed amount to slash per confirmed attack (could be dynamic)
    uint256 public slashPercent;      // alternative: percent (100 = 1%), use one of the above

    // governance: pool to receive leftover (e.g., small rounding)
    address public treasury;

    /* ============ CONSTRUCTOR ============ */

    constructor(
        uint256 _minTotalPKPs,
        uint256 _minBlockVotes,
        uint256 _slashAmountWei,
        uint256 _slashPercent,
        address _treasury
    ) {
        require(_minTotalPKPs > 0, "minTotalPKPs>0");
        require(_minBlockVotes > 0 && _minBlockVotes <= _minTotalPKPs, "invalid threshold");
        minTotalPKPs = _minTotalPKPs;
        minBlockVotes = _minBlockVotes;
        slashAmountWei = _slashAmountWei;
        slashPercent = _slashPercent; // set 0 to disable percent mode
        treasury = _treasury == address(0) ? owner() : _treasury;
    }

    /* ============ MODIFIERS ============ */

    modifier onlyRegisteredPKP(address _pkp) {
        require(isPKP[_pkp], "PKP not registered");
        _;
    }

    /* ============ PKP REGISTRY ============ */

    function registerPKP(address _pkp) external onlyOwner {
        require(_pkp != address(0), "zero pkp");
        require(!isPKP[_pkp], "already registered");
        isPKP[_pkp] = true;
        emit PKPRegistered(_pkp);
    }

    function unregisterPKP(address _pkp) external onlyOwner {
        require(isPKP[_pkp], "not registered");
        isPKP[_pkp] = false;
        emit PKPUnregistered(_pkp);
    }

    /* ============ STAKING ============ */

    /// @notice Deposit stake (attacker or any actor)
    function depositStake() external payable nonReentrant {
        require(msg.value > 0, "no eth");
        stakes[msg.sender] += msg.value;
        emit StakeDeposited(msg.sender, msg.value);
    }

    /// @notice Withdraw available stake (only if not slashed)
    function withdrawStake(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        uint256 bal = stakes[msg.sender];
        require(bal >= amount, "insufficient stake");
        stakes[msg.sender] = bal - amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit StakeWithdrawn(msg.sender, amount);
    }

    /* ============ DISPUTE SUBMISSION ============ */

    /**
     * @notice Submit a dispute with PKP decisions and signatures.
     * @param disputeId unique id (prefer keccak256 of evidence)
     * @param attacker address flagged as attacker
     * @param messageHash canonical message hash being disputed
     * @param pkpAddresses array of PKPs who signed decisions
     * @param decisions array of booleans: true => BLOCK, false => ALLOW
     * @param signatures array of bytes ECDSA signatures from PKPs
     */
    function submitDispute(
        bytes32 disputeId,
        address attacker,
        bytes32 messageHash,
        address[] calldata pkpAddresses,
        bool[] calldata decisions,
        bytes[] calldata signatures
    ) external nonReentrant {
        require(disputeId != bytes32(0), "zero id");
        require(attacker != address(0), "zero attacker");
        require(disputes[disputeId].disputeId == bytes32(0), "dispute exists");
        uint256 n = pkpAddresses.length;
        require(n > 0 && n == decisions.length && n == signatures.length, "array length mismatch");
        require(n >= minTotalPKPs, "not enough pkp votes");

        uint256 totalVotes = 0;
        uint256 blockVotes = 0;

        // Verify each PKP signature over canonical payload
        for (uint256 i = 0; i < n; i++) {
            address pkp = pkpAddresses[i];
            require(isPKP[pkp], "pkp not registered");

            // canonical payload to sign: keccak256(abi.encodePacked(disputeId, attacker, messageHash, decisions[i] ? 1 : 0, pkp))
            bytes32 payload = keccak256(abi.encodePacked(disputeId, attacker, messageHash, decisions[i] ? uint8(1) : uint8(0), pkp));
            address signer = payload.toEthSignedMessageHash().recover(signatures[i]);
            require(signer == pkp, "invalid signature");

            totalVotes += 1;
            if (decisions[i]) blockVotes += 1;
        }

        // store minimal dispute metadata on-chain
        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            attacker: attacker,
            messageHash: messageHash,
            timestamp: block.timestamp,
            resolved: false,
            totalVotes: totalVotes,
            blockVotes: blockVotes
        });

        emit DisputeSubmitted(disputeId, attacker, messageHash, block.timestamp);
    }

    /* ============ DISPUTE RESOLUTION ============ */

    /**
     * @notice Batch resolve disputes by id. Anyone can call this.
     * For each dispute:
     *  - verify it wasn't resolved
     *  - if blockVotes >= minBlockVotes -> slash attacker & distribute rewards
     *  - mark resolved and emit events
     * @param disputeIds array of dispute ids to resolve
     */
    function resolveDisputes(bytes32[] calldata disputeIds) external nonReentrant {
        uint256 len = disputeIds.length;
        require(len > 0, "zero disputes");

        for (uint256 i = 0; i < len; i++) {
            bytes32 id = disputeIds[i];
            Dispute storage d = disputes[id];
            if (d.disputeId == bytes32(0) || d.resolved) {
                // skip unknown or already resolved
                continue;
            }

            bool confirmed = false;
            uint256 slashed = 0;

            if (d.blockVotes >= minBlockVotes) {
                // Confirmed attack -> slash
                uint256 stake = stakes[d.attacker];
                // determine slashing amount
                if (slashPercent > 0 && stake > 0) {
                    slashed = (stake * slashPercent) / 10000; // slashPercent is basis points (e.g., 100 = 1%)
                } else if (slashAmountWei > 0) {
                    slashed = slashAmountWei <= stake ? slashAmountWei : stake;
                } else {
                    // fallback: slash 50% if nothing configured
                    slashed = (stake * 50) / 100;
                }

                if (slashed > 0) {
                    stakes[d.attacker] = stake - slashed;
                    // distribute slashed funds - in this simplified contract, we send entire slashed to treasury
                    // and emit RewardsDistributed. In practice, you may want to split to PKPs (requires mapping of voters)
                    (bool ok, ) = treasury.call{value: slashed}("");
                    if (!ok) {
                        // if transfer fails, hold funds in contract (rare); we still mark slashed amount
                    }
                }

                confirmed = true;
            }

            d.resolved = true;

            emit DisputeResolved(id, d.attacker, confirmed, slashed);
            if (confirmed && slashed > 0) {
                emit RewardsDistributed(id, slashed);
            }
        }
    }

    /* ============ ADMIN ============ */

    function setPolicyParams(
        uint256 _minTotalPKPs,
        uint256 _minBlockVotes,
        uint256 _slashAmountWei,
        uint256 _slashPercent
    ) external onlyOwner {
        require(_minTotalPKPs > 0, "minTotalPKPs>0");
        require(_minBlockVotes > 0 && _minBlockVotes <= _minTotalPKPs, "invalid threshold");
        minTotalPKPs = _minTotalPKPs;
        minBlockVotes = _minBlockVotes;
        slashAmountWei = _slashAmountWei;
        slashPercent = _slashPercent;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero");
        treasury = _treasury;
    }

    /* ============ VIEW HELPERS ============ */

    function disputeExists(bytes32 disputeId) external view returns (bool) {
        return disputes[disputeId].disputeId != bytes32(0);
    }

    receive() external payable {
        // accept ETH, used by treasury or accidental sends
    }
}
