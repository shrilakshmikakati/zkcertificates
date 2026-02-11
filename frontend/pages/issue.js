import React, { useState } from 'react';
import Link from 'next/link';
import Layout from '../src/components/Layout';

export default function IssueCertificates() {
  const [certificateData, setCertificateData] = useState(null);
  const [merkleRoot, setMerkleRoot] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResults, setDeploymentResults] = useState(null);
  const [deploymentStep, setDeploymentStep] = useState('');

  const handleDataInput = (event) => {
    const value = event.target.value.trim();
    if (value.length === 66 && value.startsWith('0x')) { // Valid Merkle root hash
      setMerkleRoot(value);
    }
  };

  const loadFromGeneratedCertificates = () => {
    // This would typically load from localStorage or API
    const savedData = localStorage.getItem('generatedCertificates');
    if (savedData) {
      const data = JSON.parse(savedData);
      setCertificateData(data);
      if (data.merkleRoot) {
        setMerkleRoot(data.merkleRoot);
      }
    } else {
      alert('No certificate data found. Please generate certificates first.');
    }
  };

  const deployToBlockchain = async () => {
    if (!merkleRoot || !certificateData) {
      alert('Please provide Merkle root and certificate data');
      return;
    }

    setIsDeploying(true);

    try {
      setDeploymentStep('Preparing deployment data...');

      // Deploy using workflow API
      const deployResponse = await fetch('http://localhost:3001/api/workflow/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merkleRoot: merkleRoot,
          certificates: certificateData.certificates || [],
          totalCertificates: certificateData.totalCount || certificateData.selectedCertificates?.length || 0
        }),
      });

      setDeploymentStep('Deploying to blockchain...');

      if (!deployResponse.ok) {
        const errorData = await deployResponse.json();
        throw new Error(errorData.message || 'Failed to deploy to blockchain');
      }

      const deployData = await deployResponse.json();
      setDeploymentStep('Deployment successful!');

      setDeploymentResults({
        merkleRoot: merkleRoot,
        transactionHash: deployData.transactionHash,
        gasUsed: deployData.gasUsed,
        blockNumber: deployData.blockNumber,
        totalCertificates: deployData.totalCertificates
      });

    } catch (error) {
      console.error('Error deploying to blockchain:', error);
      alert(`Deployment Error: ${error.message}`);
      setDeploymentStep('');
    } finally {
      setIsDeploying(false);
    }
  };

  const resetForm = () => {
    setCertificateData(null);
    setMerkleRoot('');
    setIsDeploying(false);
    setDeploymentStep('');
    setDeploymentResults(null);
  };

  return (
    <Layout title="Issue Certificates - ZK Certificate System">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 bg-primary-600 rounded-full flex items-center justify-center mb-6">
                <span className="text-white text-2xl font-bold">📋</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Deploy to Blockchain
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Deploy generated certificates to blockchain with Zero-Knowledge proofs.
                This creates immutable, verifiable records while preserving privacy.
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {!deploymentResults ? (
            <div className="space-y-8">
              {/* Instructions */}
              <div className="bg-white rounded-xl shadow-sm p-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-6">Blockchain Deployment Requirements</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">📋 Prerequisites</h3>
                    <ul className="text-gray-600 space-y-1">
                      <li>• Generated certificate data with Merkle tree</li>
                      <li>• Valid Merkle root hash (64 characters)</li>
                      <li>• Network connection to blockchain</li>
                      <li>• Sufficient gas tokens for deployment</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">🔒 Privacy Features</h3>
                    <ul className="text-gray-600 space-y-1">
                      <li>• Zero-Knowledge proof generation</li>
                      <li>• Only Merkle root stored on-chain</li>
                      <li>• Student data remains private</li>
                      <li>• Verifiable without revealing details</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Data Input Section */}
              <div className="bg-white rounded-xl shadow-sm p-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-6">Certificate Data Input</h2>

                <div className="space-y-6">
                  {/* Load from Generated Certificates */}
                  <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div>
                      <h3 className="font-medium text-blue-800">Load from Generated Certificates</h3>
                      <p className="text-sm text-blue-600">
                        Use certificate data from the Generate Certificates page
                      </p>
                    </div>
                    <button
                      onClick={loadFromGeneratedCertificates}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      Load Data
                    </button>
                  </div>

                  {/* Manual Merkle Root Input */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Merkle Root Hash (Optional - if not loading from generated data)
                      </label>
                      <input
                        type="text"
                        value={merkleRoot}
                        onChange={handleDataInput}
                        placeholder="0x..."
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Enter the 66-character hex Merkle root from certificate generation
                      </p>
                    </div>
                  </div>

                  {/* Certificate Data Display */}
                  {certificateData && (
                    <div className="space-y-4">
                      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                        <h3 className="font-medium text-green-800 mb-2">✓ Certificate Data Loaded</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-green-600">Total Certificates:</span>
                            <span className="ml-2 font-semibold">{certificateData.totalCount || 0}</span>
                          </div>
                          <div>
                            <span className="text-green-600">Processing Date:</span>
                            <span className="ml-2 font-semibold">{new Date(certificateData.processedAt || Date.now()).toLocaleDateString()}</span>
                          </div>
                          <div>
                            <span className="text-green-600">Merkle Root:</span>
                            <span className="ml-2 font-mono text-xs">{merkleRoot ? `${merkleRoot.substring(0, 8)}...${merkleRoot.substring(58)}` : 'Not set'}</span>
                          </div>
                          <div>
                            <span className="text-green-600">Status:</span>
                            <span className="ml-2 font-semibold text-green-800">Ready for Deployment</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Deploy Button */}
                  {isDeploying ? (
                    <div className="space-y-4">
                      <div className="text-center">
                        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
                        <h3 className="text-lg font-medium text-gray-900">Deploying to Blockchain</h3>
                        <p className="text-gray-600">{deploymentStep || 'Initializing deployment...'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <button
                        onClick={deployToBlockchain}
                        disabled={!merkleRoot || (!certificateData && !merkleRoot)}
                        className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        🚀 Deploy to Blockchain
                      </button>
                      <p className="text-sm text-gray-500 mt-2">
                        This will create ZK proofs and deploy certificate data to the blockchain
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Deployment Results */
            <div className="bg-white rounded-xl shadow-sm p-8">
              <div className="text-center mb-8">
                <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-green-600 text-3xl">✓</span>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">Successfully Deployed to Blockchain!</h2>
                <p className="text-gray-600">Your certificates are now immutably stored with ZK proof verification</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">📊 Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Certificates:</span>
                      <span className="font-semibold">{deploymentResults.totalCertificates}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Gas Used:</span>
                      <span className="font-semibold">{deploymentResults.gasUsed}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">⛓️ Blockchain Details</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-600 block">Merkle Root:</span>
                      <span className="font-mono text-xs break-all">{deploymentResults.merkleRoot}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 block">Transaction Hash:</span>
                      <span className="font-mono text-xs break-all">{deploymentResults.transactionHash}</span>
                    </div>
                    {deploymentResults.blockNumber && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Block Number:</span>
                        <span className="font-semibold">#{deploymentResults.blockNumber}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={resetForm}
                  className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Deploy More Certificates
                </button>
                <Link href="/verify">
                  <a className="border-2 border-primary-600 text-primary-600 font-semibold px-8 py-3 rounded-lg hover:bg-primary-50 transition-colors text-center">
                    Verify Certificates
                  </a>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* How It Works Section */}
        <div className="bg-white border-t py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Blockchain Deployment Process</h2>
              <p className="text-gray-600">Secure deployment workflow for certificate verification</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="mx-auto h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-blue-600 font-bold">1</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Load Data</h3>
                <p className="text-sm text-gray-600">Import certificate data and Merkle root from generation step</p>
              </div>

              <div className="text-center">
                <div className="mx-auto h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-purple-600 font-bold">2</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Create ZK Proofs</h3>
                <p className="text-sm text-gray-600">Generate Zero-Knowledge proofs for privacy preservation</p>
              </div>

              <div className="text-center">
                <div className="mx-auto h-12 w-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-green-600 font-bold">3</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Deploy Transaction</h3>
                <p className="text-sm text-gray-600">Submit Merkle root and proofs to blockchain</p>
              </div>

              <div className="text-center">
                <div className="mx-auto h-12 w-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-yellow-600 font-bold">4</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Verify & Complete</h3>
                <p className="text-sm text-gray-600">Confirm transaction and enable certificate verification</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}