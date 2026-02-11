const express = require('express');
const Joi = require('joi');

const MerkleService = require('../services/MerkleService');

const router = express.Router();

/**
 * @route POST /api/merkle/build-tree
 * @desc Build Merkle tree from certificate commitments
 */
router.post('/build-tree', async (req, res) => {
    try {
        const schema = Joi.object({
            commitments: Joi.array().items(Joi.string().hex()).min(1).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        // Create certificate objects from commitments
        const certificates = value.commitments.map((commitment, index) => ({
            studentId: `student_${index}`,
            commitment
        }));

        const merkleTree = MerkleService.buildMerkleTree(certificates);
        const stats = MerkleService.getTreeStats(merkleTree);

        res.status(200).json({
            success: true,
            message: 'Merkle tree built successfully',
            data: {
                merkleRoot: stats.merkleRoot,
                totalLeaves: stats.totalLeaves,
                treeDepth: stats.treeDepth,
                totalNodes: stats.totalNodes
            }
        });

    } catch (error) {
        console.error('Merkle tree build error:', error);
        res.status(500).json({
            error: 'Merkle Tree Build Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/merkle/generate-proof
 * @desc Generate Merkle proof for a specific commitment
 */
router.post('/generate-proof', async (req, res) => {
    try {
        const schema = Joi.object({
            commitments: Joi.array().items(Joi.string().hex()).min(1).required(),
            targetCommitment: Joi.string().hex().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        // Build tree
        const certificates = value.commitments.map((commitment, index) => ({
            studentId: `student_${index}`,
            commitment
        }));

        const merkleTree = MerkleService.buildMerkleTree(certificates);

        // Generate proof for target commitment
        const proof = MerkleService.generateMerkleProof(merkleTree, value.targetCommitment);
        const merkleRoot = merkleTree.getRoot().toString('hex');

        res.status(200).json({
            success: true,
            message: 'Merkle proof generated successfully',
            data: {
                proof,
                merkleRoot,
                targetCommitment: value.targetCommitment
            }
        });

    } catch (error) {
        console.error('Merkle proof generation error:', error);
        res.status(500).json({
            error: 'Merkle Proof Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/merkle/verify-proof
 * @desc Verify a Merkle proof
 */
router.post('/verify-proof', async (req, res) => {
    try {
        const schema = Joi.object({
            commitment: Joi.string().hex().required(),
            proof: Joi.array().items(Joi.string().hex()).required(),
            merkleRoot: Joi.string().hex().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        const isValid = MerkleService.verifyProof(
            value.commitment,
            value.proof,
            value.merkleRoot
        );

        res.status(200).json({
            success: true,
            valid: isValid,
            message: isValid ? 'Merkle proof is valid' : 'Merkle proof verification failed'
        });

    } catch (error) {
        console.error('Merkle proof verification error:', error);
        res.status(500).json({
            error: 'Merkle Proof Verification Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/merkle/export-tree
 * @desc Export Merkle tree data for backup
 */
router.post('/export-tree', async (req, res) => {
    try {
        const schema = Joi.object({
            certificates: Joi.array().items(Joi.object({
                studentId: Joi.string().required(),
                commitment: Joi.string().hex().required(),
                subjects: Joi.array().items(Joi.number()).optional()
            })).min(1).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        const merkleTree = MerkleService.buildMerkleTree(value.certificates);
        const exportData = MerkleService.exportTreeData(merkleTree, value.certificates);

        res.status(200).json({
            success: true,
            message: 'Merkle tree exported successfully',
            data: exportData
        });

    } catch (error) {
        console.error('Merkle tree export error:', error);
        res.status(500).json({
            error: 'Merkle Tree Export Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/merkle/import-tree
 * @desc Import and reconstruct Merkle tree from backup
 */
router.post('/import-tree', async (req, res) => {
    try {
        const schema = Joi.object({
            treeData: Joi.object({
                merkleRoot: Joi.string().hex().required(),
                leaves: Joi.array().items(Joi.string().hex()).required(),
                certificates: Joi.array().items(Joi.object()).required(),
                metadata: Joi.object().required()
            }).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        const merkleTree = MerkleService.importTreeData(value.treeData);
        const stats = MerkleService.getTreeStats(merkleTree);

        res.status(200).json({
            success: true,
            message: 'Merkle tree imported successfully',
            data: {
                merkleRoot: stats.merkleRoot,
                totalLeaves: stats.totalLeaves,
                treeDepth: stats.treeDepth,
                originalMetadata: value.treeData.metadata
            }
        });

    } catch (error) {
        console.error('Merkle tree import error:', error);
        res.status(500).json({
            error: 'Merkle Tree Import Failed',
            message: error.message
        });
    }
});

module.exports = router;