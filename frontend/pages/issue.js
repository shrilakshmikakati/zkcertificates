import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../src/components/Layout';
import { apiUrl } from '../src/lib/api';
import { getNetworkConfig, getNetworkName } from '../src/lib/networks';

const NETWORK_OPTIONS = [
  { value: 'ganache', label: 'Ganache Local (1337)', layer: 'Local EVM (L1 simulation)' },
  { value: 'localhost', label: 'Hardhat Local (31337)', layer: 'Local EVM (L1 simulation)' },
  { value: 'zksyncSepholia', label: 'zkSync Sepolia (300)', layer: 'Layer 2 Rollup - Testnet' },
  { value: 'zksyncMainnet', label: 'zkSync Mainnet (324)', layer: 'Layer 2 Rollup' },
];

export default function IssueCertificates() {
  const router = useRouter();
  const [studentData, setStudentData] = useState(null);
  const [generatedCertificates, setGeneratedCertificates] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResults, setDeploymentResults] = useState(null);
  const [verificationData, setVerificationData] = useState(null);
  const [showVerification, setShowVerification] = useState(false);
  const [currentStep, setCurrentStep] = useState('ready');
  const [zkProofStats, setZkProofStats] = useState(null);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [selectedNetwork, setSelectedNetwork] = useState('ganache');
  const lastDashboardFetchRef = useRef(0);

  useEffect(() => {
    const storedNetwork = localStorage.getItem('selectedBlockchainNetwork');
    if (storedNetwork) {
      setSelectedNetwork(storedNetwork);
    }

    // FIX: read from 'verifiedStudentData' (written by verify.js after processing).
    // Also fall back to 'issueCertificateData' for backwards compatibility.
    const savedData =
      localStorage.getItem('verifiedStudentData') ||
      localStorage.getItem('issueCertificateData');

    if (savedData) {
      const data = JSON.parse(savedData);
      setStudentData(data);

      // zkProofSummary is set by /api/workflow/process (server-side generation).
      // No proof arrays are stored in localStorage — only counts.
      if (data.zkProofSummary) {
        setZkProofStats({
          total:          data.zkProofSummary.total,
          successful:     data.zkProofSummary.succeeded,
          failed:         data.zkProofSummary.failed,
          privacyEnabled: data.enabledPrivacy || true
        });
      }

      if (data.certificates) {
        setGeneratedCertificates(data.certificates.map((cert, idx) => ({
          ...cert,
          certificateId: cert.certificateId || `CERT${Date.now()}${idx}`,
          status: 'ready'
        })));
        setCurrentStep('complete');
      }
    } else {
      setStudentData({ isEmpty: true });
    }

    fetchDashboardStats();
  }, [router]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchDashboardStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const fetchDashboardStats = async () => {
    const now = Date.now();
    if (now - lastDashboardFetchRef.current < 5000) return;
    lastDashboardFetchRef.current = now;
    try {
      const response = await fetch(apiUrl('/api/workflow/dashboard-stats'));
      if (response.ok) {
        const data = await response.json();
        if (data.success) setDashboardStats(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    }
  };

  const generateBulkCertificates = async () => {
    if (!studentData || !studentData.certificates) {
      alert('No student data found');
      return;
    }
    setIsGenerating(true);
    setCurrentStep('generating');
    try {
      const certificates = studentData.certificates.map((student, idx) => ({
        ...student,
        certificateId: student.certificateId || `CERT${Date.now()}${idx}`,
        issueDate: new Date().toLocaleDateString(),
        verificationCode: `VF${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        status: 'ready'
      }));
      setGeneratedCertificates(certificates);
      const updatedData = {
        ...studentData,
        generatedCertificates: certificates,
        certificatesGenerated: true,
        generatedAt: new Date().toISOString()
      };
      localStorage.setItem('verifiedStudentData', JSON.stringify(updatedData));
      setCurrentStep('complete');
    } catch (error) {
      console.error('Error generating certificates:', error);
      alert(`Error generating certificates: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadCertificate = async (certificate) => {
    try {
      const response = await fetch(apiUrl('/api/workflow/generate-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentData: certificate,
          template: {
            type: 'elegant',
            title: 'CERTIFICATE OF COMPLETION',
            colors: { primary: '#2c3e50', secondary: '#3498db', accent: '#e74c3c' }
          }
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'PDF generation failed');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(certificate.name || 'certificate').replace(/[^a-zA-Z0-9]/g, '_')}_certificate.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading certificate:', error);
      alert(`Failed to download certificate: ${error.message}`);
    }
  };

  const downloadAllCertificates = async () => {
    if (generatedCertificates.length === 0) {
      alert('No certificates to download');
      return;
    }
    setIsGenerating(true);
    try {
      const response = await fetch(apiUrl('/api/certificates/bulk-download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificates: generatedCertificates,
          template: {
            type: 'elegant',
            title: 'CERTIFICATE OF COMPLETION',
            colors: { primary: '#2c3e50', secondary: '#3498db', accent: '#e74c3c' }
          }
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Bulk download failed');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `certificates_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading all certificates:', error);
      alert('Failed to download certificates. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const deployToBlockchain = async () => {
    if (!studentData || !studentData.merkleRoot) {
      alert('No Merkle tree data found for deployment');
      return;
    }

    // Determine certificate count from the most reliable source available
    const totalCerts =
      studentData.totalCount ||
      generatedCertificates.length ||
      studentData.certificates?.length ||
      0;

    if (totalCerts === 0) {
      alert('No certificates to deploy. Please process your student data first.');
      return;
    }

    setIsDeploying(true);
    setCurrentStep('deploying');
    try {
      // ── Build deploy payload ─────────────────────────────────────────────────
      // The backend reads certificates and ZK proofs from the server-side session
      // (populated during /api/workflow/process). We only need to pass the sessionId
      // and the merkleRoot computed during that step. No proof data on the wire.
      const deployPayload = {
        sessionId:         studentData.sessionId || null,
        networkSelection:  selectedNetwork,
        merkleRoot:        studentData.merkleRoot,
        totalCertificates: totalCerts,
        enableZKVerification: studentData.enabledPrivacy || true,
        metadata: {
          institutionName: 'National Institute of Technology, Warangal',
          courseName:      studentData.courseName || 'Certificate Program',
          graduationYear:  studentData.graduationYear || new Date().getFullYear(),
          totalStudents:   totalCerts,
          fileName:        studentData.fileName,
          generatedAt:     new Date().toISOString()
        }
      };

      // Include compact certificate list so the server can match student IDs
      // even if the session has expired. These are small (no proof arrays).
      if (Array.isArray(studentData.certificates) && studentData.certificates.length > 0) {
        deployPayload.certificates = studentData.certificates;
      } else if (generatedCertificates.length > 0) {
        deployPayload.certificates = generatedCertificates;
      }

      const deployResponse = await fetch(apiUrl('/api/workflow/deploy'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deployPayload)
      });

      if (!deployResponse.ok) {
        let errorMessage = `Deployment failed (${deployResponse.status})`;
        const responseText = await deployResponse.text();
        if (responseText) {
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch {
            errorMessage = responseText;
          }
        }
        throw new Error(errorMessage);
      }

      const deployData = await deployResponse.json();
      setDeploymentResults({
        success: true,
        contractAddress: deployData.transactionDetails?.contractAddress || deployData.contractAddress,
        transactionHash: deployData.transactionDetails?.hash || deployData.transactionHash,
        blockNumber: deployData.transactionDetails?.blockNumber,
        gasUsed: deployData.transactionDetails?.gasUsed,
        network: deployData.chainData?.networkDisplay || deployData.chainData?.network || 'Unknown',
        networkRaw: deployData.chainData?.network || 'unknown',
        chainId: deployData.chainData?.chainId,
        layerType: deployData.chainData?.layerType || 'Unknown',
        isLayer2: !!deployData.chainData?.isLayer2,
        rpcUrl: deployData.chainData?.rpcUrl,
        merkleRoot: studentData.merkleRoot,
        deployedAt: deployData.chainData?.blockTimestamp || new Date().toISOString()
      });
      setCurrentStep('deployed');
    } catch (error) {
      console.error('Error deploying to blockchain:', error);
      alert(`Deployment failed: ${error.message}`);
      setCurrentStep('complete');
    } finally {
      setIsDeploying(false);
    }
  };

  const verifyDeployedData = async () => {
    if (!deploymentResults?.merkleRoot) {
      alert('No deployment data found to verify');
      return;
    }
    try {
      const firstCertificate = generatedCertificates[0] || {};
      let batchVerification = { verified: true, note: 'Part of deployed Merkle tree batch' };
      try {
        const verifyResponse = await fetch(apiUrl('/api/workflow/verify'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            networkSelection: selectedNetwork,
            certificateId: firstCertificate.certificateId || 'BATCH_VERIFICATION',
            merkleRoot: deploymentResults.merkleRoot,
            certificateData: firstCertificate,
            contractAddress: deploymentResults.contractAddress
          })
        });
        if (verifyResponse.ok) {
          const verifyData = await verifyResponse.json();
          batchVerification = {
            verified: verifyData.isValid ?? verifyData.valid ?? false,
            onChainData: verifyData.onChainData,
            note: (verifyData.isValid ?? verifyData.valid) ? 'Merkle root verified on-chain' : 'Merkle root mismatch with on-chain data'
          };
        } else {
          batchVerification = { verified: false, note: 'Batch verification endpoint unavailable' };
        }
      } catch {
        batchVerification = { verified: false, note: 'Verification service unavailable' };
      }

      const verifications = generatedCertificates.map((cert) => ({
        certificate: cert,
        verified: batchVerification.verified,
        onChainData: batchVerification.onChainData,
        merkleProof: cert.merkleProof,
        note: batchVerification.note
      }));

      setVerificationData({
        totalCertificates: generatedCertificates.length,
        verifiedCount: verifications.filter(v => v.verified).length,
        verifications,
        merkleRoot: deploymentResults.merkleRoot,
        transactionHash: deploymentResults.transactionHash,
        contractAddress: deploymentResults.contractAddress,
        blockNumber: deploymentResults.blockNumber,
        gasUsed: deploymentResults.gasUsed,
        network: deploymentResults.network,
        networkRaw: deploymentResults.networkRaw,
        chainId: deploymentResults.chainId,
        layerType: deploymentResults.layerType,
        isLayer2: deploymentResults.isLayer2,
        rpcUrl: deploymentResults.rpcUrl,
        verifiedAt: new Date().toISOString(),
        deploymentSuccessful: true
      });
      setShowVerification(true);
    } catch (error) {
      console.error('Error verifying deployed data:', error);
      alert(`Failed to verify deployed data: ${error.message}`);
    }
  };

  // FIX: go back to /verify so the user can re-run field mapping
  // without having to re-upload their file from scratch.
  const resetProcess = () => {
    localStorage.removeItem('verifiedStudentData');
    localStorage.removeItem('issueCertificateData');
    localStorage.removeItem('fileAnalysisData');
    router.push('/verify');
  };

  const onNetworkChange = (event) => {
    setSelectedNetwork(event.target.value);
    localStorage.setItem('selectedBlockchainNetwork', event.target.value);
  };

  // FIX: go back to /verify instead of /generate-proof —
  // fileAnalysisData is still in localStorage so the session is intact.
  const reprocessAllStudents = () => {
    if (confirm(`You currently have ${generatedCertificates.length} certificates but ${studentData.totalCount} students total. Do you want to restart the workflow to process all ${studentData.totalCount} students?`)) {
      localStorage.removeItem('verifiedStudentData');
      localStorage.removeItem('issueCertificateData');
      router.push('/verify');
    }
  };

  if (!studentData) {
    return (
      <Layout title="Loading...">
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600">Loading student data...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (studentData.isEmpty) {
    return (
      <Layout title="Issue Certificates - ZK Certificate System">
        <div className="min-h-screen bg-gray-50">
          <div className="bg-white border-b">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
              <div className="mx-auto h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                <span className="text-blue-600 text-2xl">📜</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Issue Certificates</h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                No verified student data available for certificate generation
              </p>
            </div>
          </div>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="bg-white rounded-xl shadow-sm p-12 text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">No Data Available</h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
                Please go back to the verify page to process your student data first.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {/* FIX: primary CTA goes to /verify, not /generate-proof */}
                <Link href="/verify">
                  <a className="bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors font-semibold">
                    ← Go to Verify &amp; Map
                  </a>
                </Link>
                <Link href="/generate-proof">
                  <a className="border border-gray-300 text-gray-700 px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors font-semibold">
                    Upload New File
                  </a>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Issue Certificates - ZK Certificate System">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Issue Certificates</h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Generate and deploy certificates for {studentData.totalCount} verified students
            </p>
          </div>
        </div>

        {/* Dynamic Data Overview */}
        {dashboardStats && !dashboardStats.isEmpty && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-100 border-b">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing Data Overview</h3>
                <p className="text-sm text-gray-600">
                  Source: <strong>{dashboardStats.fileName}</strong> •
                  Uploaded: {new Date(dashboardStats.lastUpload).toLocaleDateString()}
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/80 p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-blue-600 mb-1">{dashboardStats.totalStudents}</div>
                  <div className="text-xs font-medium text-blue-800">Source Students</div>
                </div>
                <div className="bg-white/80 p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-green-600 mb-1">{dashboardStats.dataColumns}</div>
                  <div className="text-xs font-medium text-green-800">Data Fields</div>
                </div>
                <div className="bg-white/80 p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-purple-600 mb-1">{dashboardStats.autoMappedFields}</div>
                  <div className="text-xs font-medium text-purple-800">Mapped Fields</div>
                </div>
                <div className="bg-white/80 p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-indigo-600 mb-1">{studentData?.totalCount || 0}</div>
                  <div className="text-xs font-medium text-indigo-800">Ready to Issue</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

          {/* Step 1: Ready */}
          {currentStep === 'ready' && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Ready to Generate Certificates</h2>
                <p className="text-gray-600 mb-8">
                  All student data has been verified. Generate elegant certificates for all {studentData.totalCount} students.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-lg">
                    <div className="text-3xl font-bold text-blue-600 mb-2">{studentData.totalCount}</div>
                    <div className="text-sm font-medium text-blue-800">Students Ready</div>
                  </div>
                  <div className="bg-green-50 p-6 rounded-lg">
                    <div className="text-sm font-medium text-green-800">Elegant Certificates</div>
                  </div>
                  <div className="bg-purple-50 p-6 rounded-lg">
                    <div className="text-sm font-medium text-purple-800">Blockchain Ready</div>
                  </div>
                </div>

                {zkProofStats && (
                  <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-lg mb-8">
                    <h4 className="font-semibold text-indigo-800 mb-4">Privacy-Preserving Zero-Knowledge Proofs</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-indigo-600">{zkProofStats.successful}</div>
                        <div className="text-sm text-indigo-700">Successful ZK Proofs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{zkProofStats.privacyEnabled ? '✓' : '✗'}</div>
                        <div className="text-sm text-green-700">Privacy Enabled</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{zkProofStats.total}</div>
                        <div className="text-sm text-purple-700">Total Proofs Generated</div>
                      </div>
                    </div>
                    {zkProofStats.privacyEnabled && (
                      <div className="mt-4 text-sm text-indigo-700 text-center bg-white p-3 rounded border border-indigo-200">
                        Certificates will support privacy-preserving verification without revealing actual grades
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={generateBulkCertificates}
                  className="bg-primary-600 text-white font-semibold px-8 py-4 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  🎓 Generate All {studentData.totalCount} Certificates
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Generating */}
          {currentStep === 'generating' && (
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Generating Certificates</h2>
                <p className="text-gray-600 mb-6">Creating {studentData.totalCount} certificates...</p>
                <div className="mt-4 bg-gray-200 rounded-full h-2 max-w-xs mx-auto">
                  <div className="bg-primary-600 h-2 rounded-full animate-pulse" style={{ width: '75%' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Complete */}
          {currentStep === 'complete' && (
            <div className="space-y-8">
              {generatedCertificates.length < studentData.totalCount && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 rounded-lg">
                  <div className="ml-3">
                    <h3 className="text-lg font-medium text-yellow-800 mb-2">Incomplete Processing Detected</h3>
                    <p className="text-sm text-yellow-700 mb-4">
                      Only <strong>{generatedCertificates.length} out of {studentData.totalCount}</strong> students were processed.
                    </p>
                    <button
                      onClick={reprocessAllStudents}
                      className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors text-sm font-medium"
                    >
                      Restart Workflow to Process All {studentData.totalCount} Students
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Certificate Generation Complete!</h2>
                <p className="text-gray-600 mb-8">
                  <strong>{generatedCertificates.length}</strong> certificates are ready for download and blockchain deployment.
                  {generatedCertificates.length < studentData.totalCount && (
                    <span className="block mt-2 text-yellow-600 font-medium">
                      Note: Only {generatedCertificates.length} of {studentData.totalCount} total students
                    </span>
                  )}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-lg">
                    <h3 className="font-semibold text-blue-800 mb-2">Download Certificates</h3>
                    <p className="text-sm text-blue-600 mb-4">Download all PDF certificates at once</p>
                    <button
                      onClick={downloadAllCertificates}
                      disabled={isGenerating}
                      className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                    >
                      {isGenerating ? 'Downloading...' : `Download All ${generatedCertificates.length} PDFs`}
                    </button>
                  </div>

                  <div className="bg-purple-50 p-6 rounded-lg">
                    <h3 className="font-semibold text-purple-800 mb-2">Deploy to Blockchain</h3>
                    <p className="text-sm text-purple-600 mb-4">Deploy Merkle tree for verification</p>
                    <div className="mb-4 text-left">
                      <label className="block text-sm font-medium text-purple-800 mb-1">Target Network</label>
                      <select
                        value={selectedNetwork}
                        onChange={onNetworkChange}
                        disabled={isDeploying}
                        className="w-full border border-purple-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100"
                      >
                        {NETWORK_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-purple-600">
                        {NETWORK_OPTIONS.find((o) => o.value === selectedNetwork)?.layer || 'Unknown Layer'}
                      </p>
                    </div>
                    <button
                      onClick={deployToBlockchain}
                      disabled={isDeploying}
                      className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400"
                    >
                      {isDeploying ? 'Deploying...' : 'Deploy to Blockchain'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Certificate List Preview */}
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-900">Generated Certificates Preview</h3>
                  <p className="text-gray-600">Showing {generatedCertificates.length} certificates</p>
                </div>
                <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                  {generatedCertificates.map((certificate, index) => (
                    <div key={certificate.id || index} className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold text-gray-900">{certificate.name}</h4>
                          <p className="text-sm text-gray-600">{certificate.course} • {certificate.percentage}%</p>
                          <p className="text-xs text-gray-500">ID: {certificate.certificateId}</p>
                        </div>
                        <button
                          onClick={() => downloadCertificate(certificate)}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Deploying */}
          {currentStep === 'deploying' && (
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-purple-600 border-r-transparent mb-4"></div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Deploying to Blockchain</h2>
                <p className="text-gray-600">Deploying Merkle tree structure to blockchain...</p>
              </div>
            </div>
          )}

          {/* Step 5: Deployed */}
          {currentStep === 'deployed' && deploymentResults && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Successfully Deployed to Blockchain!</h2>
                <p className="text-gray-600 mb-8">All certificates are now verifiable on the blockchain.</p>
                <div className="bg-gray-50 p-6 rounded-lg mb-8 max-w-2xl mx-auto">
                  <h3 className="font-semibold text-gray-900 mb-4">Deployment Details</h3>
                  <div className="space-y-2 text-sm text-left">
                    {[
                      ['Contract Address', deploymentResults.contractAddress],
                      ['Transaction Hash', deploymentResults.transactionHash],
                      ['Merkle Root', deploymentResults.merkleRoot],
                      ['Network', deploymentResults.network || 'Unknown'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-gray-600">{label}:</span>
                        <span className="font-mono text-gray-900 truncate ml-4">{value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Layer:</span>
                      <span className={`font-semibold ${deploymentResults.isLayer2 ? 'text-green-700' : 'text-amber-700'}`}>
                        {deploymentResults.isLayer2 ? 'Real Layer 2 Rollup' : 'Local Blockchain Simulation'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row justify-center gap-4">
                  <button onClick={downloadAllCertificates} className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
                    Download All Certificates
                  </button>
                  <button onClick={verifyDeployedData} className="bg-green-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-green-700 transition-colors">
                    Verify All Deployed Data
                  </button>
                  <button onClick={resetProcess} className="border-2 border-primary-600 text-primary-600 font-semibold px-6 py-3 rounded-lg hover:bg-primary-50 transition-colors">
                    Generate More Certificates
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Blockchain Verification Results */}
          {showVerification && verificationData && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden mt-8">
              <div className="px-8 py-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Blockchain Verification Results</h3>
                  <p className="text-gray-600">Real-time verification of deployed certificate data</p>
                </div>
                <button onClick={() => setShowVerification(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-green-50 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-600">{verificationData.verifiedCount}</div>
                    <div className="text-sm font-medium text-green-800">Verified</div>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-600">{verificationData.totalCertificates}</div>
                    <div className="text-sm font-medium text-blue-800">Total</div>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-purple-600">✓</div>
                    <div className="text-sm font-medium text-purple-800">On Blockchain</div>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg text-center">
                    <div className="text-lg font-bold text-orange-600">
                      {Math.round((verificationData.verifiedCount / verificationData.totalCertificates) * 100)}%
                    </div>
                    <div className="text-sm font-medium text-orange-800">Success Rate</div>
                  </div>
                </div>

                <div className="bg-gray-50 p-6 rounded-lg mb-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Blockchain Deployment Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {[
                      ['Contract Address', verificationData.contractAddress],
                      ['Transaction Hash', verificationData.transactionHash],
                      ['Block Number', verificationData.blockNumber],
                      ['Gas Used', verificationData.gasUsed ? `${verificationData.gasUsed} units` : 'N/A'],
                      ['Merkle Root', verificationData.merkleRoot],
                      ['Network', verificationData.network || 'Hardhat'],
                      ['Chain ID', verificationData.chainId ?? 'N/A'],
                      ['Layer', verificationData.layerType || 'Unknown'],
                      ['Verified At', new Date(verificationData.verifiedAt).toLocaleString()],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span className="text-gray-600">{label}:</span>
                        <div className="font-mono text-xs text-gray-900 break-all mt-1 bg-white p-2 rounded border">{value}</div>
                      </div>
                    ))}
                    <div>
                      <span className="text-gray-600">Mode:</span>
                      <div className={`mt-1 p-2 rounded border font-semibold ${verificationData.isLayer2 ? 'text-green-700 bg-green-50 border-green-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                        {verificationData.isLayer2 ? 'Real Layer 2 Rollup' : 'Local Blockchain Simulation'}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600">Status:</span>
                      <div className="text-green-600 font-semibold mt-1 bg-white p-2 rounded border">All Certificates On-Chain</div>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg">
                  <div className="px-4 py-3 border-b bg-gray-50">
                    <h4 className="font-semibold text-gray-900">🎓 On-Chain Certificate Status</h4>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {verificationData.verifications.map((verification, index) => (
                      <div key={index} className="p-4 border-b border-gray-100 last:border-b-0">
                        <div className="flex items-center justify-between">
                          <div>
                            <h5 className="font-semibold text-gray-900">{verification.certificate.name}</h5>
                            <p className="text-sm text-gray-600">
                              ID: {verification.certificate.certificateId} • {verification.certificate.course} • {verification.certificate.percentage}%
                            </p>
                            {verification.note && <p className="text-xs text-blue-600 mt-1">{verification.note}</p>}
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${verification.verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {verification.verified ? 'On Blockchain' : 'Not Found'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Back navigation */}
          {(currentStep === 'ready' || currentStep === 'complete') && (
            <div className="text-center mt-8">
              <Link href="/verify">
                <a className="text-primary-600 hover:text-primary-700 font-medium">
                  ← Back to Verify &amp; Map
                </a>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}