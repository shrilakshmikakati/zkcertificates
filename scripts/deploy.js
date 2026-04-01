/**
 * @title ZK Certificate System Deployment Script
 * @dev Deploys contracts to zkSync Sepolia using ethers.js
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// Contract ABIs and Bytecodes
const contracts = {
  PlaceholderVerifier: {
    abi: require("../artifacts/contracts/PlaceholderVerifier.sol/PlaceholderVerifier.json").abi,
    bytecode: require("../artifacts/contracts/PlaceholderVerifier.sol/PlaceholderVerifier.json").bytecode,
  },
  ZKCertificateSystem: {
    abi: require("../artifacts/contracts/ZKCertificateSystem.sol/ZKCertificateSystem.json").abi,
    bytecode: require("../artifacts/contracts/ZKCertificateSystem.sol/ZKCertificateSystem.json").bytecode,
  },
};

async function main() {
  console.log("\n🚀 ZK Certificate System Deployment to zkSync Sepolia");
  console.log("═══════════════════════════════════════════════════════\n");

  // Configuration
  const RPC_URL = process.env.ZKSYNC_SEPHOLIA_RPC_URL || "https://sepolia.era.zksync.dev";
  const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;

  if (!PRIVATE_KEY) {
    throw new Error("❌ Private key not found. Set DEPLOYER_PRIVATE_KEY or PRIVATE_KEY in .env");
  }

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`📡 Network: zkSync Sepolia`);
  console.log(`🔗 RPC: ${RPC_URL}`);
  console.log(`👛 Deployer: ${signer.address}`);

  // Check balance
  const balance = await provider.getBalance(signer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  const minBalance = ethers.parseEther("0.01");
  if (balance < minBalance) {
    throw new Error("❌ Insufficient balance for deployment");
  }

  const deploymentRecord = {
    network: "zksyncSepolia",
    chainId: 300,
    deployer: signer.address,
    timestamp: new Date().toISOString(),
    contracts: {},
  };

  try {
    // Deploy PlaceholderVerifier
    console.log("📦 Deploying PlaceholderVerifier...\n");

    const verifierFactory = new ethers.ContractFactory(
      contracts.PlaceholderVerifier.abi,
      contracts.PlaceholderVerifier.bytecode,
      signer
    );

    const verifier = await verifierFactory.deploy();
    await verifier.waitForDeployment();

    const verifierAddress = await verifier.getAddress();
    console.log(`   ✅ PlaceholderVerifier deployed at: ${verifierAddress}`);

    deploymentRecord.contracts.CertificateVerifier = {
      address: verifierAddress,
      type: "PlaceholderVerifier",
      transactionHash: verifier.deploymentTransaction().hash,
    };

    // Deploy ZKCertificateSystem
    console.log("\n📦 Deploying ZKCertificateSystem...\n");
    console.log(`   Verifier Address: ${verifierAddress}`);

    const zkFactory = new ethers.ContractFactory(
      contracts.ZKCertificateSystem.abi,
      contracts.ZKCertificateSystem.bytecode,
      signer
    );

    const zkSystem = await zkFactory.deploy(verifierAddress);
    await zkSystem.waitForDeployment();

    const zkAddress = await zkSystem.getAddress();
    console.log(`   ✅ ZKCertificateSystem deployed at: ${zkAddress}`);

    deploymentRecord.contracts.ZKCertificateSystem = {
      address: zkAddress,
      transactionHash: zkSystem.deploymentTransaction().hash,
    };

    deploymentRecord.contracts.CertificateRegistry = {
      address: zkAddress,
      note: "Same as ZKCertificateSystem",
    };

    // Save deployment record
    console.log("\n💾 Saving Deployment Record...\n");

    const deploymentDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const latestFile = path.join(deploymentDir, "latest.json");
    const networkFile = path.join(deploymentDir, "latest.zksyncSepolia.json");
    const timestampFile = path.join(deploymentDir, `deployment-zksyncSepolia-${Date.now()}.json`);

    fs.writeFileSync(latestFile, JSON.stringify(deploymentRecord, null, 2));
    fs.writeFileSync(networkFile, JSON.stringify(deploymentRecord, null, 2));
    fs.writeFileSync(timestampFile, JSON.stringify(deploymentRecord, null, 2));

    console.log(`   📄 Saved: latest.json`);
    console.log(`   📄 Saved: latest.zksyncSepolia.json`);
    console.log(`   📄 Saved: ${path.basename(timestampFile)}\n`);

    // Success summary
    console.log("═══════════════════════════════════════════════════════");
    console.log("  ✅ Deployment Successful!");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Contract Addresses:");
    console.log(`   Verifier (Placeholder): ${verifierAddress}`);
    console.log(`   ZK Certificate System: ${zkAddress}`);
    console.log(`   Registry: ${zkAddress}`);

    console.log(`\n🔗 Network: zkSync Sepolia (Chain ID: 300)`);
    console.log(`📅 Deployed: ${deploymentRecord.timestamp}`);

    console.log(`\n📝 Next Steps:`);
    console.log(`   1. Verify contracts on zkSync explorer: https://sepolia.era.zksync.io`);
    console.log(`   2. Update frontend with new contract addresses`);
    console.log(`   3. Update backend configuration`);

    return deploymentRecord;

  } catch (error) {
    console.error("\n❌ Deployment Failed!");
    console.error(`Error: ${error.message}\n`);

    if (error.transaction) {
      console.error("Transaction details:", error.transaction);
    }

    throw error;
  }
}

// Execute deployment
main()
  .then(() => {
    console.log("\n✨ Deployment completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });