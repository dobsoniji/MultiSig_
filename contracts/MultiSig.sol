pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MultiSigZama is ZamaEthereumConfig {
    struct Transaction {
        euint32 encryptedAmount;
        uint256 nonce;
        address to;
        address[] signers;
        uint256 approvalCount;
        bool executed;
    }

    mapping(uint256 => Transaction) public transactions;
    uint256[] public transactionIds;
    mapping(address => bool) public isSigner;
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    event TransactionCreated(uint256 indexed id, address indexed creator);
    event TransactionApproved(uint256 indexed id, address indexed approver);
    event TransactionExecuted(uint256 indexed id);

    modifier onlySigner() {
        require(isSigner[msg.sender], "Not authorized signer");
        _;
    }

    constructor(address[] memory _signers) ZamaEthereumConfig() {
        for (uint i = 0; i < _signers.length; i++) {
            isSigner[_signers[i]] = true;
        }
    }

    function createTransaction(
        externalEuint32 _encryptedAmount,
        bytes calldata _inputProof,
        address _to
    ) external onlySigner returns (uint256) {
        require(FHE.isInitialized(FHE.fromExternal(_encryptedAmount, _inputProof)), "Invalid encrypted amount");

        uint256 transactionId = block.timestamp;
        euint32 encryptedAmount = FHE.fromExternal(_encryptedAmount, _inputProof);

        Transaction storage txn = transactions[transactionId];
        txn.encryptedAmount = encryptedAmount;
        txn.nonce = 0;
        txn.to = _to;
        txn.signers = new address[](0);
        txn.approvalCount = 0;
        txn.executed = false;

        FHE.allowThis(txn.encryptedAmount);
        FHE.makePubliclyDecryptable(txn.encryptedAmount);

        transactionIds.push(transactionId);
        emit TransactionCreated(transactionId, msg.sender);
        return transactionId;
    }

    function approveTransaction(uint256 _transactionId) external onlySigner {
        Transaction storage txn = transactions[_transactionId];
        require(!txn.executed, "Transaction already executed");
        require(!hasApproved[_transactionId][msg.sender], "Already approved");

        txn.approvalCount++;
        txn.signers.push(msg.sender);
        hasApproved[_transactionId][msg.sender] = true;

        emit TransactionApproved(_transactionId, msg.sender);

        if (txn.approvalCount >= getSignerThreshold()) {
            executeTransaction(_transactionId);
        }
    }

    function executeTransaction(uint256 _transactionId) private {
        Transaction storage txn = transactions[_transactionId];
        require(!txn.executed, "Transaction already executed");
        require(txn.approvalCount >= getSignerThreshold(), "Insufficient approvals");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(txn.encryptedAmount);

        bytes memory amountProof = FHE.getDecryptionProof(cts);
        uint32 decryptedAmount = FHE.decrypt(txn.encryptedAmount, amountProof);

        payable(txn.to).transfer(decryptedAmount);
        txn.executed = true;

        emit TransactionExecuted(_transactionId);
    }

    function getSignerThreshold() public view returns (uint256) {
        uint256 signerCount = 0;
        for (uint i = 0; i < transactionIds.length; i++) {
            if (isSigner[transactions[transactionIds[i]].signers[i]]) {
                signerCount++;
            }
        }
        return (signerCount * 60) / 100; // 60% threshold
    }

    function getTransaction(uint256 _transactionId) external view returns (
        euint32 encryptedAmount,
        uint256 nonce,
        address to,
        address[] memory signers,
        uint256 approvalCount,
        bool executed
    ) {
        Transaction storage txn = transactions[_transactionId];
        return (
            txn.encryptedAmount,
            txn.nonce,
            txn.to,
            txn.signers,
            txn.approvalCount,
            txn.executed
        );
    }

    function getAllTransactionIds() external view returns (uint256[] memory) {
        return transactionIds;
    }

    function isSigner(address _address) external view returns (bool) {
        return isSigner[_address];
    }

    function hasApprovedTransaction(uint256 _transactionId, address _signer) external view returns (bool) {
        return hasApproved[_transactionId][_signer];
    }
}


