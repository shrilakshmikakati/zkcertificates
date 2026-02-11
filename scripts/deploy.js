const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("Starting ZK Certificate System deployment...\n");

    const [deployer] = await ethers.getSigners();

    console.log(" Deployment Info:");
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");
    console.log("Network:", (await ethers.provider.getNetwork()).name);
    console.log("");

    const deploymentResult = {
        network: (await ethers.provider.getNetwork()).name,
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

        // 2. Deploy a placeholder Verifier (in real deployment, this would be generated from circuit)
        console.log("\n Deploying placeholder Verifier...");
        const PlaceholderVerifier = await ethers.getContractFactory("PlaceholderVerifier");
        const verifier = await PlaceholderVerifier.deploy();
        await verifier.deployed();

        const verifierAddress = verifier.address;
        console.log("Verifier deployed to:", verifierAddress);

        deploymentResult.contracts.Verifier = {
            address: verifierAddress,
            transactionHash: verifier.deployTransaction.hash
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

        const deploymentFile = path.join(deploymentsDir, `deployment-${Date.now()}.json`);
        fs.writeFileSync(deploymentFile, JSON.stringify(deploymentResult, null, 2));

        // Also save the latest deployment
        const latestFile = path.join(deploymentsDir, "latest.json");
        fs.writeFileSync(latestFile, JSON.stringify(deploymentResult, null, 2));

        console.log("\nZK Certificate System deployed successfully!");
        console.log("Deployment details saved to:", deploymentFile);
        console.log("\nDeployment Summary:");
        console.log("CertificateRegistry:", registryAddress);
        console.log("Verifier:", verifierAddress);
        console.log("ZKCertificateSystem:", zkSystemAddress);

        // Generate environment variables for backend
        const envVars = `
# Generated deployment configuration
CERTIFICATE_REGISTRY_ADDRESS=${registryAddress}
VERIFIER_ADDRESS=${verifierAddress}
ZK_CERTIFICATE_SYSTEM_ADDRESS=${zkSystemAddress}
DEPLOYMENT_BLOCK=${await ethers.provider.getBlockNumber()}
DEPLOYMENT_TIMESTAMP=${new Date().toISOString()}
        `.trim();

        const backendEnvFile = path.join(__dirname, "../backend/.env.deployment");
        fs.writeFileSync(backendEnvFile, envVars);
        console.log("🔧 Backend environment variables saved to:", backendEnvFile);

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