const mongoose = require('mongoose');

const deploymentRecordSchema = new mongoose.Schema({
    networkSelection: { type: String, required: true },
    networkDisplay: { type: String, required: true },
    networkName: { type: String, required: true },
    chainId: { type: Number, required: true },
    layerType: { type: String, required: true },
    isLayer2: { type: Boolean, default: false },
    rpcUrl: { type: String, required: true },
    contractAddress: { type: String, required: true },
    transactionHash: { type: String, required: true, index: true },
    blockNumber: { type: Number, required: true },
    blockHash: { type: String, required: true },
    gasUsed: { type: String, required: true },
    merkleRoot: { type: String, required: true, index: true },
    // finalMerkleRoot is computed after the blockchain tx is mined.
    // Each leaf includes tx hash + block details so the root changes post-deployment.
    // This is the root that stored Merkle proofs verify against.
    finalMerkleRoot: { type: String, index: true },
    totalCertificates: { type: Number, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    deployedAt: { type: Date, required: true }
}, {
    timestamps: true
});

module.exports = mongoose.models.DeploymentRecord || mongoose.model('DeploymentRecord', deploymentRecordSchema);