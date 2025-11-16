import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TransactionData {
  id: string;
  name: string;
  amount: number;
  participants: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTransaction, setCreatingTransaction] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTransactionData, setNewTransactionData] = useState({ 
    name: "", 
    amount: "", 
    participants: "" 
  });
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    verified: 0,
    totalAmount: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        console.error('FHEVM init failed:', error);
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadTransactions();
      } catch (error) {
        console.error('Load failed:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const loadTransactions = async () => {
    if (!isConnected) return;
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const transactionsList: TransactionData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          transactionsList.push({
            id: businessId,
            name: businessData.name,
            amount: 0,
            participants: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading data:', e);
        }
      }
      
      setTransactions(transactionsList);
      updateStats(transactionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Load failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (txs: TransactionData[]) => {
    const total = txs.length;
    const verified = txs.filter(tx => tx.isVerified).length;
    const totalAmount = txs.reduce((sum, tx) => sum + (tx.decryptedValue || 0), 0);
    setStats({ total, verified, totalAmount });
  };

  const createTransaction = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTransaction(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      
      const amountValue = parseInt(newTransactionData.amount) || 0;
      const businessId = `tx-${Date.now()}`;
      
      const contractAddress = await contract.getAddress();
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTransactionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTransactionData.participants) || 0,
        0,
        "Multi-Sig Transaction"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadTransactions();
      setShowCreateModal(false);
      setNewTransactionData({ name: "", amount: "", participants: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("rejected") 
        ? "Rejected" 
        : "Failed: " + (e.message || "Error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTransaction(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      const contractAddress = await contractRead.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadTransactions();
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadTransactions();
        return null;
      }
      setTransactionStatus({ visible: true, status: "error", message: "Decrypt failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Available: " + result });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = tx.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         tx.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || tx.isVerified;
    return matchesSearch && matchesFilter;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Multi-Sig 🔐</h1>
          </div>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Wallet</h2>
            <p>Connect to access encrypted multi-signature system</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Multi-Sig 🔐</h1>
        </div>
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Available
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Transaction
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="stats-panels">
        <div className="stat-panel">
          <h3>Total Transactions</h3>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-panel">
          <h3>Verified</h3>
          <div className="stat-value">{stats.verified}</div>
        </div>
        <div className="stat-panel">
          <h3>Total Amount</h3>
          <div className="stat-value">{stats.totalAmount}</div>
        </div>
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Search transactions..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={filterVerified}
            onChange={(e) => setFilterVerified(e.target.checked)}
          />
          Verified Only
        </label>
        <button onClick={loadTransactions} disabled={isRefreshing} className="refresh-btn">
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="transactions-list">
        {filteredTransactions.length === 0 ? (
          <div className="no-data">
            <p>No transactions found</p>
            <button onClick={() => setShowCreateModal(true)} className="create-btn">
              Create First
            </button>
          </div>
        ) : (
          filteredTransactions.map((tx, index) => (
            <div 
              className={`transaction-item ${tx.isVerified ? "verified" : ""}`}
              key={index}
              onClick={() => setSelectedTransaction(tx)}
            >
              <div className="tx-header">
                <span className="tx-name">{tx.name}</span>
                <span className={`tx-status ${tx.isVerified ? "verified" : "pending"}`}>
                  {tx.isVerified ? "✅ Verified" : "🔓 Pending"}
                </span>
              </div>
              <div className="tx-details">
                <span>Participants: {tx.participants}</span>
                <span>Date: {new Date(tx.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              {tx.isVerified && tx.decryptedValue && (
                <div className="tx-amount">Amount: {tx.decryptedValue}</div>
              )}
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Transaction</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Transaction Name</label>
                <input 
                  type="text"
                  value={newTransactionData.name}
                  onChange={(e) => setNewTransactionData({...newTransactionData, name: e.target.value})}
                  placeholder="Enter name..."
                />
              </div>
              <div className="form-group">
                <label>Amount (FHE Encrypted)</label>
                <input 
                  type="number"
                  value={newTransactionData.amount}
                  onChange={(e) => setNewTransactionData({...newTransactionData, amount: e.target.value})}
                  placeholder="Enter amount..."
                />
              </div>
              <div className="form-group">
                <label>Participants</label>
                <input 
                  type="number"
                  value={newTransactionData.participants}
                  onChange={(e) => setNewTransactionData({...newTransactionData, participants: e.target.value})}
                  placeholder="Enter participants..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createTransaction}
                disabled={creatingTransaction || isEncrypting}
                className="submit-btn"
              >
                {creatingTransaction ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTransaction && (
        <TransactionDetail 
          transaction={selectedTransaction}
          onClose={() => setSelectedTransaction(null)}
          onDecrypt={() => decryptData(selectedTransaction.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className="status-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const TransactionDetail: React.FC<{
  transaction: TransactionData;
  onClose: () => void;
  onDecrypt: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ transaction, onClose, onDecrypt, isDecrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Transaction Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-item">
            <span>Name:</span>
            <span>{transaction.name}</span>
          </div>
          <div className="detail-item">
            <span>Creator:</span>
            <span>{transaction.creator}</span>
          </div>
          <div className="detail-item">
            <span>Participants:</span>
            <span>{transaction.participants}</span>
          </div>
          <div className="detail-item">
            <span>Date:</span>
            <span>{new Date(transaction.timestamp * 1000).toLocaleString()}</span>
          </div>
          <div className="detail-item">
            <span>Status:</span>
            <span className={transaction.isVerified ? "verified" : "pending"}>
              {transaction.isVerified ? "Verified" : "Pending Verification"}
            </span>
          </div>
          {transaction.isVerified && transaction.decryptedValue && (
            <div className="detail-item">
              <span>Decrypted Amount:</span>
              <span className="amount">{transaction.decryptedValue}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {!transaction.isVerified && (
            <button 
              onClick={onDecrypt}
              disabled={isDecrypting}
              className="decrypt-btn"
            >
              {isDecrypting ? "Decrypting..." : "Decrypt Amount"}
            </button>
          )}
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


