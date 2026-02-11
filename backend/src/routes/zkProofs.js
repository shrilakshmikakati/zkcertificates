const express = require('express');
const Joi = require('joi');
const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

const ZKProofService = require('../services/ZKProofService');
const CertificateService = require('../services/CertificateService');

const router = express.Router();

/**
 * @route POST /api/zkproofs/generate
 * @desc Generate ZK proof for certificate verification
 */
router.post('/generate', async (req, res) => {
    try {
        const proofSchema = Joi.object({
            studentId: Joi.string().required(),
            subjects: Joi.array().items(Joi.number().min(0).max(100)).length(5).required(),
            salt: Joi.string().required(),
            minPassingGrade: Joi.number().min(0).max(100).required(),
            requireAllPassed: Joi.boolean().default(false),
            batchId: Joi.number().optional(),
            merkleProof: Joi.array().items(Joi.string()).optional()
        });

        const { error, value } = proofSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        // Generate ZK proof
        const proofData = await ZKProofService.generateProof(value);

        res.status(200).json({
            success: true,
            message: 'ZK proof generated successfully',
            data: {
                proof: proofData.proof,
                publicSignals: proofData.publicSignals,
                commitment: proofData.commitment
            }
        });

    } catch (error) {
        console.error('ZK proof generation error:', error);
        res.status(500).json({
            error: 'ZK Proof Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/zkproofs/verify
 * @desc Verify ZK proof
 */
router.post('/verify', async (req, res) => {
    try {
        const verificationSchema = Joi.object({
            proof: Joi.object({
                pi_a: Joi.array().items(Joi.string()).length(3).required(),
                pi_b: Joi.array().items(Joi.array().items(Joi.string()).length(2)).length(3).required(),
                pi_c: Joi.array().items(Joi.string()).length(3).required(),
                protocol: Joi.string().default('groth16')
            }).required(),
            publicSignals: Joi.array().items(Joi.string()).required()
        });

        const { error, value } = verificationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details
            });
        }

        // Verify proof using verification key
        const isValid = await ZKProofService.verifyProof(
            value.proof,
            value.publicSignals
        );

        res.status(200).json({
            success: true,
            valid: isValid,
            message: isValid ? 'ZK proof is valid' : 'ZK proof verification failed'
        });

    } catch (error) {
        console.error('ZK proof verification error:', error);
        res.status(500).json({
            error: 'ZK Proof Verification Failed',
            message: error.message
        });
    }
});

/**
 * @route GET /api/zkproofs/circuit-info
 * @desc Get information about the ZK circuit
 */
router.get('/circuit-info', (req, res) => {
    try {
        const circuitInfo = ZKProofService.getCircuitInfo();

        res.status(200).json({
            success: true,
            data: circuitInfo
        });

    } catch (error) {
        console.error('Circuit info error:', error);
        res.status(500).json({
            error: 'Failed to get circuit information',
            message: error.message
        });
    }
});

/**
 * @route POST /api/zkproofs/setup
 * @desc Initialize ZK proof system (for development)
 */
router.post('/setup', async (req, res) => {
    try {
        // This endpoint would be used to initialize the proving system
        // In production, this would be done during deployment

        const setupResult = await ZKProofService.initializeProvingSystem();

        res.status(200).json({
            success: true,
            message: 'ZK proving system initialized',
            data: setupResult
        });

    } catch (error) {
        console.error('ZK setup error:', error);
        res.status(500).json({
            error: 'ZK Setup Failed',
            message: error.message
        });
    }
});

/**
 * @route GET /api/zkproofs/verification-key
 * @desc Get verification key for on-chain deployment
 */
router.get('/verification-key', (req, res) => {
    try {
        const verificationKey = ZKProofService.getVerificationKey();

        res.status(200).json({
            success: true,
            data: {
                verificationKey,
                Instructions: 'Use this key to deploy the verifier contract'
            }
        });

    } catch (error) {
        console.error('Verification key error:', error);
        res.status(500).json({
            error: 'Failed to get verification key',
            message: error.message
        });
    }
});

module.exports = router;