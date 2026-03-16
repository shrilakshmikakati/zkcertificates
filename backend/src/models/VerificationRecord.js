const mongoose = require('mongoose');

const verificationRecordSchema = new mongoose.Schema({
    networkSelection: { type: String, required: true },
    networkDisplay: { type: String, required: true },
    chainId: { type: Number, required: true },
    layerType: { type: String, required: true },
    isLayer2: { type: Boolean, default: false },
    contractAddress: { type: String, required: true },
    certificateId: { type: String, required: true },
    merkleRoot: { type: String, required: true },
    deployedMerkleRoot: { type: String, required: true },
    isValid: { type: Boolean, required: true },
    verifiedAt: { type: Date, required: true }
}, {
    timestamps: true
});

module.exports = mongoose.models.VerificationRecord || mongoose.model('VerificationRecord', verificationRecordSchema);
