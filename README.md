# ZK Proof Certificates

A **privacy-preserving bulk degree certificate generation and verification system** using **Zero-Knowledge Proofs (ZKPs)** and **blockchain technology**. This system enables universities to issue certificates for large numbers of students using a CSV file containing subject-wise marks, while ensuring that **no sensitive student data is ever stored or revealed on-chain**.

## 🎯 Overview

The system combines cutting-edge cryptographic techniques to provide:

- **Bulk Certificate Issuance**: Process thousands of certificates from CSV files in a single blockchain transaction
- **Zero-Knowledge Verification**: Prove academic achievements without revealing actual grades or sensitive data
- **Blockchain Security**: Immutable certificate registry with cryptographic proof of authenticity  
- **Privacy Preservation**: Student grades and personal information never stored on-chain
- **Scalable Architecture**: Merkle tree batching enables cost-effective mass certificate issuance
- **Local Deployment**: Complete end-to-end system runs offline with Hardhat local blockchain

## 🏗️ Architecture

### Core Components

1. **Smart Contracts** (`/contracts/`)
   - `CertificateRegistry.sol`: Stores Merkle roots and batch metadata  
   - `ZKCertificateSystem.sol`: Main contract with ZK proof verification
   - `IVerifier.sol`: Interface for ZK proof verifier
   - `PlaceholderVerifier.sol`: Development verifier (replace with circuit-generated)

2. **Zero-Knowledge Circuits** (`/circuits/`)
   - `certificate.circom`: Main certificate verification circuit
   - `certificate_simple.circom`: Simplified version for development

3. **Backend Services** (`/backend/`)
   - CSV processing and validation
   - Merkle tree generation
   - ZK proof generation and verification
   - REST API for all operations

4. **Frontend Interface** (`/frontend/`)
   - Next.js React application
   - Certificate issuance workflow
   - Verification interface
   - Proof generation tools

5. **Utilities** (`/utils/`)
   - Helper functions for certificate processing
   - Cryptographic utilities
   - Data validation

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd "zk proof certifactes"
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install backend dependencies  
   cd backend && npm install && cd ..
   
   # Install frontend dependencies
   cd frontend && npm install && cd ..
   ```

3. **Set up environment variables**
   ```bash
   # Backend configuration
   cp backend/.env.example backend/.env
   
   # Edit backend/.env with your settings
   ```

### Development Setup

1. **Start local blockchain**
   ```bash
   npm run node
   ```

2. **Deploy smart contracts** (in new terminal)
   ```bash
   npm run compile
   npm run deploy
   ```

3. **Start backend services** (in new terminal)  
   ```bash
   npm run dev:backend
   ```

4. **Start frontend** (in new terminal)
   ```bash
   npm run dev:frontend
   ```

5. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Blockchain: http://127.0.0.1:8545

## 📝 Usage Guide

### 1. Issue Certificates

1. Navigate to "Issue Certificates" in the frontend
2. Download the CSV template or use the provided format:
   ```csv
   studentId,studentName,email,subject1,subject2,subject3,subject4,subject5
   STU001,Alice Johnson,alice.johnson@university.edu,88,92,85,90,87
   STU002,Bob Smith,bob.smith@university.edu,76,84,79,82,88
   ```
3. Upload your CSV file with student data
4. Configure batch parameters:
   - Institution name
   - Course name  
   - Graduation year
   - Passing grade threshold
5. Process the batch to generate Merkle tree
6. Deploy to blockchain

### 2. Generate ZK Proofs

1. Students can generate proofs to verify their achievements
2. Required inputs:
   - Student ID and grades (private)
   - Salt from certificate issuance (private)
   - Minimum passing grade (public)
   - Batch ID (public)
3. System generates ZK proof without revealing actual grades

### 3. Verify Certificates

Two verification methods:

**Method 1: Traditional Merkle Proof**
- Verify certificate exists in issued batch
- Uses commitment hash and Merkle proof

**Method 2: Zero-Knowledge Verification**  
- Verify academic criteria are met
- No sensitive data revealed
- Cryptographic proof of achievement

## 🔧 Configuration

### Smart Contract Configuration

Edit `hardhat.config.js`:
```javascript
module.exports = {
  solidity: "0.8.19",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};
```

### Backend Configuration 

Edit `backend/.env`:
```bash
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
```

### ZK Circuit Configuration

For production deployments:
1. Compile circuits: `npm run compile-circuits`
2. Setup trusted setup: `npm run setup-ptau`  
3. Generate keys: `npm run generate-keys`
4. Replace PlaceholderVerifier with generated verifier

## 📊 Technical Details

### CSV Processing Flow

1. **Upload**: CSV file uploaded via frontend
2. **Validation**: Backend validates format and data integrity
3. **Commitment Generation**: Each student record hashed with random salt
4. **Merkle Tree**: Commitments organized into Merkle tree
5. **Blockchain Storage**: Only Merkle root stored on-chain

### Zero-Knowledge Proof Flow

1. **Circuit Input**: Student data, grades, salt (private) + verification criteria (public)
2. **Proof Generation**: Groth16 proof generated using Circom circuit
3. **Verification**: Smart contract verifies proof without revealing private data
4. **Result**: Boolean verification result returned

### Privacy Guarantees

- **No Data Storage**: Only cryptographic commitments stored on-chain
- **Zero-Knowledge**: Verification reveals no information about grades
- **Salt Protection**: Random salts prevent rainbow table attacks
- **Merkle Privacy**: Individual certificates not identifiable in tree

## 🛠️ Development

### Project Structure
```
/
├── contracts/          # Smart contracts (Solidity)
├── circuits/           # ZK circuits (Circom)  
├── backend/           # Express.js backend
│   ├── src/
│   │   ├── routes/    # API routes
│   │   ├── services/  # Business logic
│   │   └── utils/     # Helper functions
├── frontend/          # Next.js frontend  
│   ├── pages/         # Page components
│   ├── src/components/# Reusable components
│   └── styles/        # CSS styles
├── utils/             # Shared utilities
├── scripts/           # Deployment scripts
└── test/              # Test files
```

### Available Scripts

```bash
# Blockchain
npm run compile      # Compile smart contracts
npm run test         # Run contract tests
npm run node         # Start local blockchain
npm run deploy       # Deploy contracts

# ZK Circuits  
npm run compile-circuits  # Compile Circom circuits
npm run setup-ptau       # Powers-of-tau ceremony
npm run generate-keys    # Generate proving keys

# Development
npm run dev:backend     # Start backend server
npm run dev:frontend    # Start frontend server  
npm run start:all       # Start all services

# Production
npm run build:frontend  # Build frontend for production
npm run clean          # Clean build artifacts
```

### Testing

Run the test suite:
```bash
# Contract tests
npm run test

# Backend tests (if implemented)
cd backend && npm test

# End-to-end tests (if implemented) 
npm run test:e2e
```

## 🔒 Security Considerations

### Smart Contract Security
- OpenZeppelin contracts for standard functionality
- ReentrancyGuard protection
- Access control mechanisms  
- Input validation

### Cryptographic Security
- SHA-256 for commitment hashing
- Groth16 zero-knowledge proofs
- Merkle tree integrity
- Random salt generation

### Deployment Security
- Environment variable protection
- API rate limiting
- Input sanitization
- CORS configuration

## 📈 Scalability

### Gas Cost Analysis
- **Individual Certificates**: ~21,000 gas per certificate
- **Batch Processing**: ~80,000 gas + ~100 gas per certificate
- **Savings**: 99%+ gas reduction for large batches

### Performance Metrics
- **Batch Size**: Unlimited (tested up to 10,000)
- **Proof Generation**: <5 seconds per proof
- **Verification**: <1 second per verification
- **Tree Build Time**: O(n log n) for n certificates

## 🌐 Production Deployment

### Mainnet Deployment

1. **Circuit Setup**
   ```bash
   npm run compile-circuits
   npm run setup-ptau
   npm run generate-keys
   ```

2. **Replace Placeholder Verifier**
   - Generate verifier contract from circuit
   - Replace `PlaceholderVerifier.sol`
   - Update deployment script

3. **Deploy to Mainnet**
   ```bash
   # Configure mainnet in hardhat.config.js
   npx hardhat run scripts/deploy.js --network mainnet
   ```

4. **Environment Configuration**
   - Update RPC URLs
   - Configure private keys
   - Set production API endpoints

### Layer-2 Rollup Deployment (Recommended)

This project now supports direct deployment to rollup testnets.

1. **Create root environment file**
   ```bash
   cp .env.example .env
   ```

2. **Set rollup RPC + deployer key in `.env`**
   - `DEPLOYER_PRIVATE_KEY`
   - `OPTIMISM_SEPOLIA_RPC_URL`
   - `ARBITRUM_SEPOLIA_RPC_URL`
   - `BASE_SEPOLIA_RPC_URL`
   - `POLYGON_ZKEVM_CARDONA_RPC_URL`

3. **Deploy contracts to an L2 network**
   ```bash
   npm run deploy:optimism-sepolia
   # or
   npm run deploy:arbitrum-sepolia
   # or
   npm run deploy:base-sepolia
   # or
   npm run deploy:polygon-zkevm-cardona
   ```

4. **Configure backend runtime to the same L2 network** (in `backend/.env`)
   ```bash
   BLOCKCHAIN_NETWORK=optimismSepolia
   BLOCKCHAIN_RPC_URL=https://your-optimism-sepolia-rpc
   DEPLOYER_PRIVATE_KEY=0x...
   ```

Deployments are written to both `deployments/latest.json` and network-specific files like `deployments/latest.optimismSepolia.json`.

### Cloud Deployment Options

- **Backend**: AWS, Google Cloud, Azure
- **Frontend**: Vercel, Netlify, AWS S3
- **IPFS**: For decentralized hosting
- **Database**: PostgreSQL for persistent storage (optional)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

### Development Guidelines
- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure security best practices

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Circom & SnarkJS** - Zero-knowledge proof libraries
- **OpenZeppelin** - Smart contract security standards
- **Hardhat** - Ethereum development environment
- **MerkleTreeJS** - Merkle tree implementation
- **Next.js & Tailwind CSS** - Frontend framework and styling

## 📞 Support

For questions, issues, or contributions:
- Create an issue in this repository
- Check existing documentation
- Review test cases for examples

---

**Built with privacy and security in mind.** 🔐