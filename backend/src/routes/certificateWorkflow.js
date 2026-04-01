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

        console.log(`Processing session ${sessionId}`);

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

        console.log(`Raw data: ${rawData.length} rows`);

        // Process data with user mappings
        const processingResult = DynamicCertificateService.processStudentData(
            rawData,
            fieldMappings,
            processingOptions || {}
        );

        console.log(`Processed: ${processingResult.processedData?.length || 0} records, ${processingResult.errors?.length || 0} errors`);

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
                // Use snake_case key to match the fallback builder in the deploy
                // step — both paths must produce identical JSON for the same student
                // so that finalCommitment hashes are consistent.
                student_id: student.student_id || student.id,
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

            console.log(`Session updated: ${certificatesWithProofs.length} certificates, Merkle Root: ${merkleRoot}`);

        } catch (merkleError) {
            console.error('Merkle tree generation error:', merkleError);
            return res.status(500).json({
                success: false,
                error: 'Merkle Tree Generation Failed',
                message: merkleError.message
            });
        }

        // ── Generate ZK proofs server-side ───────────────────────────────────────
        // Proofs are generated here so they are never sent to the browser or stored
        // in localStorage. The session holds the authoritative proof data.
        // The /deploy endpoint reads proofs directly from the session.
        // ─────────────────────────────────────────────────────────────────────────
        console.log(`Generating ZK proofs server-side for ${certificatesWithProofs.length} certificates...`);
        let zkProofsForSession = null;

        // IMPORTANT: the studentId key here MUST match the resolution order in
        // the /deploy MongoDB-save block so zkProofMap lookups succeed.
        // Both use: cert.student_id → cert.studentId → String(cert.id)
        const zkInputs = certificatesWithProofs.map(cert => ({
            studentId: cert.student_id || cert.studentId || String(cert.id),
            subjects: [
                parseFloat(cert.math    || cert.subject1 || 0),
                parseFloat(cert.science || cert.subject2 || 0),
                parseFloat(cert.english || cert.subject3 || 0),
                parseFloat(cert.history || cert.subject4 || 0),
                parseFloat(cert.art     || cert.subject5 || 0)
            ],
            salt: crypto.randomBytes(16).toString('hex'),
            minPassingGrade: 40,
            requireAllPassed: false
        }));

        const circuitsReady = ZKProofService.hasCompiledCircuits();
        if (!circuitsReady) {
            console.warn('⚠ ZK circuit files not found — skipping proof generation.');
            console.warn('  Certificates will be saved to MongoDB with zkProofVerified:false.');
            console.warn('  To enable ZK proofs run:');
            console.warn('    npm run compile-circuits && npm run setup-ptau && npm run generate-keys');
            // Store placeholder proofs so /deploy knows not to block on them
            zkProofsForSession = zkInputs.map(inp => ({
                studentId: inp.studentId,
                status: 'skipped',
                error: 'ZK circuits not compiled'
            }));
            session.zkProofs = zkProofsForSession;
        } else {
            try {
                zkProofsForSession = await ZKProofService.generateBatchProofs(zkInputs);
                session.zkProofs = zkProofsForSession;

                const ok  = zkProofsForSession.filter(p => p.status === 'success').length;
                const bad = zkProofsForSession.filter(p => p.status === 'failed').length;
                console.log(`ZK proof generation complete: ${ok} succeeded, ${bad} failed`);

                if (bad > 0) {
                    console.warn(`⚠ ${bad} certificates failed ZK proof generation. Check circuit setup.`);
                }
            } catch (zkError) {
                // Unexpected error during proof generation — treat as non-fatal so
                // the deployment can still proceed with zkProofVerified:false.
                console.error('ZK proof generation threw unexpectedly:', zkError.message);
                zkProofsForSession = zkInputs.map(inp => ({
                    studentId: inp.studentId,
                    status: 'failed',
                    error: zkError.message
                }));
                session.zkProofs = zkProofsForSession;
            }
        }

        const zkSummary = zkProofsForSession
            ? {
                total:     zkProofsForSession.length,
                succeeded: zkProofsForSession.filter(p => p.status === 'success').length,
                failed:    zkProofsForSession.filter(p => p.status === 'failed').length,
                skipped:   zkProofsForSession.filter(p => p.status === 'skipped').length,
                circuitsReady: ZKProofService.hasCompiledCircuits()
              }
            : null;

        res.json({
            success: true,
            message: `Successfully processed ${certificatesWithProofs.length} certificates`,
            summary: processingResult.summary,
            certificates: certificatesWithProofs,
            merkleRoot: merkleRoot,
            merkleTreeStats: session.merkleTreeStats,
            zkProofSummary: zkSummary,
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
 *
 * NOTE — zkSync Explorer "Unable to decode input data":
 * This is NOT a code error. It means the contract source has not been verified
 * on the block explorer. The transaction succeeds regardless.
 * To fix the explorer display, run ONCE after deployment:
 *
 *   npx hardhat verify --network zksyncSepholia <CONTRACT_ADDRESS>
 *
 * If using @matterlabs/hardhat-zksync-verify, you may also need:
 *   npx hardhat verify --network zksyncSepholia <CONTRACT_ADDRESS> [constructorArgs...]
 *
 * This uploads ABI + source to the explorer so calldata is human-readable.
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
        
        const isLocal = ['ganache', 'localhost', 'hardhat'].includes(selectedNetwork.toLowerCase());
        const privateKey = isLocal
            ? process.env.GANACHE_DEPLOYER_PRIVATE_KEY
            : process.env.DEPLOYER_PRIVATE_KEY;

        if (!privateKey) {
            return res.status(500).json({
                success: false,
                error: 'Deployer private key not configured',
                message: `Set ${isLocal ? 'GANACHE_DEPLOYER_PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY'} in your .env file`
            });
        }

        const signer = new ethers.Wallet(privateKey, provider);
        console.log(`Deploying to ${selectedNetwork} via signer ${signer.address}`);

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
        let finalMerkleRoot = merkleRoot; // will be overwritten after finalMerkleTree is built
        
        // Try to get certificates from multiple sources
        console.log(`Deploy: sessionId=${sessionId || 'none'}, certs in body=${certificates ? certificates.length : 0}`);

        // Priority 1: Certificates from request body
        if (certificates && certificates.length > 0) {
            certificatesForProcessing = certificates;
            console.log(`Using ${certificates.length} certificates from request body`);
        }
        // Priority 2: Certificates from explicit sessionId
        else if (sessionId && global.certificateWorkflowSessions?.[sessionId]?.processedData) {
            certificatesForProcessing = global.certificateWorkflowSessions[sessionId].processedData;
            console.log(`Using ${certificatesForProcessing.length} certificates from session ${sessionId}`);
        }
        // Priority 3: Most recent session with processed data
        else if (global.certificateWorkflowSessions) {
            const sessionsWithData = Object.entries(global.certificateWorkflowSessions)
                .filter(([, s]) => s.processedData && s.processedData.length > 0)
                .sort(([, a], [, b]) => new Date(b.createdAt) - new Date(a.createdAt));
            if (sessionsWithData.length > 0) {
                const [, recentSession] = sessionsWithData[0];
                certificatesForProcessing = recentSession.processedData;
                console.log(`Using ${certificatesForProcessing.length} certificates from most recent session`);
            }
        }
        
        // Priority 4: Auto-extract from raw file data using suggested mappings
        if (!certificatesForProcessing || certificatesForProcessing.length === 0) {
            const recentRawSession = Object.entries(global.certificateWorkflowSessions || {})
                .sort(([, a], [, b]) => new Date(b.createdAt) - new Date(a.createdAt))[0];

            if (recentRawSession) {
                const [, rawSessionData] = recentRawSession;
                const rawData = rawSessionData.analysis?.allData;
                const suggestedMappings = rawSessionData.analysis?.suggestedMappings || {};

                if (rawData && rawData.length > 0) {
                    try {
                        const autoResult = DynamicCertificateService.processStudentData(rawData, suggestedMappings, {});
                        if (autoResult.processedData && autoResult.processedData.length > 0) {
                            certificatesForProcessing = autoResult.processedData;
                            console.log(`Auto-extracted ${certificatesForProcessing.length} certificates from raw file data`);
                        }
                    } catch (autoProcessError) {
                        console.error('Auto-extraction failed:', autoProcessError.message);
                    }
                }
            }
        }
        
        // Hard failure — no placeholder data in production.
        if (!certificatesForProcessing || certificatesForProcessing.length === 0) {
            return res.status(422).json({
                success: false,
                error: 'No certificate data found for deployment',
                message:
                    'The deploy request reached the server without usable certificate records. ' +
                    'Possible causes: (1) Frontend did not include the certificates array in the request body, ' +
                    '(2) The server session expired (sessions last 4 hours — re-upload the file), ' +
                    '(3) Auto-extraction from the raw file failed (check field mappings on /verify). ' +
                    'Please re-upload your CSV/Excel file and complete the verification step before deploying.'
            });
        }
        
        if (certificatesForProcessing && certificatesForProcessing.length > 0) {
            console.log(`Building final certificates for ${certificatesForProcessing.length} records...`);
            
            finalCertificates = certificatesForProcessing.map((cert, idx) => {
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
                    ...preCommitmentData,
                    
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
                    grade: preCommitmentData.grade, // Ensure grade is top-level
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
            const finalMerkleTree = MerkleService.buildMerkleTree(finalCertificates, 'finalCommitment');
            finalMerkleRoot = '0x' + finalMerkleTree.getRoot().toString('hex');

            const finalCertificatesWithProofs = finalCertificates.map(cert => {
                const finalProof = MerkleService.generateMerkleProof(finalMerkleTree, cert.finalCommitment);
                return { ...cert, finalMerkleProof: finalProof };
            });

            console.log(` Final Merkle root (with tx details): ${finalMerkleRoot}`);
            console.log(`   Proofs generated for ${finalCertificatesWithProofs.length} certificates`);
            console.log(`   Sample cert has finalMerkleProof: ${!!finalCertificatesWithProofs[0]?.finalMerkleProof}`);

            if (sessionId && global.certificateWorkflowSessions?.[sessionId]) {
                global.certificateWorkflowSessions[sessionId].finalCertificates = finalCertificatesWithProofs;
                global.certificateWorkflowSessions[sessionId].finalMerkleRoot = finalMerkleRoot;
            } else {
                console.warn(`Session ${sessionId} not found in memory — skipping session update (safe to ignore if certs come from request body)`);
            }

            finalCertificates = finalCertificatesWithProofs;
        }

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

        console.log(`Persisting ${finalCertificates?.length || 0} certificates to MongoDB...`);

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
                // finalMerkleRoot is built after tx details are included —
                // it is the root that the stored proofs verify against.
                // finalMerkleRoot is computed after the blockchain tx, includes tx details.
                finalMerkleRoot: finalMerkleRoot,
                totalCertificates,
                metadata: metadata || {},
                deployedAt: new Date(block.timestamp * 1000)
            });

            // Save individual certificates to MongoDB
            if (finalCertificates && finalCertificates.length > 0) {
                console.log(`\n Saving ${finalCertificates.length} certificates to MongoDB...`);
                
                // Build zkProofMap — prefer session-stored proofs (generated server-side
                // during /process). Fall back to request-body proofs only for backwards
                // compatibility, but those will only contain compact summary data which
                // will fail the proof-data check below.
                const sessionZKProofs =
                    (sessionId && global.certificateWorkflowSessions?.[sessionId]?.zkProofs) ||
                    null;

                const proofSource = sessionZKProofs || (Array.isArray(zkProofs) ? zkProofs : []);
                const zkProofMap = {};
                proofSource.forEach(proof => {
                    // Index by studentId regardless of status so the save block
                    // can distinguish success / failed / skipped per-certificate.
                    if (proof.studentId) zkProofMap[proof.studentId] = proof;
                });
                const zkMapSuccessCount = Object.values(zkProofMap).filter(p => p.status === 'success').length;
                console.log(`ZK Proof Map: ${Object.keys(zkProofMap).length} entries, ${zkMapSuccessCount} successful (source: ${sessionZKProofs ? 'session' : 'request body'})`);

                
                // ── FIX: check whether ZK circuits are compiled ──────────────────
                // When circuits are missing, generateBatchProofs returns status:'failed'
                // for every cert. Rather than silently dropping all certificates from
                // MongoDB, we detect this case and save them with zkProofVerified:false
                // so the deployment is still persisted and certificates are retrievable.
                const circuitsReady = ZKProofService.hasCompiledCircuits();
                if (!circuitsReady) {
                    console.warn('⚠ ZK circuits not compiled — certificates will be saved without verified ZK proofs.');
                    console.warn('  Run: npm run compile-circuits && npm run setup-ptau && npm run generate-keys');
                }

                const certificatesToSave = finalCertificates.map((cert, idx) => {

                    // ── Resolve studentId from all possible field names ───────────
                    // IMPORTANT: the resolution order here MUST match the order used
                    // when building zkInputs in /process (student_id → studentId → id),
                    // otherwise zkProofMap lookups will always miss.
                    let realStudentId =
                        cert.student_id ||          // primary key set by DynamicCertificateService
                        cert.studentId ||
                        cert.preCommitmentData?.student_id ||
                        cert.preCommitmentData?.studentId ||
                        cert.finalCommitmentData?.student_id ||
                        cert.finalCommitmentData?.studentId ||
                        cert['Student ID'] ||
                        cert['STUDENT ID'] ||
                        cert['student id'] ||
                        cert['Roll No'] ||
                        cert['Roll_No'] ||
                        cert['ID'];

                    // Last-chance: check nested raw data
                    if (!realStudentId && cert.raw) {
                        realStudentId =
                            cert.raw['Student ID'] ||
                            cert.raw['student_id'] ||
                            cert.raw['studentId'] ||
                            cert.raw['ID'] ||
                            cert.raw['Roll No'] ||
                            cert.raw['Roll_No'];
                    }

                    if (!realStudentId) {
                        console.error(`❌ Certificate ${idx + 1}: studentId missing — skipping. Cert keys: ${Object.keys(cert).join(', ')}`);
                        return null;
                    }

                    // ── Resolve ZK proof ─────────────────────────────────────────
                    let zkProofData = { verified: false, pA: [], pB: [], pC: [], publicSignals: [] };
                    let isZKVerified = false;

                    const matchedZKProof = zkProofMap[realStudentId];

                    if (matchedZKProof && matchedZKProof.status === 'success' && matchedZKProof.zkProof) {
                        const proofData = matchedZKProof.zkProof;
                        if (proofData.proof) {
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
                        console.log(`  ✅ Certificate ${idx + 1} (${realStudentId}): ZK proof matched`);
                    } else if (!circuitsReady) {
                        // Circuits not compiled — save without proof, mark as pending
                        console.warn(`  ⚠ Certificate ${idx + 1} (${realStudentId}): no ZK proof (circuits not compiled) — saving with zkProofVerified:false`);
                        // zkProofData already has safe defaults; isZKVerified stays false
                    } else if (!matchedZKProof) {
                        // Circuits are compiled but no proof entry at all — likely an
                        // ID key mismatch between /process and /deploy. Log and skip.
                        console.error(`❌ Certificate ${idx + 1}: no zkProof entry for studentId="${realStudentId}" in zkProofMap. Available keys: ${Object.keys(zkProofMap).slice(0, 5).join(', ')}`);
                        return null;
                    } else {
                        // Proof entry exists but failed during generation
                        console.error(`❌ Certificate ${idx + 1} (${realStudentId}): ZK proof generation failed — ${matchedZKProof.error || 'unknown error'}. Skipping.`);
                        return null;
                    }

                    return {
                        certificateId: cert.certificateId || `CERT${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
                        name: cert.name || cert.studentName || `Student ${idx + 1}`,
                        email: cert.email || cert.studentEmail || '',
                        studentId: realStudentId,
                        // Top-level academic fields for fast querying
                        grade:      cert.grade      || cert.preCommitmentData?.grade      || '',
                        course:     cert.course     || cert.preCommitmentData?.course     || metadata?.courseName || '',
                        percentage: cert.percentage || cert.preCommitmentData?.percentage || '',
                        issueDate: cert.issueDate || new Date().toLocaleDateString(),
                        verificationCode: cert.verificationCode || `VF${Math.random().toString(36).substr(2, 8).toUpperCase()}`,

                        // Blockchain & Deployment
                        deploymentId: deployment._id,
                        transactionHash: tx.hash,
                        blockNumber: receipt.blockNumber,
                        contractAddress: contractAddresses.contracts.ZKCertificateSystem.address,

                        // Merkle Tree — always use finalMerkleRoot/finalMerkleProof
                        // (built post-tx so they include transaction details in each leaf)
                        merkleRoot: finalMerkleRoot,
                        merkleProof: cert.finalMerkleProof || [],
                        leafHash: cert.finalCommitment || cert.leafHash,

                        // Content
                        content: {
                            institutionName: metadata?.institutionName || 'Educational Institution',
                            courseName: metadata?.courseName || 'Certificate Program',
                            completionDate: cert.issueDate || new Date().toLocaleDateString(),
                            certificateProgram: metadata?.courseName,
                            studentName: cert.name || cert.studentName,
                            studentEmail: cert.email || cert.studentEmail,
                            studentId: realStudentId,
                            graduationYear: metadata?.graduationYear || new Date().getFullYear()
                        },

                        zkProof: zkProofData,
                        zkProofVerified: isZKVerified,
                        verified: isZKVerified,

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
                    };
                });

                // ── FIX: filter out nulls BEFORE calling insertMany ───────────────
                // The .map() above returns null for certs that should be skipped.
                // Passing nulls to insertMany causes Mongoose to crash with
                // "Cannot read properties of null (reading 'name')".
                const validCertsToSave = certificatesToSave.filter(c => c !== null);
                const skippedCount = certificatesToSave.length - validCertsToSave.length;

                if (skippedCount > 0) {
                    console.warn(`⚠ Skipped ${skippedCount} of ${certificatesToSave.length} certificates (missing studentId or failed ZK proof)`);
                }

                console.log(`\nCertificate structure sample (first valid):`);
                if (validCertsToSave.length > 0) {
                    const sampleCert = validCertsToSave[0];
                    console.log(`   name: ${sampleCert.name}`);
                    console.log(`   email: ${sampleCert.email}`);
                    console.log(`   studentId: ${sampleCert.studentId}`);
                    console.log(`   zkProofVerified: ${sampleCert.zkProofVerified}`);
                    console.log(`   merkleProof type: ${Array.isArray(sampleCert.merkleProof) ? 'array' : typeof sampleCert.merkleProof}`);
                    console.log(`   merkleProof length: ${sampleCert.merkleProof?.length || 0}`);
                    if (sampleCert.merkleProof?.length > 0) {
                        console.log(`   merkleProof[0]:`, JSON.stringify(sampleCert.merkleProof[0]));
                    }
                }

                if (validCertsToSave.length === 0) {
                    console.error('❌ No valid certificates to save to MongoDB.');
                    if (!circuitsReady) {
                        console.error('   Root cause: ZK circuits not compiled AND all studentIds missing.');
                        console.error('   Fix: run npm run compile-circuits && npm run setup-ptau && npm run generate-keys');
                    } else {
                        console.error('   Root cause: studentId field mismatch between /process and /deploy.');
                        console.error('   Check that DynamicCertificateService outputs student_id consistently.');
                    }
                } else {
                    try {
                        const savedCerts = await Certificate.insertMany(validCertsToSave);
                        console.log(`\n✅ MONGODB SUCCESS!`);
                        console.log(`   Saved ${savedCerts.length} certificates (${skippedCount} skipped)`);
                        savedCerts.slice(0, 3).forEach((cert, i) => {
                            console.log(`  [${i + 1}] ${cert.name} (${cert.email}) — zkVerified: ${cert.zkProofVerified}`);
                        });
                    } catch (dbError) {
                        console.error(`\n❌ MONGODB insertMany ERROR:`);
                        console.error(`   Message: ${dbError.message}`);
                        console.error(`   Name: ${dbError.name}`);
                        console.error(`   Code: ${dbError.code}`);
                        if (dbError.errors) {
                            console.error(`   Validation Errors:`);
                            Object.entries(dbError.errors).forEach(([field, err]) => {
                                console.error(`     - ${field}: ${err.message}`);
                            });
                        }
                        if (validCertsToSave.length > 0) {
                            console.error(`\n   Sample problematic certificate (merkleProof):`);
                            console.error(`   `, JSON.stringify(validCertsToSave[0].merkleProof));
                        }
                    }
                }
            } else {
                console.error('No finalCertificates to save to MongoDB');
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

        // Build compact certificate list — no ZK proof arrays, no raw data blobs.
        // issue.js uses this to hydrate its state when the lightweight localStorage
        // reference was stored and the page was refreshed or navigated back to.
        const compactCerts = (session.processedData || []).map(c => ({
            name:          c.name,
            email:         c.email,
            student_id:    c.student_id || c.studentId || String(c.id),
            certificateId: c.certificateId,
            commitment:    c.preCommitment || null,
            merkleProof:   c.merkleProof  || []
        }));

        const zkSummary = session.zkProofs
            ? {
                total:     session.zkProofs.length,
                succeeded: session.zkProofs.filter(p => p.status === 'success').length,
                failed:    session.zkProofs.filter(p => p.status === 'failed').length
              }
            : null;

        res.json({
            success: true,
            // Flat data shape matches what issue.js expects from the re-fetch path:
            //   const fullData = { ...data, ...sessionData.data, isRefetching: false }
            data: {
                sessionId:       sessionId,
                fileName:        session.originalName,
                step:            session.step,
                totalCount:      compactCerts.length,
                certificates:    compactCerts,
                merkleRoot:      session.merkleRoot,
                merkleTreeStats: session.merkleTreeStats,
                zkProofSummary:  zkSummary,
                enabledPrivacy:  true,
                processedAt:     session.createdAt,
                expiresAt:       session.expiresAt
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
                grade: cert.grade || cert.preCommitmentData?.grade || cert.finalCommitmentData?.grade || '',
                studentId: cert.studentId || cert.student_id || cert.preCommitmentData?.student_id || cert.finalCommitmentData?.student_id || '',
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
            response.message = "Certificates with complete blockchain transaction linkage";
            
        } else if (session.processedData) {
            response.certificates = session.processedData;
            response.message = "Certificates ready for deployment";
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
        const sessions = global.certificateWorkflowSessions || {};
        const activeSessions = Object.entries(sessions)
            .filter(([, s]) => new Date() < s.expiresAt)
            .sort(([, a], [, b]) => new Date(b.createdAt) - new Date(a.createdAt));

        if (activeSessions.length === 0) {
            return res.json({
                success: true,
                data: { isEmpty: true, totalStudents: 0, dataColumns: 0, autoMappedFields: 0, lastUpload: null }
            });
        }

        const [, latestSession] = activeSessions[0];
        const analysis = latestSession.analysis || {};
        const suggestedMappings = analysis.suggestedMappings || {};
        const autoMappedFields = Object.values(suggestedMappings).filter(v => v && v !== '').length;

        return res.json({
            success: true,
            data: {
                isEmpty: false,
                totalStudents: analysis.totalRows || 0,
                dataColumns: (analysis.columns || []).length,
                autoMappedFields,
                recentSessions: activeSessions.length,
                lastUpload: latestSession.createdAt,
                fileName: latestSession.originalName || 'Unknown',
                columns: analysis.columns || [],
                sampleData: analysis.sampleData || [],
                allData: analysis.allData || [],
                merkleRoot: latestSession.merkleRoot || null,
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

router.get('/retrieve', async (req, res) => {
    const { query, type = 'studentId' } = req.query;
    const q = (query || '').trim();

    if (!q) {
        return res.status(400).json({ success: false, message: 'query parameter is required' });
    }

    try {
        let certificates = [];
        const regex = { $regex: q, $options: 'i' };

        switch (type) {
            case 'studentId':
                certificates = await Certificate.find({
                    $or: [
                        { studentId: regex },
                        { 'content.studentId': regex },
                    ]
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'name':
                certificates = await Certificate.find({
                    $or: [
                        { name: regex },
                        { 'content.studentName': regex },
                    ]
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'email':
                certificates = await Certificate.find({
                    $or: [
                        { email: regex },
                        { 'content.studentEmail': regex },
                    ]
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'certId':
                certificates = await Certificate.find({
                    certificateId: regex
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            case 'txHash':
                certificates = await Certificate.find({
                    transactionHash: regex
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                if (!certificates.length) {
                    const deps = await DeploymentRecord.find({ transactionHash: regex }).lean();
                    if (deps.length) {
                        certificates = await Certificate.find({
                            deploymentId: { $in: deps.map(d => d._id) }
                        }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                    }
                }
                break;

            case 'blockHash': {
                const deps = await DeploymentRecord.find({ blockHash: regex }).lean();
                if (deps.length) {
                    certificates = await Certificate.find({
                        deploymentId: { $in: deps.map(d => d._id) }
                    }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                }
                break;
            }

            case 'merkleRoot':
                certificates = await Certificate.find({
                    merkleRoot: regex
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                if (!certificates.length) {
                    const deps = await DeploymentRecord.find({ merkleRoot: regex }).lean();
                    if (deps.length) {
                        certificates = await Certificate.find({
                            deploymentId: { $in: deps.map(d => d._id) }
                        }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                    }
                }
                break;

            case 'verificationCode':
                certificates = await Certificate.find({
                    verificationCode: regex
                }).populate('deploymentId').sort({ createdAt: -1 }).lean();
                break;

            default:
                return res.status(400).json({ success: false, message: `Unknown type: ${type}` });
        }

        if (!certificates.length) {
            return res.status(404).json({
                success: false,
                message: `No certificates found for "${q}"`,
            });
        }

        const dep = certificates[0]?.deploymentId || {};
        const deploymentInfo = {
            networkDisplay:    dep.networkDisplay,
            networkName:       dep.networkName,
            chainId:           dep.chainId,
            layerType:         dep.layerType,
            isLayer2:          dep.isLayer2,
            rpcUrl:            dep.rpcUrl,
            contractAddress:   dep.contractAddress   || certificates[0]?.contractAddress,
            transactionHash:   dep.transactionHash   || certificates[0]?.transactionHash,
            blockNumber:       dep.blockNumber       || certificates[0]?.blockNumber,
            blockHash:         dep.blockHash,
            gasUsed:           dep.gasUsed,
            // FIX: always expose finalMerkleRoot as the canonical merkleRoot.
            // Stored merkleProof/leafHash on each certificate were generated against
            // finalMerkleRoot (post-tx). Using the pre-deployment merkleRoot here
            // caused the frontend Merkle verification to always report "Failed".
            merkleRoot:        dep.finalMerkleRoot   || dep.merkleRoot || certificates[0]?.merkleRoot,
            totalCertificates: dep.totalCertificates,
            deployedAt:        dep.deployedAt,
            metadata:          dep.metadata,
        };

        const shapedCerts = certificates.map(c => ({
            certificateId:    c.certificateId,
            name:             c.name,
            email:            c.email,
            studentId:        c.studentId || c.content?.studentId,
            issueDate:        c.issueDate,
            verificationCode: c.verificationCode,
            status:           c.status,
            transactionHash:  c.transactionHash,
            blockNumber:      c.blockNumber,
            contractAddress:  c.contractAddress,
            merkleRoot:       c.merkleRoot,
            merkleProof:      c.merkleProof,
            leafHash:         c.leafHash,
            zkProof:          c.zkProof,
            zkProofVerified:  c.zkProofVerified,
            content:          c.content,
            deployedAt:       c.deployedAt,
            createdAt:        c.createdAt,
        }));

        return res.status(200).json({
            success: true,
            data: {
                ...deploymentInfo,
                certificates:      shapedCerts,
                totalCertificates: certificates.length,
                queryType:         type,
                searchQuery:       q,
            },
        });

    } catch (err) {
        console.error('Workflow retrieve error:', err);
        return res.status(500).json({
            success: false,
            message: `Server error: ${err.message}`,
        });
    }
});


module.exports = router;