import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../src/components/Layout';

export default function IssueCertificates() {
  const router = useRouter();
  const [studentData, setStudentData] = useState(null);
  const [generatedCertificates, setGeneratedCertificates] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResults, setDeploymentResults] = useState(null);
  const [currentStep, setCurrentStep] = useState('ready'); // ready, generating, complete, deploying, deployed

  useEffect(() => {
    // Load verified student data from localStorage (set by verify.js)
    const savedData = localStorage.getItem('verifiedStudentData');
    if (savedData) {
      const data = JSON.parse(savedData);
      setStudentData(data);
      
      // Check if certificates are already generated
      if (data.certificates) {
        setGeneratedCertificates(data.certificates.map((cert, idx) => ({
          ...cert,
          certificateId: cert.certificateId || `CERT${Date.now()}${idx}`,
          status: 'ready'
        })));
        setCurrentStep('complete');
      }
    } else {
      // Redirect to generate-proof if no data
      router.push('/generate-proof');
    }
  }, [router]);

  const generateBulkCertificates = async () => {
    if (!studentData || !studentData.certificates) {
      alert('No student data found');
      return;
    }

    setIsGenerating(true);
    setCurrentStep('generating');

    try {
      // Generate certificates for all students
      const certificates = studentData.certificates.map((student, idx) => ({
        ...student,
        certificateId: student.certificateId || `CERT${Date.now()}${idx}`,
        issueDate: new Date().toLocaleDateString(),
        verificationCode: `VF${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        status: 'ready'
      }));

      setGeneratedCertificates(certificates);

      // Update certificate data in localStorage
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
      const response = await fetch('http://localhost:3001/api/workflow/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          studentData: certificate,
          template: {
            type: 'elegant',
            title: 'CERTIFICATE OF COMPLETION',
            colors: {
              primary: '#2c3e50',
              secondary: '#3498db',
              accent: '#e74c3c'
            }
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'PDF generation failed');
      }

      // Download the PDF
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
      // Download each certificate individually with delay
      for (let i = 0; i < generatedCertificates.length; i++) {
        const certificate = generatedCertificates[i];
        await downloadCertificate(certificate);

        // Add delay between downloads
        if (i < generatedCertificates.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      alert(`Successfully downloaded ${generatedCertificates.length} certificates!`);
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

    setIsDeploying(true);
    setCurrentStep('deploying');

    try {
      const deployResponse = await fetch('http://localhost:3001/api/workflow/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merkleRoot: studentData.merkleRoot,
          certificateCount: generatedCertificates.length,
          metadata: {
            totalStudents: generatedCertificates.length,
            fileName: studentData.fileName,
            generatedAt: new Date().toISOString()
          }
        })
      });

      if (!deployResponse.ok) {
        const errorData = await deployResponse.json();
        throw new Error(errorData.message || 'Deployment failed');
      }

      const deployData = await deployResponse.json();
      
      setDeploymentResults({
        success: true,
        contractAddress: deployData.contractAddress,
        transactionHash: deployData.transactionHash,
        merkleRoot: studentData.merkleRoot,
        deployedAt: new Date().toISOString()
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

  const resetProcess = () => {
    localStorage.removeItem('verifiedStudentData');
    localStorage.removeItem('fileAnalysisData');
    router.push('/generate-proof');
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

  return (
    <Layout title="Issue Certificates - ZK Certificate System">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 bg-orange-100 rounded-full flex items-center justify-center mb-6">
                <span className="text-orange-600 text-2xl">🚀</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Issue Certificates
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Generate and deploy certificates for {studentData.totalCount} verified students
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Step 1: Ready to Generate */}
          {currentStep === 'ready' && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  Ready to Generate Certificates
                </h2>
                <p className="text-gray-600 mb-8">
                  All student data has been verified. Generate elegant horizontal certificates with golden borders for all {studentData.totalCount} students.
                </p>

                {/* Certificate Generation Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-lg">
                    <div className="text-3xl font-bold text-blue-600 mb-2">{studentData.totalCount}</div>
                    <div className="text-sm font-medium text-blue-800">Students Ready</div>
                  </div>
                  <div className="bg-green-50 p-6 rounded-lg">
                    <div className="text-2xl font-bold text-green-600 mb-2">📄</div>
                    <div className="text-sm font-medium text-green-800">Elegant Certificates</div>
                  </div>
                  <div className="bg-purple-50 p-6 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600 mb-2">🔐</div>
                    <div className="text-sm font-medium text-purple-800">Blockchain Ready</div>
                  </div>
                </div>

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
                <p className="text-gray-600 mb-6">
                  Creating {studentData.totalCount} elegant certificates with blockchain verification...
                </p>
                <div className="mt-4 bg-gray-200 rounded-full h-2 max-w-xs mx-auto">
                  <div className="bg-primary-600 h-2 rounded-full transition-all duration-500 animate-pulse" style={{ width: '75%' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Complete - Download & Deploy */}
          {currentStep === 'complete' && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-green-600 text-2xl">🎉</span>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  Certificates Generated Successfully!
                </h2>
                <p className="text-gray-600 mb-8">
                  <strong>{generatedCertificates.length}</strong> elegant certificates are ready for download and blockchain deployment.
                </p>

                {/* Action Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600 mb-2">📄</div>
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
                    <div className="text-2xl font-bold text-purple-600 mb-2">🚀</div>
                    <h3 className="font-semibold text-purple-800 mb-2">Deploy to Blockchain</h3>
                    <p className="text-sm text-purple-600 mb-4">Deploy Merkle tree for verification</p>
                    <button
                      onClick={deployToBlockchain}
                      disabled={isDeploying}
                      className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400"
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
                  <p className="text-gray-600">Elegant horizontal certificates with institutional branding</p>
                </div>
                <div className="divide-y divide-gray-200 max-h-64 overflow-y-auto">
                  {generatedCertificates.slice(0, 5).map((certificate, index) => (
                    <div key={certificate.id || index} className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold text-gray-900">{certificate.name}</h4>
                          <p className="text-sm text-gray-600">{certificate.course} • {certificate.percentage}%</p>
                          <p className="text-xs text-gray-500">ID: {certificate.certificateId}</p>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => downloadCertificate(certificate)}
                            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
                          >
                            📄 Download
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {generatedCertificates.length > 5 && (
                    <div className="p-4 text-center text-gray-500">
                      ... and {generatedCertificates.length - 5} more certificates
                    </div>
                  )}
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
                <p className="text-gray-600">
                  Deploying Merkle tree structure to blockchain for certificate verification...
                </p>
              </div>
            </div>
          )}

          {/* Step 5: Deployed */}
          {currentStep === 'deployed' && deploymentResults && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-green-600 text-2xl">🎊</span>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  Successfully Deployed to Blockchain!
                </h2>
                <p className="text-gray-600 mb-8">
                  All certificates are now verifiable on the blockchain with cryptographic proofs.
                </p>

                {/* Deployment Results */}
                <div className="bg-gray-50 p-6 rounded-lg mb-8 max-w-2xl mx-auto">
                  <h3 className="font-semibold text-gray-900 mb-4">Deployment Details</h3>
                  <div className="space-y-2 text-sm text-left">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Contract Address:</span>
                      <span className="font-mono text-gray-900">{deploymentResults.contractAddress}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Transaction Hash:</span>
                      <span className="font-mono text-gray-900 truncate">{deploymentResults.transactionHash}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Merkle Root:</span>
                      <span className="font-mono text-gray-900 truncate">{deploymentResults.merkleRoot}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-4">
                  <button
                    onClick={downloadAllCertificates}
                    className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                     Download All Certificates
                  </button>
                  <button
                    onClick={resetProcess}
                    className="border-2 border-primary-600 text-primary-600 font-semibold px-6 py-3 rounded-lg hover:bg-primary-50 transition-colors"
                  >
                    Generate More Certificates
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          {(currentStep === 'ready' || currentStep === 'complete') && (
            <div className="text-center mt-8">
              <Link href="/generate-proof">
                <a className="text-primary-600 hover:text-primary-700 font-medium">
                  ← Back to Upload New File
                </a>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
