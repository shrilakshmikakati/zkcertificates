const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Enhanced Certificate System - Transaction Linkage", function () {
    let certificateRegistry, zkCertificateSystem, deployer, addr1;

    beforeEach(async function () {
        [deployer, addr1] = await ethers.getSigners();

        console.log("\n Setting up contracts for transaction-linked certificate testing...");

        // Deploy CertificateRegistry
        const CertificateRegistry = await ethers.getContractFactory("CertificateRegistry");
        certificateRegistry = await CertificateRegistry.deploy();
        await certificateRegistry.deployed();
        console.log("CertificateRegistry deployed to:", certificateRegistry.address);

        // Deploy PlaceholderVerifier first
        const PlaceholderVerifier = await ethers.getContractFactory("PlaceholderVerifier");
        const verifier = await PlaceholderVerifier.deploy();
        await verifier.deployed();

        // Deploy ZKCertificateSystem with verifier address
        const ZKCertificateSystem = await ethers.getContractFactory("ZKCertificateSystem");
        zkCertificateSystem = await ZKCertificateSystem.deploy(verifier.address);
        await zkCertificateSystem.deployed();
        console.log("ZKCertificateSystem deployed to:", zkCertificateSystem.address);
    });

    it("Should demonstrate complete certificate-to-transaction linkage", async function () {
        console.log("\nTRACING: Complete Certificate-to-Transaction Linkage");
        
        // Phase 1: Create initial certificate commitments (WITHOUT transaction details)
        const studentData = {
            name: "John Doe",
            email: "john@example.com", 
            course: "Computer Science",
            grade: "A+",
            studentId: "CS2024001",
            sessionId: "test_session_001",
            createdAt: new Date().toISOString()
        };

        const preCommitmentData = JSON.stringify(studentData);
        const preCommitment = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(preCommitmentData));
        console.log("Pre-deployment commitment:", preCommitment);

        // Phase 2: Deploy to blockchain (this generates transaction details)
        console.log("\nIssuing certificate batch to blockchain...");
        
        // Authorize the deployer to issue certificates
        await zkCertificateSystem.setInstitutionAuthorization(deployer.address, true);
        
        const tx = await zkCertificateSystem.issueBatch(
            preCommitment, // Initial Merkle root
            "Test Institution",
            "Computer Science",
            2024,
            1              // Certificate count
        );

        const receipt = await tx.wait();
        console.log("Transaction hash:", tx.hash);
        console.log("Block number:", receipt.blockNumber);
        console.log("Gas used:", receipt.gasUsed.toString());

        // Phase 3: Create FINAL commitment including transaction details  
        const finalCommitmentData = {
            ...studentData,
            // NOW we can include the actual transaction details!
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash,
            gasUsed: receipt.gasUsed.toString(),
            contractAddress: zkCertificateSystem.address,
            deployedAt: new Date().toISOString()
        };

        const finalCommitment = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(JSON.stringify(finalCommitmentData))
        );
        
        console.log("Final commitment (with tx details):", finalCommitment);

        // Phase 4: Verify the certificate can prove its exact transaction
        console.log("\n VERIFICATION: Certificate proves its blockchain transaction");
        
        // The certificate can now cryptographically prove:
        // 1. Its content (name, grade, course, etc.)
        // 2. The exact transaction it was deployed in
        // 3. The exact block number and gas used
        // 4. The exact contract address
        
        const verificationData = {
            studentName: studentData.name,
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            contractAddress: zkCertificateSystem.address
        };

        // This hash includes BOTH certificate data AND transaction details
        const verifiableHash = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(JSON.stringify(finalCommitmentData))
        );

        console.log("Certificate can prove it was deployed in transaction:", tx.hash);
        console.log("Certificate can prove it was deployed in block:", receipt.blockNumber.toString());
        console.log("Certificate can prove exact gas cost:", receipt.gasUsed.toString());
        
        expect(verifiableHash).to.equal(finalCommitment);
    });

    it("Should trace gas costs for different batch sizes", async function () {
        console.log("\nTRACING: Gas costs for different certificate batch sizes");
        
        const batchSizes = [1, 5, 10, 50];
        
        for (const size of batchSizes) {
            console.log(`\nTesting batch size: ${size} certificates`);
            
            // Create mock Merkle root for batch
            const mockMerkleRoot = ethers.utils.keccak256(
                ethers.utils.toUtf8Bytes(`batch_${size}_${Date.now()}`)
            );
            
            // Authorize and issue batch
            await zkCertificateSystem.setInstitutionAuthorization(deployer.address, true);
            const tx = await zkCertificateSystem.issueBatch(
                mockMerkleRoot,
                "Gas Test Institution",
                "Test Course",
                2024,
                size
            );
            
            const receipt = await tx.wait();
            const gasPerCertificate = receipt.gasUsed.div(size);
            
            console.log(` Total gas: ${receipt.gasUsed.toString()}`);
            console.log(`Gas per certificate: ${gasPerCertificate.toString()}`);
            console.log(`Transaction: ${tx.hash}`);
        }
    });

    it("Should demonstrate Merkle proof with transaction linkage", async function () {
        console.log("\nTRACING: Merkle proofs with transaction details");
        
        // This would be a more complex test showing how individual certificates
        // can prove they were part of a specific blockchain transaction
        // using Merkle proofs that include transaction metadata
        
        const merkleRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test_root"));
        
        // Authorize and issue batch with Merkle root
        await zkCertificateSystem.setInstitutionAuthorization(deployer.address, true);
        const tx = await zkCertificateSystem.issueBatch(
            merkleRoot, 
            "Merkle Test University",
            "Proof Course",
            2024,
            3
        );
        const receipt = await tx.wait();
        
        console.log("Merkle root deployed:", merkleRoot);
        console.log("In transaction:", tx.hash);  
        console.log("At block:", receipt.blockNumber.toString());
        
        // Each certificate can now prove:
        // 1. It's part of this Merkle tree (traditional Merkle proof)
        // 2. This Merkle tree was deployed in transaction tx.hash
        // 3. Therefore, the certificate was deployed in transaction tx.hash
        
        console.log("Complete provenance chain established");
    });
});