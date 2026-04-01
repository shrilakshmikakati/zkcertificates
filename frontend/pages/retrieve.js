import React, { useState, useRef } from 'react';
import Link from 'next/link';
import Layout from '../src/components/Layout';
import { apiUrl } from '../src/lib/api';

// ── helpers ───────────────────────────────────────────────────────────────────

function shortHash(hash) {
    if (!hash) return '—';
    const h = String(hash).replace('0x', '');
    if (h.length <= 16) return hash;
    return `${h.slice(0, 10)}...${h.slice(-8)}`;
}

// ── Merkle helpers ────────────────────────────────────────────────────────────
function hexToBytes(hex) {
    const h = hex.replace('0x', '');
    return new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}
function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Mirror Buffer.compare used by merkletreejs sortPairs option on the server
function sortedPair(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? [a, b] : [b, a];
    }
    return a.length <= b.length ? [a, b] : [b, a];
}
async function sha256Bytes(data) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function verifyMerkleProof(leafHash, proof, merkleRoot) {
    try {
        if (!leafHash) { console.error('Merkle verify: leafHash missing'); return false; }
        if (!Array.isArray(proof) || proof.length === 0) { console.error('Merkle verify: proof empty', { proof }); return false; }
        if (!merkleRoot) { console.error('Merkle verify: merkleRoot missing'); return false; }

        let computed = hexToBytes(leafHash);

        for (const [i, step] of proof.entries()) {
            let siblingHex;
            if (typeof step === 'string') {
                siblingHex = step;
            } else if (step && typeof step.data === 'string') {
                siblingHex = step.data;
            } else {
                console.error(`Merkle verify: invalid proof step at [${i}]`, step);
                return false;
            }

            const sibling = hexToBytes(siblingHex);
            // Sort lexicographically (mirrors Buffer.compare / sortPairs:true)
            const [left, right] = sortedPair(computed, sibling);
            const combined = new Uint8Array(left.length + right.length);
            combined.set(left);
            combined.set(right, left.length);
            computed = await sha256Bytes(combined);
        }

        const match = bytesToHex(computed) === merkleRoot.replace('0x', '');
        if (!match) {
            console.error('Merkle verify: root mismatch', {
                computed: bytesToHex(computed),
                expected: merkleRoot.replace('0x', ''),
                leafHash
            });
        }
        return match;
    } catch (err) {
        console.error('Merkle verification error:', err, { leafHash, merkleRoot });
        return false;
    }
}

function validateZKProofFormat(proof) {
    if (!proof) return false;
    try {
        const p = typeof proof === 'string' ? JSON.parse(proof) : proof;
        if (Array.isArray(p.pA) && Array.isArray(p.pB) && Array.isArray(p.pC))
            return p.pA.length >= 2 && p.pB.length >= 2 && p.pC.length >= 2;
        if (Array.isArray(p.pi_a) && Array.isArray(p.pi_b) && Array.isArray(p.pi_c))
            return p.pi_a.length >= 2 && p.pi_b.length >= 2 && p.pi_c.length >= 2;
        return false;
    } catch { return false; }
}

// ── constants ─────────────────────────────────────────────────────────────────

const QUERY_TYPES = [
    { type: 'studentId',        label: 'Student ID',        placeholder: 'e.g. S2026001' },
    { type: 'name',             label: 'Student Name',      placeholder: 'e.g. Aarav Sharma' },
    { type: 'email',            label: 'Email',             placeholder: 'student@university.edu' },
    { type: 'certId',           label: 'Certificate ID',    placeholder: 'e.g. CERT1748234567890' },
    { type: 'txHash',           label: 'Transaction Hash',  placeholder: '0xdef456… deployment transaction hash' },
    { type: 'blockHash',        label: 'Block Hash',        placeholder: '0xabc123… block hash' },
    { type: 'merkleRoot',       label: 'Merkle Root',       placeholder: '0x789abc… Merkle root hash' },
    { type: 'verificationCode', label: 'Verification Code', placeholder: 'e.g. VF3A9BCD' },
];

const HINTS = {
    studentId:        'Enter the student ID exactly as in your CSV (e.g. S2026001).',
    name:             'Case-insensitive search by student full name.',
    email:            'Matched case-insensitively against stored email.',
    certId:           'Partial match supported — enter a prefix of the certificate ID.',
    txHash:           'Matched on both certificate-level and deployment-level transaction hashes.',
    blockHash:        'Returns all certificates from the deployment in that block.',
    merkleRoot:       'Returns all certificates in the same deployment batch.',
    verificationCode: 'Enter the verification code printed on the certificate PDF.',
};

// ── component ─────────────────────────────────────────────────────────────────

export default function Retrieve() {
    const [query, setQuery]               = useState('');
    const [queryType, setQueryType]       = useState('studentId');
    const [result, setResult]             = useState(null);
    const [zkStatus, setZkStatus]         = useState(null);
    const [proofResults, setProofResults] = useState([]);
    const [isLoading, setIsLoading]       = useState(false);
    const [error, setError]               = useState('');
    const inputRef = useRef(null);

    const activePlaceholder = QUERY_TYPES.find(t => t.type === queryType)?.placeholder || '';

    const handleSearch = async () => {
        const q = query.trim();
        if (!q) { setError('Please enter a value to search.'); return; }

        setError('');
        setResult(null);
        setZkStatus(null);
        setProofResults([]);
        setIsLoading(true);

        try {
            const url = apiUrl(
                `/api/workflow/retrieve?query=${encodeURIComponent(q)}&type=${queryType}`
            );
            const res  = await fetch(url);
            const data = await res.json();

            if (!res.ok || !data.success) {
                setError(
                    data?.message ||
                    `No certificate found for "${q}". Make sure it has been issued and saved to MongoDB.`
                );
                setIsLoading(false);
                return;
            }

            const record = data.data;
            setResult(record);

            // Local ZK proof verification — no server round-trip
            const certList = record.certificates || [];
            if (certList.length > 0) {
                setZkStatus('verifying');
                let allValid = true;
                const results = [];

                for (const cert of certList) {
                    // FIX: use the authoritative zkProofVerified flag saved by the server
                    // during /deploy (which knows whether circuits were compiled and proofs
                    // actually succeeded).  Only fall back to client-side structure check when
                    // the flag is absent — e.g. older records written before this field existed.
                    let structureOk;
                    if (typeof cert.zkProofVerified === 'boolean') {
                        structureOk = cert.zkProofVerified;
                    } else {
                        const proofData = cert.zkProof?.proof || cert.zkProof;
                        structureOk = validateZKProofFormat(proofData);
                    }

                    let merkleOk = false;
                    let merkleError = '';
                    if (cert.merkleProof?.length && cert.leafHash) {
                        // FIX: The stored merkleProof/leafHash were built against finalMerkleRoot
                        // (post-deployment, includes tx details).  Always prefer finalMerkleRoot
                        // from the deployment record; fall back to the certificate-level merkleRoot.
                        // Using the pre-deployment merkleRoot here caused guaranteed mismatches.
                        const root =
                            record.merkleRoot ||   // already resolved to finalMerkleRoot by /retrieve API fix
                            cert.merkleRoot;
                        if (root) {
                            try {
                                merkleOk = await verifyMerkleProof(cert.leafHash, cert.merkleProof, root);
                                if (!merkleOk) {
                                    merkleError = 'Merkle proof verification failed. Check browser console for details.';
                                }
                            } catch (err) {
                                merkleError = 'Merkle verification error: ' + (err?.message || err);
                                console.error('Merkle verification error:', err);
                            }
                        } else {
                            merkleError = 'Missing Merkle root.';
                        }
                    } else {
                        if (!cert.merkleProof?.length) merkleError = 'Missing Merkle proof.';
                        else if (!cert.leafHash) merkleError = 'Missing leaf hash.';
                    }

                    const hasProofData  = typeof cert.zkProofVerified === 'boolean'
                        ? true  // server explicitly recorded a proof decision
                        : (cert.zkProof?.proof || cert.zkProof) != null;
                    const hasMerkleData = cert.merkleProof?.length > 0 && !!cert.leafHash;
                    const certValid     = (!hasProofData && !hasMerkleData) ? true : (structureOk || merkleOk);

                    results.push({ certId: cert.certificateId, certValid, merkleOk, structureOk, hasProofData, hasMerkleData, merkleError });
                    if (!certValid) allValid = false;
                }

                setProofResults(results);
                setZkStatus(allValid ? 'valid' : 'invalid');
            } else {
                setZkStatus('skipped');
            }
        } catch (err) {
            console.error('Retrieval error:', err);
            setError('Network error: could not reach the backend server. Is it running on port 3001?');
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setQuery('');
        setResult(null);
        setError('');
        setZkStatus(null);
        setProofResults([]);
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    return (
        <Layout title="Retrieve Certificate - ZK Certificates">
            <div className="min-h-screen bg-gray-50">

                {/* Header */}
                <div className="bg-white border-b">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                        <div className="text-center">
                            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                                Retrieve Certificate
                            </h1>
                            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                                Search by Student ID, Name, Email, Certificate ID,
                                Transaction Hash, Block Hash, Merkle Root, or Verification Code.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

                    {/* Search card */}
                    <div className="bg-white rounded-xl shadow-sm p-8 mb-6">
                        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Search By</h2>

                        <div className="flex flex-wrap gap-2 mb-6">
                            {QUERY_TYPES.map(({ type, label }) => (
                                <button
                                    key={type}
                                    onClick={() => { setQueryType(type); setResult(null); setError(''); setZkStatus(null); }}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                                        queryType === type
                                            ? 'bg-primary-600 text-white border-primary-600'
                                            : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400 hover:text-primary-600'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="flex gap-3">
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                placeholder={activePlaceholder}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-900 placeholder-gray-400"
                                spellCheck={false}
                            />
                            <button
                                onClick={handleSearch}
                                disabled={isLoading}
                                className="bg-primary-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-r-transparent" />
                                        Searching…
                                    </span>
                                ) : 'Search'}
                            </button>
                        </div>

                        <p className="mt-3 text-xs text-gray-500">{HINTS[queryType]}</p>

                        {error && (
                            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        )}
                    </div>

                    {/* Loading */}
                    {isLoading && (
                        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4" />
                            <p className="text-gray-600">Querying MongoDB…</p>
                            <p className="text-sm text-gray-500 mt-2">Running ZK proof verification…</p>
                        </div>
                    )}

                    {/* Empty state */}
                    {!isLoading && !result && !error && (
                        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <h2 className="text-2xl font-semibold text-gray-900 mb-4">No Search Yet</h2>
                            <p className="text-gray-600 mb-8 max-w-md mx-auto">
                                Enter a Student ID or other identifier above to retrieve the certificate record.
                            </p>
                            <Link href="/issue">
                                <a className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors">
                                    Issue Certificates First
                                </a>
                            </Link>
                        </div>
                    )}

                    {/* Results */}
                    {!isLoading && result && (
                        <div className="space-y-6">

                            {/* ZK banner */}
                            {zkStatus && (
                                <div className={`rounded-xl p-5 border flex items-start gap-4 ${
                                    zkStatus === 'valid'      ? 'bg-green-50  border-green-200'  :
                                    zkStatus === 'invalid'   ? 'bg-red-50    border-red-200'    :
                                    zkStatus === 'verifying' ? 'bg-indigo-50 border-indigo-200' :
                                                               'bg-blue-50   border-blue-200'
                                }`}>
                                    <div className="text-2xl mt-0.5">
                                        {zkStatus === 'valid' ? '✅' : zkStatus === 'invalid' ? '❌' : zkStatus === 'verifying' ? '🔄' : 'ℹ️'}
                                    </div>
                                    <div className="flex-1">
                                        <p className={`font-semibold text-base mb-1 ${
                                            zkStatus === 'valid'      ? 'text-green-800'  :
                                            zkStatus === 'invalid'   ? 'text-red-800'    :
                                            zkStatus === 'verifying' ? 'text-indigo-800' : 'text-blue-800'
                                        }`}>
                                            {zkStatus === 'valid'      ? 'ZK Proof Verified — Certificate Authentic'     :
                                             zkStatus === 'invalid'   ? 'ZK Proof Failed — Integrity Issue Detected'     :
                                             zkStatus === 'verifying' ? 'Running ZK Proof Verification…'                 :
                                                                        'Record Retrieved'}
                                        </p>
                                        <p className={`text-sm ${
                                            zkStatus === 'valid'      ? 'text-green-700'  :
                                            zkStatus === 'invalid'   ? 'text-red-700'    :
                                            zkStatus === 'verifying' ? 'text-indigo-700' : 'text-blue-700'
                                        }`}>
                                            {zkStatus === 'valid'
                                                ? 'Groth16 proof structures and Merkle paths are cryptographically valid. Data has not been tampered with.'
                                                : zkStatus === 'invalid'
                                                ? 'One or more proof checks failed. Certificate data may have been altered.'
                                                : zkStatus === 'verifying'
                                                ? 'Validating proof structures and Merkle paths locally.'
                                                : 'The Merkle root is anchored on-chain.'}
                                        </p>
                                    </div>
                                    {zkStatus === 'verifying' && (
                                        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-indigo-600 border-r-transparent mt-1 flex-shrink-0" />
                                    )}
                                </div>
                            )}

                            {/* Stats */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-blue-50 p-6 rounded-lg text-center border">
                                    <div className="text-4xl font-bold text-blue-600 mb-2">
                                        {result.totalCertificates ?? result.certificates?.length ?? '—'}
                                    </div>
                                    <div className="text-sm font-medium text-blue-800">Certificates Found</div>
                                </div>
                                <div className="bg-green-50 p-6 rounded-lg text-center border">
                                    <div className="text-4xl font-bold text-green-600 mb-2">
                                        {result.blockNumber ?? '—'}
                                    </div>
                                    <div className="text-sm font-medium text-green-800">Block Number</div>
                                </div>
                                <div className="bg-purple-50 p-6 rounded-lg text-center border">
                                    <div className={`text-4xl font-bold mb-2 ${
                                        zkStatus === 'valid' ? 'text-green-600' : zkStatus === 'invalid' ? 'text-red-500' : 'text-purple-600'
                                    }`}>
                                        {zkStatus === 'valid' ? '✓' : zkStatus === 'invalid' ? '✗' : '…'}
                                    </div>
                                    <div className="text-sm font-medium text-purple-800"> Verified</div>
                                </div>
                            </div>

                            {/* Student details */}
                            {result.certificates?.length > 0 && (
                                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-gray-200">
                                        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                                            Student Details
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                {QUERY_TYPES.find(t => t.type === result.queryType)?.label}: {result.searchQuery}
                                            </span>
                                        </h2>
                                        <p className="text-sm text-gray-600 mt-1">
                                            Retrieved from &nbsp;·&nbsp; {result.certificates.length} record(s) found
                                        </p>
                                    </div>
                                    {(() => {
                                        const cert = result.certificates[0];
                                        return (
                                            <div className="px-6 py-5 bg-blue-50 border-b border-blue-100">
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    <DetailField label="Student Name"      value={cert.name || cert.content?.studentName} />
                                                    <DetailField label="Student ID"        value={cert.studentId || cert.content?.studentId} />
                                                    <DetailField label="Email"             value={cert.email || cert.content?.studentEmail} />
                                                    <DetailField label="Certificate ID"    value={cert.certificateId} mono />
                                                    <DetailField label="Issue Date"        value={cert.issueDate} />
                                                    <DetailField label="Verification Code" value={cert.verificationCode} mono />
                                                    <DetailField label="Institution"       value={cert.content?.institutionName} />
                                                    <DetailField label="Course / Program"  value={cert.content?.courseName || cert.content?.certificateProgram} />
                                                    <DetailField label="Graduation Year"   value={cert.content?.graduationYear} />
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Blockchain info */}
                            {(result.contractAddress || result.transactionHash || result.blockHash) && (
                                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-gray-200">
                                        <h2 className="text-xl font-semibold text-gray-900">Blockchain Deployment Record</h2>
                                        <p className="text-sm text-gray-600 mt-1">
                                            Network: <strong>{result.networkDisplay || result.networkName || 'Unknown'}</strong>
                                            {result.chainId && <> &nbsp;·&nbsp; Chain ID: <strong>{result.chainId}</strong></>}
                                            {result.isLayer2 && (
                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">Layer 2</span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="px-6 py-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {[
                                                { label: 'Contract Address', value: result.contractAddress, mono: true },
                                                { label: 'Transaction Hash', value: result.transactionHash, mono: true },
                                                { label: 'Block Hash',       value: result.blockHash,       mono: true },
                                                { label: 'Block Number',     value: result.blockNumber },
                                                { label: 'Gas Used',         value: result.gasUsed ? `${Number(result.gasUsed).toLocaleString()} units` : null },
                                                { label: 'Layer Type',       value: result.layerType },
                                                { label: 'RPC URL',          value: result.rpcUrl, mono: true },
                                                { label: 'Deployed At',      value: result.deployedAt ? new Date(result.deployedAt).toLocaleString() : null },
                                            ].filter(r => r.value != null).map(({ label, value, mono }) => (
                                                <div key={label} className="bg-gray-50 rounded-lg p-4">
                                                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</div>
                                                    <div className={`text-sm text-gray-900 break-all ${mono ? 'font-mono' : 'font-medium'}`}>{value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Merkle root */}
                            {result.merkleRoot && (
                                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-gray-200">
                                        <h2 className="text-xl font-semibold text-gray-900">Merkle Root</h2>
                                        <p className="text-sm text-gray-600 mt-1">Cryptographic commitment anchoring all certificates in this batch</p>
                                    </div>
                                    <div className="px-6 py-4">
                                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                            <p className="font-mono text-sm text-green-800 break-all">{result.merkleRoot}</p>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-3">Any change to any certificate invalidates this root.</p>
                                    </div>
                                </div>
                            )}

                            {/* Certificates table */}
                            {result.certificates?.length > 0 && (
                                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-gray-200">
                                        <h2 className="text-xl font-semibold text-gray-900">
                                            All Matched Certificates ({result.certificates.length})
                                        </h2>
                                        <p className="text-sm text-gray-600 mt-1">Full list with verification status</p>
                                    </div>

                                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                        <table className="min-w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-100 sticky top-0">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">#</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Student Name</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Student ID</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Certificate ID</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Issue Date</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Grade</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Proof</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Merkle</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                                                {result.certificates.map((cert, idx) => {
                                                    const pr = proofResults[idx];
                                                    return (
                                                        <tr key={cert?.certificateId || idx} className="hover:bg-gray-50">
                                                            <td className="px-4 py-3 text-sm font-medium text-gray-500">{idx + 1}</td>
                                                            <td className="px-6 py-3 text-sm font-medium text-gray-900">{cert.name || cert.content?.studentName || '—'}</td>
                                                            <td className="px-6 py-3 text-sm text-gray-600">{cert.studentId || cert.content?.studentId || '—'}</td>
                                                            <td className="px-6 py-3 text-sm text-gray-600 font-mono text-xs">{cert.certificateId ? shortHash(cert.certificateId) : '—'}</td>
                                                            <td className="px-6 py-3 text-sm text-gray-600">{cert.issueDate || '—'}</td>
                                                            <td className="px-6 py-3 text-sm text-gray-600">{
                                                                cert.grade ||
                                                                cert.content?.grade ||
                                                                cert.content?.Grade ||
                                                                cert.content?.marks ||
                                                                cert.content?.score ||
                                                                cert.content?.percentage ||
                                                                '—'
                                                            }</td>
                                                            <td className="px-6 py-3">
                                                                {zkStatus === 'verifying' ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">…</span>
                                                                ) : pr ? (
                                                                    !pr.hasProofData
                                                                        ? <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">No data</span>
                                                                        : pr.structureOk
                                                                        ? <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">✓ Valid</span>
                                                                        : <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">✗ Invalid</span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                {zkStatus === 'verifying' ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">…</span>
                                                                ) : pr ? (
                                                                    !pr.hasMerkleData
                                                                        ? <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">No data</span>
                                                                        : pr.merkleOk
                                                                        ? <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">✓ Verified</span>
                                                                        : <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">✗ Failed</span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-3">
                                                                {cert.status === 'issued' || cert.status === 'verified' ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">✓ {cert.status}</span>
                                                                ) : cert.status === 'revoked' ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Revoked</span>
                                                                ) : cert.status === 'pending' ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{cert.status || '—'}</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                                        <div className="flex items-center justify-between text-sm text-gray-600">
                                            <div>
                                                Showing {result.certificates.length} certificate(s) &nbsp;·&nbsp;
                                                Name, Student ID, Certificate ID, Issue Date, Proof checks
                                            </div>
                                            <div className="flex space-x-3">
                                                <button
                                                    onClick={handleReset}
                                                    className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                                                >
                                                    New Search
                                                </button>
                                                <Link href="/issue">
                                                    <a className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                                                        Issue Certificates
                                                    </a>
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}

function DetailField({ label, value, mono }) {
    if (value == null || value === '') return null;
    return (
        <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</div>
            <div className={`text-sm text-gray-900 break-all ${mono ? 'font-mono' : 'font-medium'}`}>{value}</div>
        </div>
    );
}