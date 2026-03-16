const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("Starting ZK Certificate System deployment...\n");

    const [deployer] = await ethers.getSigners();
    const providerNetwork = await ethers.provider.getNetwork();
    const networkName = process.env.HARDHAT_NETWORK || providerNetwork.name || `chain-${providerNetwork.chainId}`;

    console.log(" Deployment Info:");
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");
    console.log("Network:", networkName);
    console.log("Chain ID:", providerNetwork.chainId);
    console.log("");

    const deploymentResult = {
        network: networkName,
        providerNetworkName: providerNetwork.name,
        chainId: providerNetwork.chainId,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {}
    };

    try {
        // 1. Deploy CertificateRegistry
        console.log("Deploying CertificateRegistry...");
        const CertificateRegistry = await ethers.getContractFactory("CertificateRegistry");
        const certificateRegistry = await CertificateRegistry.deploy();
        await certificateRegistry.deployed();

        const registryAddress = certificateRegistry.address;
        console.log("CertificateRegistry deployed to:", registryAddress);

        deploymentResult.contracts.CertificateRegistry = {
            address: registryAddress,
            transactionHash: certificateRegistry.deployTransaction.hash
        };

        // 2. Deploy CertificateVerifier (real ZK proof verifier)
        console.log("\nDeploying CertificateVerifier (real ZK proof verifier)...");
        const CertificateVerifier = await ethers.getContractFactory("CertificateVerifier");
        const verifier = await CertificateVerifier.deploy();
        await verifier.deployed();

        const verifierAddress = verifier.address;
        console.log("CertificateVerifier deployed to:", verifierAddress);

        deploymentResult.contracts.CertificateVerifier = {
            address: verifierAddress,
            transactionHash: verifier.deployTransaction.hash,
            type: "Groth16_ZK_Verifier"
        };

        // 3. Deploy ZKCertificateSystem
        console.log("\n Deploying ZKCertificateSystem...");
        const ZKCertificateSystem = await ethers.getContractFactory("ZKCertificateSystem");
        const zkCertificateSystem = await ZKCertificateSystem.deploy(verifierAddress);
        await zkCertificateSystem.deployed();

        const zkSystemAddress = zkCertificateSystem.address;
        console.log("ZKCertificateSystem deployed to:", zkSystemAddress);

        deploymentResult.contracts.ZKCertificateSystem = {
            address: zkSystemAddress,
            transactionHash: zkCertificateSystem.deployTransaction.hash
        };

        // 4. Setup initial configuration
        console.log("\n Setting up initial configuration...");

        // Authorize the ZKCertificateSystem to issue certificates
        const authTx = await zkCertificateSystem.setInstitutionAuthorization(deployer.address, true);
        await authTx.wait();
        console.log("Institution authorization configured");

        // 5. Verify deployments
        console.log("\nVerifying deployments...");

        // Test CertificateRegistry
        const totalBatches = await zkCertificateSystem.getTotalBatches();
        console.log("Total batches:", totalBatches.toString());

        // Test authorization
        const isAuthorized = await zkCertificateSystem.authorizedInstitutions(deployer.address);
        console.log("  Deployer authorized:", isAuthorized);

        // 6. Save deployment information
        const deploymentsDir = path.join(__dirname, "../deployments");
        if (!fs.existsSync(deploymentsDir)) {
            fs.mkdirSync(deploymentsDir, { recursive: true });
        }

        const deploymentFile = path.join(deploymentsDir, `deployment-${networkName}-${Date.now()}.json`);
        fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResult, null, 2));

        // Save default latest deployment (backward compatibility)
        const latestFile = path.join(deploymentsDir, "latest.json");
        fs.writeFileSync(latestFile, JSON.stringify(deploymentResult, null, 2));

        // Save network-specific latest deployment for L2 multi-network workflows
        const latestNetworkFile = path.join(deploymentsDir, `latest.${networkName}.json`);
        fs.writeFileSync(latestNetworkFile, JSON.stringify(deploymentResult, null, 2));

        console.log("\nZK Certificate System deployed successfully!");
        console.log("Deployment details saved to:", deploymentFile);
        console.log("\nDeployment Summary:");
        console.log("CertificateRegistry:", registryAddress);
        console.log("Verifier:", verifierAddress);
        console.log("ZKCertificateSystem:", zkSystemAddress);

        // Generate environment variables for backend
        const envVars = `
Generated deployment configuration
CERTIFICATE_REGISTRY_ADDRESS=${registryAddress}
VERIFIER_ADDRESS=${verifierAddress}
ZK_CERTIFICATE_SYSTEM_ADDRESS=${zkSystemAddress}
DEPLOYMENT_BLOCK=${await ethers.provider.getBlockNumber()}
DEPLOYMENT_TIMESTAMP=${new Date().toISOString()}
BLOCKCHAIN_NETWORK=${networkName}
BLOCKCHAIN_CHAIN_ID=${providerNetwork.chainId}
        `.trim();

        const backendEnvFile = path.join(__dirname, "../backend/.env.deployment");
        fs.writeFileSync(backendEnvFile, envVars);
        console.log(" Backend environment variables saved to:", backendEnvFile);

        return deploymentResult;

    } catch (error) {
        console.error("\nDeployment failed:", error);
        process.exit(1);
    }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { main };