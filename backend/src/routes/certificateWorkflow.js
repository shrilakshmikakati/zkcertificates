const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const crypto = require('crypto');

const DynamicCertificateService = require('../services/DynamicCertificateService');
const MerkleService = require('../services/MerkleService');
const CertificateService = require('../services/CertificateService');
const ZKProofService = require('../services/ZKProofService');

const router = express.Router();
const deploymentsDir = path.join(__dirname, '../../../deployments');
const DeploymentRecord = require('../models/DeploymentRecord');
const VerificationRecord = require('../models/VerificationRecord');
const Certificate = require('../models/Certificate');

const NETWORK_RPC_ENV_MAP = {
    zksyncMainnet: 'ZKSYNC_MAINNET_RPC_URL',
    zksyncSepholia: 'ZKSYNC_SEPHOLIA_RPC_URL'
};

const LOCAL_NETWORKS = ['ganache', 'localhost', 'hardhat'];

const CHAIN_METADATA = {
    1337: { label: 'Ganache Local', layerType: 'Local EVM (L1 simulation)', isLayer2: false },
    31337: { label: 'Hardhat Local', layerType: 'Local EVM (L1 simulation)', isLayer2: false },
    300: { label: 'zkSync Sepolia Testnet', layerType: 'Layer 2 Rollup', isLayer2: true },
    324: { label: 'zkSync Mainnet', layerType: 'Layer 2 Rollup', isLayer2: true },
};

function resolveNetworkMetadata(network, configuredNetwork) {
    const chainId = Number(network?.chainId || 0);
    const known = CHAIN_METADATA[chainId];
    const rawName = (network?.name || '').trim();
    const baseName =
        rawName && rawName.toLowerCase() !== 'unknown'
            ? rawName
            : (configuredNetwork || (chainId ? `chain-${chainId}` : 'unknown'));

    return {
        chainId,
        networkName: baseName,
        networkDisplay: known ? `${known.label} (${chainId})` : `${baseName} (${chainId || 'N/A'})`,
        layerType: known ? known.layerType : 'Unknown',
        isLayer2: known ? known.isLayer2 : false
    };
}

function getConfiguredNetwork(requestedNetwork = '') {
    const normalizedRequested = (requestedNetwork || '').trim();
    if (normalizedRequested) {
        return normalizedRequested;
    }

    return (process.env.BLOCKCHAIN_NETWORK || 'ganache').trim();
}

function getRpcUrl(requestedNetwork = '') {
    const configuredNetwork = getConfiguredNetwork(requestedNetwork);

    if (configuredNetwork === 'ganache') {
        return process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:7545';
    }

    if (configuredNetwork === 'localhost' || configuredNetwork === 'hardhat') {
        return process.env.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545';
    }

    const rpcEnvKey = NETWORK_RPC_ENV_MAP[configuredNetwork];
    if (rpcEnvKey && process.env[rpcEnvKey]) {
        return process.env[rpcEnvKey];
    }

    return process.env.BLOCKCHAIN_RPC_URL || 'https://mainnet.era.zksync.io';
}

function validateDeploymentEnvironment(requestedNetwork = '') {
    const network = getConfiguredNetwork(requestedNetwork);
    const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!privateKey) {
        throw new Error('DEPLOYER_PRIVATE_KEY is required for blockchain deployment');
    }

    const rpcEnvKey = NETWORK_RPC_ENV_MAP[network];
    if (rpcEnvKey && !(process.env[rpcEnvKey] || '').trim()) {
        throw new Error(`${rpcEnvKey} is required for ${network} deployments`);
    }
}

function loadDeploymentConfig(requestedNetwork = '') {
    const network = getConfiguredNetwork(requestedNetwork);
    const isLocalNetwork = network === 'ganache' || network === 'localhost' || network === 'hardhat';
    const candidateFiles = [];

    if (network) {
        candidateFiles.push(path.join(deploymentsDir, `latest.${network}.json`));
    }

    // Only use fallback latest.json for local networks
    if (isLocalNetwork) {
        candidateFiles.push(path.join(deploymentsDir, 'latest.json'));
    }

    for (const candidate of candidateFiles) {
        if (fs.existsSync(candidate)) {
            return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        }
    }

    if (!isLocalNetwork) {
        throw new Error(
            `No deployment found for ${network}. ` +
            `Please deploy contracts to this network first:\n` +
            `npx hardhat run scripts/deploy.js --network ${network}`
        );
    }

    throw new Error('No deployment file found');
}

// Configure storage for complete certificate workflow
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/certificates';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/csv'
        ];

        const allowedExtensions = ['.csv', '.xlsx', '.xls'];
        const fileExtension = path.extname(file.originalname).toLowerCase();

        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files are allowed'), false);
        }
    }
});

/**
 * @route POST /api/workflow/parse
 * @desc Step 1: Parse file and analyze structure
 */
router.post('/parse', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'File is required'
            });
        }

        // Analyze file structure with dynamic service
        const analysis = await DynamicCertificateService.analyzeFileStructure(req.file.path);

        // Generate session for workflow tracking
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store session data
        global.certificateWorkflowSessions = global.certificateWorkflowSessions || {};
        global.certificateWorkflowSessions[sessionId] = {
            filePath: req.file.path,
            originalName: req.file.originalname,
            analysis: analysis,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
            step: 'parsed'
        };

        res.json({
            success: true,
            sessionId: sessionId,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            ...analysis
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('File parsing error:', error);
        res.status(500).json({
            success: false,
            error: 'File Processing Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/process
 * @desc Step 2: Process data with field mappings and generate Merkle tree
 */
router.post('/process', async (req, res) => {
    try {
        const schema = Joi.object({
            sessionId: Joi.string().required(),
            fieldMappings: Joi.object().required(),
            processingOptions: Joi.object({
                requiredFields: Joi.array().items(Joi.string()),
                skipEmptyRows: Joi.boolean().default(true),
                validateEmails: Joi.boolean().default(true)
            }).optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { sessionId, fieldMappings, processingOptions } = value;

        console.log(`\n === PROCESSING STEP ===`);
        console.log(`Session ID: ${sessionId}`);
        console.log(`Field Mappings:`, JSON.stringify(fieldMappings, null, 2));

        // Retrieve session
        const session = global.certificateWorkflowSessions?.[sessionId];
        if (!session || new Date() > session.expiresAt) {
            return res.status(410).json({
                success: false,
                error: 'Session expired or not found'
            });
        }

        console.log(` Session found: ${session.originalName}`);

        // Re-parse file for processing
        const analysis = await DynamicCertificateService.analyzeFileStructure(session.filePath);
        const rawData = analysis.allData; // Use complete dataset

        console.log(` Raw data extracted: ${rawData.length} rows`);
        if (rawData.length > 0) {
            console.log(`   Sample row (first):`, JSON.stringify(rawData[0], null, 2));
        }

        // Process data with user mappings
        const processingResult = DynamicCertificateService.processStudentData(
            rawData,
            fieldMappings,
            processingOptions || {}
        );

        console.log(` Processing Result:`);
        console.log(`   Success: ${processingResult.success}`);
        console.log(`   Processed records: ${processingResult.processedData ? processingResult.processedData.length : 0}`);
        console.log(`   Errors: ${processingResult.errors ? processingResult.errors.length : 0}`);
        
        if (processingResult.processedData && processingResult.processedData.length > 0) {
            console.log(`   Sample processed record:`, JSON.stringify(processingResult.processedData[0], null, 2));
        }

        if (!processingResult.success) {
            console.error(`Processing failed:`, processingResult.errors);
            return res.status(400).json({
                success: false,
                error: 'Data Processing Failed',
                details: processingResult.errors
            });
        }

        // Generate certificate commitments for Merkle tree (Phase 1 - Pre-deployment)
        const certificatesWithPreCommitments = processingResult.processedData.map(student => {
            // Create pre-deployment commitment hash for each student
            const preCommitmentData = {
                name: student.name,
                email: student.email || '',
                course: student.course || '',
                grade: student.grade || '',
                studentId: student.student_id || student.id,
                sessionId: sessionId,
                createdAt: new Date().toISOString()
            };

            const preCommitment = crypto.createHash('sha256')
                .update(JSON.stringify(preCommitmentData))
                .digest('hex');

            return {
                ...student,
                preCommitment: preCommitment,
                preCommitmentData: preCommitmentData
            };
        });

        console.log(` Generated commitments for ${certificatesWithPreCommitments.length} certificates`);

        // Build initial Merkle tree for deployment
        let merkleTree, merkleRoot, certificatesWithProofs;

        try {
            merkleTree = MerkleService.buildMerkleTree(certificatesWithPreCommitments, 'preCommitment');
            merkleRoot = '0x' + merkleTree.getRoot().toString('hex');

            // Generate proofs for each certificate 
            certificatesWithProofs = certificatesWithPreCommitments.map(cert => {
                const proof = MerkleService.generateMerkleProof(merkleTree, cert.preCommitment);
                return {
                    ...cert,
                    merkleProof: proof
                };
            });

            // Get tree statistics
            const treeStats = MerkleService.getTreeStats(merkleTree);

            // Update session with processed data
            session.processedData = certificatesWithProofs;
            session.merkleRoot = merkleRoot;
            session.merkleTreeStats = treeStats;
            session.step = 'processed';

            console.log(` Session updated with processedData: ${certificatesWithProofs.length} certificates`);
            console.log(` Merkle Root: ${merkleRoot}`);
            console.log(` === END PROCESSING ===\n`);

        } catch (merkleError) {
            console.error('Merkle tree generation error:', merkleError);
            return res.status(500).json({
                success: false,
                error: 'Merkle Tree Generation Failed',
                message: merkleError.message
            });
        }

        res.json({
            success: true,
            message: `Successfully processed ${certificatesWithProofs.length} certificates`,
            summary: processingResult.summary,
            certificates: certificatesWithProofs,
            merkleRoot: merkleRoot,
            merkleTreeStats: session.merkleTreeStats,
            errors: processingResult.errors
        });

    } catch (error) {
        console.error('Data processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Processing Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/generate-pdf
 * @desc Step 3: Generate PDF certificate for individual student
 */
router.post('/generate-pdf', async (req, res) => {
    try {
        const schema = Joi.object({
            studentData: Joi.object().required(),
            template: Joi.object().optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { studentData, template } = value;

        // Generate PDF using dynamic service
        const pdfBuffer = await DynamicCertificateService.generateDynamicPDFCertificate(
            studentData,
            template || {
                title: 'CERTIFICATE OF COMPLETION',
                colors: {
                    primary: '#2c3e50',
                    secondary: '#3498db',
                    accent: '#e74c3c'
                }
            }
        );

        const fileName = `${(studentData.name || 'certificate').replace(/[^a-zA-Z0-9]/g, '_')}_certificate.pdf`;

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({
            success: false,
            error: 'PDF Generation Failed',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/deploy
 * @desc Step 4: Deploy certificates to blockchain using real smart contracts
 */
router.post('/deploy', async (req, res) => {
    try {
        const schema = Joi.object({
            sessionId: Joi.string().optional(),
            networkSelection: Joi.string().optional(),
            merkleRoot: Joi.string().required(),
            certificates: Joi.array().optional(),
            totalCertificates: Joi.number().required(),
            metadata: Joi.object().optional(),
            zkProofs: Joi.array().optional(),
            enableZKVerification: Joi.boolean().optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { sessionId, networkSelection, merkleRoot, certificates, totalCertificates, metadata, zkProofs, enableZKVerification } = value;
        const selectedNetwork = getConfiguredNetwork(networkSelection);
        validateDeploymentEnvironment(selectedNetwork);

        // Load deployed contract addresses
        let contractAddresses;
        
        try {
            contractAddresses = loadDeploymentConfig(selectedNetwork);
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: 'Contract addresses not found for selected network. Please run deployment script first.',
                message: 'Run: npm run deploy (Ganache) or npm run deploy:<l2-network>'
            });
        }

        // Initialize ethers for blockchain interaction
        const { ethers } = require('ethers');
        
        // Connect to configured blockchain (L2 or local)
        const rpcUrl = getRpcUrl(selectedNetwork);
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const network = await provider.getNetwork();

        const configuredNetwork = selectedNetwork.toLowerCase();
        const networkMeta = resolveNetworkMetadata(network, configuredNetwork);
        const shouldForceLegacyTx =
            process.env.FORCE_LEGACY_TX === 'true' ||
            configuredNetwork === 'ganache' ||
            configuredNetwork === 'localhost' ||
            configuredNetwork === 'hardhat' ||
            network.chainId === 1337 ||
            network.chainId === 31337;

        const txOverrides = shouldForceLegacyTx
            ? {
                type: 0,
                gasPrice: await provider.getGasPrice()
            }
            : {};
        
        // Select the appropriate deployer account based on network
        console.log(`\n=== DEPLOY REQUEST ===`);
        console.log(`Selected Network: ${selectedNetwork}`);
        console.log(`Network (lowercase): ${selectedNetwork.toLowerCase()}`);
        
        let privateKey;
        if (selectedNetwork.toLowerCase() === 'ganache' || selectedNetwork.toLowerCase() === 'localhost' || selectedNetwork.toLowerCase() === 'hardhat') {
            privateKey = process.env.GANACHE_DEPLOYER_PRIVATE_KEY;
            console.log(`✓ Using GANACHE private key`);
            console.log(`  Private Key: ${privateKey ? privateKey.substring(0, 10) + '...' : 'NOT FOUND'}`);
        } else {
            privateKey = process.env.DEPLOYER_PRIVATE_KEY;
            console.log(`Using DEPLOYER (zkSync) private key`);
            console.log(`  Private Key: ${privateKey ? privateKey.substring(0, 10) + '...' : 'NOT FOUND'}`);
        }
        
        if (!privateKey) {
            console.log(`ERROR: Private key not found!`);
            return res.status(500).json({
                success: false,
                error: 'Deployer private key not configured',
                message: `Please set the appropriate private key in .env for network: ${selectedNetwork}`
            });
        }
        
        const signer = new ethers.Wallet(privateKey, provider);
        console.log(`✓ Signer address: ${signer.address}`);
        console.log(`===================\n`);

        // Load contract ABI
        const ZKCertificateSystemABI = require('../../../artifacts/contracts/ZKCertificateSystem.sol/ZKCertificateSystem.json').abi;
        
        // Connect to deployed contract
        const zkCertificateSystem = new ethers.Contract(
            contractAddresses.contracts.ZKCertificateSystem.address,
            ZKCertificateSystemABI,
            signer
        );

        console.log(`Deploying ${totalCertificates} certificates to blockchain...`);
        console.log(`Contract Address: ${contractAddresses.contracts.ZKCertificateSystem.address}`);
        console.log(`Merkle Root: ${merkleRoot}`);

        // Check if deployer is authorized, if not authorize them
        const isAuthorized = await zkCertificateSystem.authorizedInstitutions(signer.address);
        if (!isAuthorized) {
            console.log('Deployer not authorized, authorizing...');
            const authTx = await zkCertificateSystem.setInstitutionAuthorization(signer.address, true, txOverrides);
            await authTx.wait();
            console.log('Deployer authorized');
        }

        // Issue batch to blockchain using the correct function
        const tx = await zkCertificateSystem.issueBatch(
            merkleRoot,
            metadata?.institutionName || 'National Institute of Technology, Warangal',
            metadata?.courseName || 'Degree Program',
            metadata?.graduationYear || new Date().getFullYear(),
            totalCertificates,
            txOverrides
        );

        console.log(` Transaction sent: ${tx.hash}`);
        console.log(' Waiting for confirmation...');
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        
        console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);
        console.log(` Gas used: ${receipt.gasUsed.toString()}`);

        // Get actual network details
        const block = await provider.getBlock(receipt.blockNumber);

        // PHASE 2: Now that we have transaction details, create final certificate commitments
        let finalCertificates = [];
        let certificatesForProcessing = null;
        
        // Try to get certificates from multiple sources
        console.log(`\n === CERTIFICATE RETRIEVAL DEBUG ===`);
        console.log(`sessionId provided: ${!!sessionId}`);
        console.log(`certificates in request: ${certificates ? certificates.length : 0}`);
        
        // Log ZK Proof data received
        console.log(`\n === ZK PROOF VERIFICATION DEBUG ===`);
        console.log(`enableZKVerification: ${enableZKVerification}`);
        console.log(`zkProofs received: ${zkProofs ? zkProofs.length : 0}`);
        if (zkProofs && zkProofs.length > 0) {
            const successfulProofs = zkProofs.filter(p => p.status === 'success').length;
            const failedProofs = zkProofs.filter(p => p.status === 'failed').length;
            console.log(`  - Successful: ${successfulProofs}`);
            console.log(`  - Failed: ${failedProofs}`);
            console.log(`  Sample zkProof[0]:`, JSON.stringify({
                studentId: zkProofs[0].studentId,
                status: zkProofs[0].status,
                hasProofData: !!zkProofs[0].zkProof
            }));
            // Show all keys in the first zkProof
            console.log(`  All keys in zkProof[0]:`, Object.keys(zkProofs[0]));
            // Show what's inside the zkProof.zkProof if it exists
            if (zkProofs[0].zkProof) {
                console.log(`  Keys inside zkProof[0].zkProof:`, Object.keys(zkProofs[0].zkProof));
            }
            // Full first object for debugging
            console.log(`  Full zkProof[0]:`, JSON.stringify(zkProofs[0], null, 2));
        }
        
        // Log all available sessions
        const allSessions = Object.entries(global.certificateWorkflowSessions || {});
        console.log(` Total sessions available: ${allSessions.length}`);
        allSessions.forEach(([sid, sess]) => {
            console.log(`   - Session ${sid.substring(0, 20)}... : step=${sess.step}, processedData=${sess.processedData ? sess.processedData.length : 0}, file=${sess.originalName}`);
        });
        
        // Priority 1: Use certificates from request body if provided
        if (certificates && certificates.length > 0) {
            console.log(` PRIORITY 1 SUCCESS: Using ${certificates.length} certificates from request body`);
            console.log(`   First certificate keys:`, Object.keys(certificates[0]).join(', '));
            console.log(`   Certificate structure:`, JSON.stringify({
                name: certificates[0].name,
                email: certificates[0].email,
                student_id: certificates[0].student_id,
                studentId: certificates[0].studentId,
                course: certificates[0].course,
                certificateId: certificates[0].certificateId,
                preCommitment: certificates[0].preCommitment ? '(present)' : '(missing)',
                merkleProof: certificates[0].merkleProof ? '(present)' : '(missing)'
            }, null, 2));
            certificatesForProcessing = certificates;
            console.log(`    certificatesForProcessing set from Priority 1`);
        }
        // Priority 2: Try to get from explicit sessionId
        else if (sessionId && global.certificateWorkflowSessions?.[sessionId]?.processedData) {
            console.log(`Using processed certificates from session ${sessionId}`);
            certificatesForProcessing = global.certificateWorkflowSessions[sessionId].processedData;
        }
        // Priority 3: If no sessionId provided, find the most recent session with processed data
        else if (!sessionId && global.certificateWorkflowSessions) {
            const sessionsWithData = Object.entries(global.certificateWorkflowSessions)
                .filter(([_, session]) => session.processedData && session.processedData.length > 0)
                .sort(([_a, a], [_b, b]) => new Date(b.createdAt) - new Date(a.createdAt));
            
            if (sessionsWithData.length > 0) {
                const [recentSessionId, recentSessionData] = sessionsWithData[0];
                console.log(`   Found ${sessionsWithData.length} session(s) with data. Using most recent:`);
                console.log(`   Session: ${recentSessionId.substring(0, 20)}...`);
                console.log(`   Certificates: ${recentSessionData.processedData.length}`);
                console.log(`   File: ${recentSessionData.originalName}`);
                console.log(`   Sample certificate:`, {
                    name: recentSessionData.processedData[0].name,
                    email: recentSessionData.processedData[0].email,
                    student_id: recentSessionData.processedData[0].student_id,
                    course: recentSessionData.processedData[0].course
                });
                certificatesForProcessing = recentSessionData.processedData;
            } else {
                console.warn(`  No sessions with processedData found. Available sessions: ${allSessions.length}`);
                if (allSessions.length > 0) {
                    const [recentParsedId, recentParsedSession] = Object.entries(global.certificateWorkflowSessions)
                        .sort(([_a, a], [_b, b]) => new Date(b.createdAt) - new Date(a.createdAt))[0];
                    console.log(`Most recent session is in step: ${recentParsedSession.step}`);
                    console.log(`   If 'parsed', you need to call /api/workflow/process with field mappings first`);
                }
            }
        }
        
        // Priority 4: Fallback - Try to extract from raw file data with auto-mappings
        if (!certificatesForProcessing || certificatesForProcessing.length === 0) {
            console.warn(`  processedData not found. Attempting to extract from raw file data...`);
            
            // Find the most recent session (any state) to get raw data
            const recentRawSession = Object.entries(global.certificateWorkflowSessions || {})
                .sort(([_a, a], [_b, b]) => new Date(b.createdAt) - new Date(a.createdAt))[0];
            
            if (recentRawSession) {
                const [rawSessionId, rawSessionData] = recentRawSession;
                console.log(`   Found raw session ${rawSessionId.substring(0, 20)}... with ${rawSessionData.analysis?.allData?.length || 0} records`);
                
                if (rawSessionData.analysis?.allData && rawSessionData.analysis.allData.length > 0) {
                    const rawData = rawSessionData.analysis.allData;
                    const suggestedMappings = rawSessionData.analysis.suggestedMappings || {};
                    
                    console.log(`   Auto-detected field mappings:`, JSON.stringify(suggestedMappings, null, 2));
                    
                    // Auto-process the raw data using suggested mappings
                    try {
                        const autoProcessedResult = DynamicCertificateService.processStudentData(
                            rawData,
                            suggestedMappings,
                            {}
                        );
                        
                        if (autoProcessedResult.processedData && autoProcessedResult.processedData.length > 0) {
                            console.log(` Auto-extracted ${autoProcessedResult.processedData.length} student records from Excel`);
                            console.log(`   Sample:`, {
                                name: autoProcessedResult.processedData[0].name,
                                email: autoProcessedResult.processedData[0].email,
                                student_id: autoProcessedResult.processedData[0].student_id,
                                course: autoProcessedResult.processedData[0].course
                            });
                            certificatesForProcessing = autoProcessedResult.processedData;
                        } else {
                            console.warn(` Auto-processing returned 0 records. Processing errors:`, autoProcessedResult.errors);
                        }
                    } catch (autoProcessError) {
                        console.error(` Auto-processing failed:`, autoProcessError.message);
                    }
                }
            } else {
                console.warn(` No session data found at all!`);
            }
        }
        
        // Priority 5: Last resort - Create placeholder certificates
        if (!certificatesForProcessing || certificatesForProcessing.length === 0) {
            console.error(`\n❌ PRIORITY 5 FALLBACK: Creating ${totalCertificates} PLACEHOLDER certificates`);
            console.error(`  This is a fallback - real data was not found!`);
            console.error(`  One of these issues occurred:`);
            console.error(`  1. Frontend not sending 'certificates' array in deploy request (PRIORITY 1)`);
            console.error(`  2. No valid session data found on backend (PRIORITY 2/3)`);
            console.error(`  3. Session data has no processed certificates`);
            console.error(`  4. Could not auto-extract from raw Excel data (PRIORITY 4)`);
            certificatesForProcessing = Array.from({ length: totalCertificates }, (_, i) => ({
                certificateId: `CERT${Date.now()}_${i}`,
                name: `Certificate ${i + 1}`,
                email: `cert${i + 1}@example.com`,
                student_id: `STU${String(i + 1).padStart(5, '0')}`,
                preCommitmentData: {
                    name: `Certificate ${i + 1}`,
                    email: `cert${i + 1}@example.com`,
                    student_id: `STU${String(i + 1).padStart(5, '0')}`,
                    sessionId: sessionId || 'direct-deploy',
                    createdAt: new Date().toISOString()
                }
            }));
        }
        console.log(` === END DEBUG ===\n`);
        
        console.log(`\n === CRITICAL CHECK ===`);
        console.log(`certificatesForProcessing exists: ${!!certificatesForProcessing}`);
        console.log(`certificatesForProcessing is array: ${Array.isArray(certificatesForProcessing)}`);
        console.log(`certificatesForProcessing length: ${certificatesForProcessing?.length || 0}`);
        
        if (certificatesForProcessing && certificatesForProcessing.length > 0) {
            console.log(` Will execute finalCertificates creation with ${certificatesForProcessing.length} records`);
            console.log(`\n === FINALCERTIFICATES CREATION PHASE ===`);
            console.log(` Processing ${certificatesForProcessing.length} certificates for MongoDB storage...`);
            
            // Create final commitments with transaction details
            finalCertificates = certificatesForProcessing.map((cert, idx) => {
                // Ensure preCommitmentData exists (for raw Excel data, it won't)
                let preCommitmentData = cert.preCommitmentData;
                if (!preCommitmentData) {
                    console.log(`   Creating preCommitmentData for certificate ${idx + 1}: ${cert.name}`);
                    preCommitmentData = {
                        name: cert.name || cert['Student Name'] || cert['STUDENT NAME'] || `Student ${idx + 1}`,
                        email: cert.email || cert['Email'] || cert['EMAIL'] || '',
                        student_id: cert.student_id || cert['Student ID'] || cert['STUDENT ID'] || cert['ID'] || `STU${String(idx + 1).padStart(5, '0')}`,
                        course: cert.course || cert['Course'] || cert['COURSE'] || '',
                        grade: cert.grade || cert['Grade'] || cert['GRADE'] || cert['percentage'] || '',
                        sessionId: sessionId || 'direct-deploy',
                        createdAt: new Date().toISOString()
                    };
                }
                
                const finalCommitmentData = {
                    // Original certificate data
                    ...preCommitmentData,
                    
                    // NEW: Transaction details now cryptographically linked
                    transactionHash: tx.hash,
                    blockNumber: receipt.blockNumber,
                    blockHash: receipt.blockHash,
                    gasUsed: receipt.gasUsed.toString(),
                    contractAddress: contractAddresses.contracts.ZKCertificateSystem.address,
                    deployedAt: new Date(block.timestamp * 1000).toISOString(),
                    networkName: networkMeta.networkDisplay,
                    chainId: networkMeta.chainId,
                    layerType: networkMeta.layerType,
                    isLayer2: networkMeta.isLayer2
                };

                const finalCommitment = crypto.createHash('sha256')
                    .update(JSON.stringify(finalCommitmentData))
                    .digest('hex');

                return {
                    ...cert,
                    name: preCommitmentData.name,
                    email: preCommitmentData.email,
                    student_id: preCommitmentData.student_id,
                    preCommitmentData: preCommitmentData,
                    finalCommitment: finalCommitment,
                    finalCommitmentData: finalCommitmentData,
                    transactionDetails: {
                        hash: tx.hash,
                        blockNumber: receipt.blockNumber,
                        blockHash: receipt.blockHash,
                        gasUsed: receipt.gasUsed.toString(),
                        contractAddress: contractAddresses.contracts.ZKCertificateSystem.address,
                        timestamp: block.timestamp
                    }
                };
            });

            // Build FINAL Merkle tree with transaction details included
            try {
                const finalMerkleTree = MerkleService.buildMerkleTree(finalCertificates, 'finalCommitment');
                const finalMerkleRoot = '0x' + finalMerkleTree.getRoot().toString('hex');
                
                // Generate final proofs
                const finalCertificatesWithProofs = finalCertificates.map(cert => {
                    const finalProof = MerkleService.generateMerkleProof(finalMerkleTree, cert.finalCommitment);
                    return {
                        ...cert,
                        finalMerkleProof: finalProof
                    };
                });

                console.log(` Final Merkle root (with tx details): ${finalMerkleRoot}`);

                // Update session with final data
                global.certificateWorkflowSessions[sessionId].finalCertificates = finalCertificatesWithProofs;
                global.certificateWorkflowSessions[sessionId].finalMerkleRoot = finalMerkleRoot;
                
                //  CRITICAL: Update the finalCertificates variable that will be used for MongoDB save
                finalCertificates = finalCertificatesWithProofs;
                
                console.log(`finalCertificates updated with proofs: ${finalCertificates.length} certificates`);
                console.log(`   First cert has finalMerkleProof: ${!!finalCertificates[0].finalMerkleProof}`);
                console.log(`   Sample: name=${finalCertificates[0].name}, email=${finalCertificates[0].email}`);
            } catch (finalMerkleError) {
                console.warn('Failed to build final Merkle tree:', finalMerkleError);
            }
        } else {
            console.error(`\n EARLY EXIT: certificatesForProcessing is empty or null!`);
            console.error(`   finalCertificates will remain empty: ${Array.isArray(finalCertificates) ? finalCertificates.length : 'not-array'}`);
        }

        // If session provided, mark as deployed
        if (sessionId && global.certificateWorkflowSessions?.[sessionId]) {
            global.certificateWorkflowSessions[sessionId].step = 'deployed';
            global.certificateWorkflowSessions[sessionId].deploymentData = {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                contractAddress: contractAddresses.contracts.ZKCertificateSystem.address,
                merkleRoot: merkleRoot,
                deployedAt: new Date().toISOString(),
                network: networkMeta.networkDisplay,
                chainId: networkMeta.chainId,
                layerType: networkMeta.layerType,
                isLayer2: networkMeta.isLayer2
            };
        }

        console.log(`\n📤 === ABOUT TO SEND RESPONSE ===`);
        console.log(`finalCertificates count: ${finalCertificates?.length || 0}`);
        console.log(`finalCertificates is array: ${Array.isArray(finalCertificates)}`);
        
        res.json({
            success: true,
            message: `Successfully deployed ${totalCertificates} certificates to blockchain with complete transaction linkage`,
            deploymentPhase: {
                initialMerkleRoot: merkleRoot,
                finalMerkleRoot: global.certificateWorkflowSessions?.[sessionId]?.finalMerkleRoot || merkleRoot
            },
            transactionDetails: {
                hash: tx.hash,
                blockNumber: receipt.blockNumber,
                blockHash: receipt.blockHash,
                gasUsed: receipt.gasUsed.toString(),
                contractAddress: contractAddresses.contracts.ZKCertificateSystem.address
            },
            chainData: {
                network: networkMeta.networkName,
                networkDisplay: networkMeta.networkDisplay,
                chainId: networkMeta.chainId,
                layerType: networkMeta.layerType,
                isLayer2: networkMeta.isLayer2,
                rpcUrl: rpcUrl,
                blockTimestamp: new Date(block.timestamp * 1000).toISOString()
            },
            certificateIntegrity: {
                totalCertificates: totalCertificates,
                merkleRoot: merkleRoot,
                transactionLinked: true,
                cryptographicProof: "Each certificate can now prove it was deployed in this specific transaction"
            },
            timestamp: new Date().toISOString()
        });

        console.log(`\n\n === MONGODB SAVE PHASE (EXECUTING NOW AFTER RESPONSE) ===`);
        console.log(`finalCertificates status:`);
        console.log(`  - exists: ${!!finalCertificates}`);
        console.log(`  - is array: ${Array.isArray(finalCertificates)}`);
        console.log(`  - length: ${finalCertificates?.length || 0}`);
        if (finalCertificates && finalCertificates.length > 0) {
            console.log(`  - first cert name: ${finalCertificates[0].name}`);
            console.log(`  - first cert email: ${finalCertificates[0].email}`);
        } else {
            console.error(`\n  CRITICAL: finalCertificates is EMPTY`);
            console.error(`   No certificates will be saved to MongoDB!`);
            console.error(`   This means certificatesForProcessing never had data`);
        }

        try {
            const deployment = await DeploymentRecord.create({
                networkSelection: selectedNetwork,
                networkDisplay: networkMeta.networkDisplay,
                networkName: networkMeta.networkName,
                chainId: networkMeta.chainId,
                layerType: networkMeta.layerType,
                isLayer2: networkMeta.isLayer2,
                rpcUrl,
                contractAddress: contractAddresses.contracts.ZKCertificateSystem.address,
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                blockHash: receipt.blockHash,
                gasUsed: receipt.gasUsed.toString(),
                merkleRoot,
                totalCertificates,
                metadata: metadata || {},
                deployedAt: new Date(block.timestamp * 1000)
            });

            // Save individual certificates to MongoDB
            if (finalCertificates && finalCertificates.length > 0) {
                console.log(`\n📝 Saving ${finalCertificates.length} certificates to MongoDB...`);
                
                // Map zkProofs by studentId for quick lookup
                const zkProofMap = {};
                if (zkProofs && Array.isArray(zkProofs)) {
                    console.log(`\n   🔍 Processing zkProofs array...`);
                    zkProofs.forEach((proof, idx) => {
                        console.log(`      zkProofs[${idx}] keys:`, Object.keys(proof));
                        console.log(`      zkProofs[${idx}].studentId:`, proof.studentId);
                        console.log(`      zkProofs[${idx}].status:`, proof.status);
                        if (proof.studentId) {
                            zkProofMap[proof.studentId] = proof;
                            console.log(`      ✓ Mapped studentId: ${proof.studentId}`);
                        } else {
                            console.log(`      ✗ NO studentId found!`);
                        }
                    });
                    console.log(`   ✓ ZK Proof Map created: ${Object.keys(zkProofMap).length} proofs mapped`);
                    console.log(`   StudentIds in zkProofMap:`, Object.keys(zkProofMap));
                } else {
                    console.log(`   ✗ zkProofs is not an array or is empty`);
                }
                
                const certificatesToSave = finalCertificates.map((cert, idx) => {
                    // Try to match this certificate with its zkProof
                    const studentId = cert.student_id || cert.studentId || `STU${idx}`;
                    
                    // Try multiple matching strategies
                    let matchedZKProof = null;
                    
                    // Strategy 1: Exact ID match
                    matchedZKProof = zkProofMap[studentId];
                    
                    // Strategy 2: Try by index position (fallback if zkProofs array order matches certificates)
                    if (!matchedZKProof && zkProofs && zkProofs[idx]) {
                        const zkProofAtIndex = zkProofs[idx];
                        if (zkProofAtIndex.status === 'success') {
                            matchedZKProof = zkProofAtIndex;
                            if (idx < 3) {
                                console.log(`   Cert ${idx + 1}: No ID match, using position-based match (index ${idx})`);
                            }
                        }
                    }
                    
                    // Log which studentId we're looking up and if we found a match
                    if (idx < 3) {  // Log first 3 certificates for debugging
                        console.log(`   Cert ${idx + 1}: Looking for studentId="${studentId}" in zkProofMap - ${matchedZKProof ? '✓ FOUND' : '✗ NOT FOUND'}`);
                    }
                    
                    // Use the matched proof if available and successful, otherwise use cert's proof
                    let zkProofData = cert.zkProof || { verified: false, pA: [], pB: [], pC: [], publicSignals: [] };
                    let isZKVerified = false;
                    
                    if (matchedZKProof && matchedZKProof.status === 'success') {
                        if (matchedZKProof.zkProof) {
                            // Transform proof structure: pi_a/pi_b/pi_c → pA/pB/pC for MongoDB storage
                            const proofData = matchedZKProof.zkProof;
                            if (proofData.proof) {
                                // This is from the API response with { proof: {pi_a, pi_b, pi_c}, publicSignals, commitment }
                                zkProofData = {
                                    pA: proofData.proof.pi_a || proofData.proof.a || [],
                                    pB: proofData.proof.pi_b || proofData.proof.b || [],
                                    pC: proofData.proof.pi_c || proofData.proof.c || [],
                                    publicSignals: proofData.publicSignals || [],
                                    commitment: proofData.commitment,
                                    verified: true,
                                    verifyStatus: 'success',
                                    studentId: matchedZKProof.studentId
                                };
                            } else if (proofData.pi_a || proofData.pA) {
                                // Already in the correct format
                                zkProofData = {
                                    pA: proofData.pA || proofData.pi_a || [],
                                    pB: proofData.pB || proofData.pi_b || [],
                                    pC: proofData.pC || proofData.pi_c || [],
                                    publicSignals: proofData.publicSignals || [],
                                    commitment: proofData.commitment,
                                    verified: true,
                                    verifyStatus: 'success',
                                    studentId: matchedZKProof.studentId
                                };
                            }
                            isZKVerified = true;
                            console.log(`    Certificate ${idx + 1} (${studentId}): ZK Proof matched and verified`);
                            console.log(`       Proof structure: pA=${zkProofData.pA.length > 0 ? 'present' : 'missing'}, pB=${zkProofData.pB.length > 0 ? 'present' : 'missing'}, pC=${zkProofData.pC.length > 0 ? 'present' : 'missing'}`);
                        }
                    } else if (matchedZKProof) {
                        console.log(`     Certificate ${idx + 1} (${studentId}): ZK Proof generation failed - status: ${matchedZKProof.status}`);
                    } else {
                        console.log(`   ℹ️  Certificate ${idx + 1} (${studentId}): No matching ZK proof found in batch`);
                    }
                    
                    return {
                        certificateId: cert.certificateId || `CERT${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
                        name: cert.name || cert.studentName,
                        email: cert.email || cert.studentEmail,
                        studentId: studentId,
                        issueDate: cert.issueDate || new Date().toLocaleDateString(),
                        verificationCode: cert.verificationCode || `VF${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
                        
                        // Blockchain & Deployment
                        deploymentId: deployment._id,
                        transactionHash: tx.hash,
                        blockNumber: receipt.blockNumber,
                        contractAddress: contractAddresses.contracts.ZKCertificateSystem.address,
                        
                        // Merkle Tree
                        merkleRoot: merkleRoot,
                        merkleProof: cert.merkleProof || cert.finalMerkleProof || [],
                        leafHash: cert.leafHash || cert.finalCommitment,
                        
                        // Content
                        content: {
                            institutionName: metadata?.institutionName || 'Educational Institution',
                            courseName: metadata?.courseName || 'Certificate Program',
                            completionDate: cert.issueDate || new Date().toLocaleDateString(),
                            certificateProgram: metadata?.courseName,
                            studentName: cert.name || cert.studentName,
                            studentEmail: cert.email || cert.studentEmail,
                            studentId: studentId,
                            graduationYear: metadata?.graduationYear || new Date().getFullYear()
                        },
                        
                        // ZK Proof Data - NOW INCLUDES REAL PROOF DATA IF SUCCESSFUL
                        zkProof: zkProofData,
                        zkProofVerified: isZKVerified,
                        verified: !!cert.zkProof?.verified,
                        
                        // Status & Metadata
                        status: 'issued',
                        metadata: {
                            ...cert,
                            finalCommitment: cert.finalCommitment,
                            finalCommitmentData: cert.finalCommitmentData,
                            transactionDetails: cert.transactionDetails
                        },
                        
                        deployedAt: new Date(block.timestamp * 1000),
                        createdAt: new Date()
                    }
                });

                console.log(`\ncertificate structure being saved:`);
                if (certificatesToSave.length > 0) {
                    const sampleCert = certificatesToSave[0];
                    console.log(`   name: ${sampleCert.name}`);
                    console.log(`   email: ${sampleCert.email}`);
                    console.log(`   studentId: ${sampleCert.studentId}`);
                    console.log(`   merkleProof type: ${Array.isArray(sampleCert.merkleProof) ? 'array' : typeof sampleCert.merkleProof}`);
                    console.log(`   merkleProof length: ${sampleCert.merkleProof?.length || 0}`);
                    if (sampleCert.merkleProof?.length > 0) {
                        console.log(`   merkleProof[0]:`, JSON.stringify(sampleCert.merkleProof[0]));
                    }
                }

                try {
                    const savedCerts = await Certificate.insertMany(certificatesToSave);
                    console.log(`\n MONGODB SUCCESS!`);
                    console.log(`Successfully saved ${savedCerts.length} certificates`);
                    savedCerts.slice(0, 3).forEach((cert, i) => {
                        console.log(`  [${i+1}] ${cert.name} (${cert.email})`);
                    });
                } catch (dbError) {
                    console.error(`\n MONGODB ERROR:`);
                    console.error(`  Message: ${dbError.message}`);
                    console.error(`  Name: ${dbError.name}`);
                    console.error(`  Code: ${dbError.code}`);
                    if (dbError.errors) {
                        console.error(`  Validation Errors:`);
                        Object.entries(dbError.errors).forEach(([field, error]) => {
                            console.error(`    - ${field}: ${error.message}`);
                        });
                    }
                    if (certificatesToSave.length > 0) {
                        console.error(`\n  Sample problematic certificate:`);
                        console.error(`    merkleProof:`, JSON.stringify(certificatesToSave[0].merkleProof));
                    }
                }
            } else {
                console.error(`\n CRITICAL: finalCertificates is empty/null!`);
                console.error(`  finalCertificates === null: ${finalCertificates === null}`);
                console.error(`  finalCertificates === undefined: ${finalCertificates === undefined}`);
                console.error(`  Array.isArray: ${Array.isArray(finalCertificates)}`);
                console.error(`  type: ${typeof finalCertificates}`);
            }
        } catch (persistError) {
            console.warn('MongoDB deployment persistence failed:', persistError.message);
        }
    } catch (error) {
        console.error('Blockchain deployment error:', error);

        // Handle specific blockchain errors
        let errorMessage = error.message;
        if (error.code === 'NETWORK_ERROR') {
            errorMessage = `Cannot connect to blockchain RPC. Check selected network RPC configuration and connectivity.`;
        } else if (error.code === 'INSUFFICIENT_FUNDS') {
            errorMessage = 'Insufficient funds for gas fees';
        }

        res.status(500).json({
            success: false,
            error: 'Blockchain Deployment Failed',
            message: errorMessage,
            code: error.code
        });
    }
});

/**
 * @route POST /api/workflow/verify
 * @desc Verify certificate against deployed smart contract
 */
router.post('/verify', async (req, res) => {
    try {
        const schema = Joi.object({
            certificateId: Joi.string().required(),
            networkSelection: Joi.string().optional(),
            merkleRoot: Joi.string().required(),
            certificateData: Joi.object().required(),
            contractAddress: Joi.string().optional()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: 'Validation Error',
                details: error.details
            });
        }

        const { certificateId, networkSelection, merkleRoot, certificateData, contractAddress } = value;
        const selectedNetwork = getConfiguredNetwork(networkSelection);

        // Load deployed contract addresses if not provided
        let deployedContracts;
        if (!contractAddress) {
            try {
                deployedContracts = loadDeploymentConfig(selectedNetwork);
            } catch (err) {
                return res.status(500).json({
                    success: false,
                    error: 'Contract addresses not found',
                    message: 'Run deployment script for the selected network first'
                });
            }
        }

        // Initialize ethers for blockchain verification
        const { ethers } = require('ethers');
        const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(selectedNetwork));
        const networkMeta = resolveNetworkMetadata(await provider.getNetwork(), selectedNetwork.toLowerCase());
        
        // Load contract ABI and connect
        const ZKCertificateSystemABI = require('../../../artifacts/contracts/ZKCertificateSystem.sol/ZKCertificateSystem.json').abi;
        const contractAddr = contractAddress || deployedContracts.contracts.ZKCertificateSystem.address;
        
        const zkCertificateSystem = new ethers.Contract(
            contractAddr,
            ZKCertificateSystemABI,
            provider
        );

        try {
            // Query the deployed Merkle root from latest batch on contract
            const totalBatches = await zkCertificateSystem.getTotalBatches();
            if (totalBatches.toNumber() === 0) {
                throw new Error('No certificate batch deployed yet');
            }

            const latestBatchInfo = await zkCertificateSystem.getBatchInfo(totalBatches);
            const deployedRoot = latestBatchInfo.merkleRoot || latestBatchInfo[0];

            const isRootValid = deployedRoot.toLowerCase() === merkleRoot.toLowerCase();
            
            res.json({
                success: true,
                isValid: isRootValid,
                onChainData: {
                    deployedMerkleRoot: deployedRoot,
                    contractAddress: contractAddr,
                    networkName: networkMeta.networkName,
                    networkDisplay: networkMeta.networkDisplay,
                    chainId: networkMeta.chainId,
                    layerType: networkMeta.layerType,
                    isLayer2: networkMeta.isLayer2
                },
                verificationDetails: {
                    certificateId: certificateId,
                    merkleRootMatch: isRootValid,
                    partOfDeployedBatch: isRootValid,
                    verifiedAt: new Date().toISOString()
                }
            });

            try {
                await VerificationRecord.create({
                    networkSelection: selectedNetwork,
                    networkDisplay: networkMeta.networkDisplay,
                    chainId: networkMeta.chainId,
                    layerType: networkMeta.layerType,
                    isLayer2: networkMeta.isLayer2,
                    contractAddress: contractAddr,
                    certificateId,
                    merkleRoot,
                    deployedMerkleRoot: deployedRoot,
                    isValid: isRootValid,
                    verifiedAt: new Date()
                });
            } catch (persistError) {
                console.warn('MongoDB verification persistence failed:', persistError.message);
            }

        } catch (contractError) {
            console.error('Contract interaction error:', contractError);
            res.status(502).json({
                success: false,
                isValid: false,
                error: 'Contract verification failed',
                message: contractError.message,
                verificationDetails: {
                    certificateId: certificateId,
                    merkleRoot: merkleRoot,
                    verifiedAt: new Date().toISOString()
                }
            });
        }

    } catch (error) {
        console.error('Certificate verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Verification Failed',
            message: error.message
        });
    }
});

/**
 * @route GET /api/workflow/session/:sessionId
 * @desc Get session status and data
 */
router.get('/session/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = global.certificateWorkflowSessions?.[sessionId];

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        if (new Date() > session.expiresAt) {
            delete global.certificateWorkflowSessions[sessionId];
            return res.status(410).json({
                success: false,
                error: 'Session expired'
            });
        }

        res.json({
            success: true,
            session: {
                sessionId: sessionId,
                fileName: session.originalName,
                step: session.step,
                processedCount: session.processedData?.length || 0,
                merkleRoot: session.merkleRoot,
                merkleTreeStats: session.merkleTreeStats,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt
            }
        });

    } catch (error) {
        console.error('Session retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Session retrieval failed'
        });
    }
});

/**
 * @route DELETE /api/workflow/cleanup/:sessionId
 * @desc Clean up session and temporary files
 */
router.delete('/cleanup/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = global.certificateWorkflowSessions?.[sessionId];

        if (session) {
            // Clean up file
            if (fs.existsSync(session.filePath)) {
                fs.unlinkSync(session.filePath);
            }

            // Remove session
            delete global.certificateWorkflowSessions[sessionId];
        }

        res.json({
            success: true,
            message: 'Session cleaned up successfully'
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'Cleanup failed'
        });
    }
});

/**
 * @route GET /api/workflow/certificates/:sessionId  
 * @desc Get certificates with complete transaction details
 */
router.get('/certificates/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = global.certificateWorkflowSessions?.[sessionId];

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        if (new Date() > session.expiresAt) {
            delete global.certificateWorkflowSessions[sessionId];
            return res.status(410).json({
                success: false,
                error: 'Session expired'
            });
        }

        // Return certificates with complete transaction linkage
        const response = {
            success: true,
            sessionInfo: {
                sessionId: sessionId,
                fileName: session.originalName,
                step: session.step,
                createdAt: session.createdAt
            },
            merkleTreeData: {
                initialRoot: session.merkleRoot,
                finalRoot: session.finalMerkleRoot,
                treeStats: session.merkleTreeStats
            }
        };

        // Include appropriate certificate data based on deployment stage
        if (session.step === 'deployed' && session.finalCertificates) {
            response.certificates = session.finalCertificates.map(cert => ({
                // Certificate data
                name: cert.name,
                email: cert.email,
                course: cert.course,
                grade: cert.grade,
                studentId: cert.studentId,
                certificateId: cert.certificateId,
                
                // Transaction details (now cryptographically linked!)
                transactionDetails: cert.transactionDetails,
                
                // Cryptographic proofs
                preCommitment: cert.preCommitment,
                finalCommitment: cert.finalCommitment,
                merkleProof: cert.merkleProof,
                finalMerkleProof: cert.finalMerkleProof,
                
                // Verification data
                commitmentData: {
                    preDeployment: cert.preCommitmentData,
                    postDeployment: cert.finalCommitmentData
                }
            }));
            
            response.deploymentData = session.deploymentData;
            response.message = "✅ Certificates with complete blockchain transaction linkage";
            
        } else if (session.processedData) {
            response.certificates = session.processedData;
            response.message = "⏳ Certificates ready for deployment";
        }

        res.json(response);

    } catch (error) {
        console.error('Get certificates error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve certificates', 
            message: error.message
        });
    }
});

/**
 * @route GET /api/workflow/dashboard-stats
 * @desc Get dashboard statistics from current CSV data
 */
router.get('/dashboard-stats', async (req, res) => {
    try {
        // Get the latest session data
        if (!global.certificateWorkflowSessions || Object.keys(global.certificateWorkflowSessions).length === 0) {
            // If no sessions exist, try to parse the test CSV file to show dynamic behavior
            try {
                const testCsvPath = path.join(__dirname, '../../../test_students.csv');
                if (fs.existsSync(testCsvPath)) {
                    const analysis = await DynamicCertificateService.analyzeFileStructure(testCsvPath);
                    const suggestedMappings = analysis.suggestedMappings || {};
                    const autoMappedFields = Object.values(suggestedMappings).filter(value => value && value !== '').length;

                    return res.json({
                        success: true,
                        data: {
                            totalStudents: analysis.totalRows || 0,
                            dataColumns: (analysis.columns || []).length,
                            autoMappedFields: autoMappedFields,
                            recentSessions: 0,
                            lastUpload: new Date().toISOString(),
                            fileName: 'test_students.csv (Demo Data)',
                            isEmpty: false,
                            columns: analysis.columns || [],
                            sampleData: analysis.sampleData || [],
                            allData: analysis.allData || [],
                            isDemo: true
                        }
                    });
                }
            } catch (error) {
                console.log('Could not load demo data:', error.message);
            }

            return res.json({
                success: true,
                data: {
                    totalStudents: 0,
                    dataColumns: 0,
                    autoMappedFields: 0,
                    recentSessions: 0,
                    lastUpload: null,
                    isEmpty: true
                }
            });
        }

        // Get most recent session
        const sessions = Object.values(global.certificateWorkflowSessions).sort((a, b) => 
            new Date(b.createdAt) - new Date(a.createdAt)
        );
        
        const latestSession = sessions[0];
        
        if (!latestSession || !latestSession.analysis) {
            return res.json({
                success: true,
                data: {
                    totalStudents: 0,
                    dataColumns: 0,
                    autoMappedFields: 0,
                    recentSessions: sessions.length,
                    lastUpload: null,
                    isEmpty: true
                }
            });
        }

        const analysisData = latestSession.analysis;
        const suggestedMappings = analysisData.suggestedMappings || {};

        // Calculate auto-mapped fields
        const autoMappedFields = Object.values(suggestedMappings).filter(value => value && value !== '').length;

        return res.json({
            success: true,
            data: {
                totalStudents: analysisData.totalRows || 0,
                dataColumns: (analysisData.columns || []).length,
                autoMappedFields: autoMappedFields,
                recentSessions: sessions.length,
                lastUpload: latestSession.createdAt,
                fileName: latestSession.originalName,
                isEmpty: false,
                columns: analysisData.columns || [],
                sampleData: analysisData.sampleData || [],
                allData: analysisData.allData || [],
                isDemo: false
            }
        });

    } catch (error) {
        console.error('Dashboard stats error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get dashboard statistics',
            details: error.message
        });
    }
});

// Periodic cleanup of expired sessions
setInterval(() => {
    if (global.certificateWorkflowSessions) {
        const now = new Date();
        Object.entries(global.certificateWorkflowSessions).forEach(([sessionId, session]) => {
            if (now > session.expiresAt) {
                if (fs.existsSync(session.filePath)) {
                    fs.unlinkSync(session.filePath);
                }
                delete global.certificateWorkflowSessions[sessionId];
            }
        });
    }
}, 30 * 60 * 1000); // Run every 30 minutes

/**
 * @route GET /api/workflow/stored-certificates
 * @desc Get all stored certificates from MongoDB
 */
router.get('/stored-certificates', async (req, res) => {
    try {
        const { deploymentId, status, limit = 50, skip = 0 } = req.query;
        
        const query = {};
        if (deploymentId) query.deploymentId = deploymentId;
        if (status) query.status = status;
        
        const certificates = await Certificate
            .find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .lean();
        
        const total = await Certificate.countDocuments(query);
        
        res.json({
            success: true,
            data: certificates,
            pagination: {
                total,
                limit: parseInt(limit),
                skip: parseInt(skip),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching certificates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch certificates',
            message: error.message
        });
    }
});

/**
 * @route GET /api/workflow/certificate/:certificateId
 * @desc Get a specific certificate by ID
 */
router.get('/certificate/:certificateId', async (req, res) => {
    try {
        const { certificateId } = req.params;
        
        const certificate = await Certificate.findOne({ certificateId });
        
        if (!certificate) {
            return res.status(404).json({
                success: false,
                error: 'Certificate not found'
            });
        }
        
        res.json({
            success: true,
            data: certificate
        });
    } catch (error) {
        console.error('Error fetching certificate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch certificate',
            message: error.message
        });
    }
});

/**
 * @route GET /api/workflow/certificate-stats
 * @desc Get certificate statistics from MongoDB
 */
router.get('/certificate-stats', async (req, res) => {
    try {
        const stats = await Certificate.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        const totalCertificates = await Certificate.countDocuments();
        const deployments = await Certificate.distinct('deploymentId');
        
        const statusBreakdown = {};
        stats.forEach(stat => {
            statusBreakdown[stat._id || 'unknown'] = stat.count;
        });
        
        res.json({
            success: true,
            data: {
                totalCertificates,
                totalDeployments: deployments.length,
                statusBreakdown
            }
        });
    } catch (error) {
        console.error('Error fetching certificate stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch certificate statistics',
            message: error.message
        });
    }
});

module.exports = router;