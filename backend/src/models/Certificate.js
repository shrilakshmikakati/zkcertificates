const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    certificateId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, index: true },
    studentId: { type: String, index: true },
    // Top-level academic fields — duplicated from content for fast querying
    grade: { type: String, default: '' },
    course: { type: String, default: '' },
    percentage: { type: String, default: '' },
    
    issueDate: { type: String, required: true },
    verificationCode: { type: String, required: true, index: true },
    
    deploymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeploymentRecord', index: true },
    transactionHash: { type: String, index: true },
    blockNumber: { type: Number },
    contractAddress: { type: String },
    
    merkleRoot: { type: String, index: true },
    merkleProof: [{
        data: { type: String },
        position: { type: String, enum: ['left', 'right'] }
    }],
    leafHash: { type: String },
    

    content: {
        institutionName: String,
        courseName: String,
        completionDate: String,
        certificateProgram: String,
        studentName: String,
        studentEmail: String,
        studentId: String,
        graduationYear: Number
    },
    
    zkProof: {
        pA: [String],
        pB: [[String], [String]],
        pC: [String],
        publicSignals: [String],
        verified: Boolean
    },
    zkProofVerified: { type: Boolean, default: false, index: true },
    
    // Status & Metadata
    status: { 
        type: String, 
        enum: ['pending', 'issued', 'verified', 'revoked'], 
        default: 'pending',
        index: true 
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    
    // Timestamps
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
    deployedAt: Date,
    verifiedAt: Date
}, {
    timestamps: true
});

// Index for faster queries
certificateSchema.index({ certificateId: 1, deploymentId: 1 });
certificateSchema.index({ status: 1, createdAt: -1 });
certificateSchema.index({ transactionHash: 1 });

module.exports = mongoose.models.Certificate || mongoose.model('Certificate', certificateSchema);