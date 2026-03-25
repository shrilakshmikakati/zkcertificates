import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../src/components/Layout';
import { apiUrl } from '../src/lib/api';

export default function VerifyData() {
  const router = useRouter();
  const [fileAnalysis, setFileAnalysis] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [fieldMappings, setFieldMappings] = useState({});
  const [fileName, setFileName] = useState('');
  const [processingErrors, setProcessingErrors] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [enableZKProofs, setEnableZKProofs] = useState(true);
  const [zkProofStatus, setZkProofStatus] = useState('');
  const [requiresReupload, setRequiresReupload] = useState(false);

  useEffect(() => {
    const savedData = localStorage.getItem('fileAnalysisData');
    if (savedData) {
      const data = JSON.parse(savedData);
      setFileAnalysis(data.fileAnalysis);
      setSessionId(data.sessionId);
      setFileName(data.fileName);
      setFieldMappings(data.fileAnalysis.suggestedMappings || {});
      setRequiresReupload(false);
    } else {
      fetchLatestSessionData();
    }
  }, [router]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const savedData = localStorage.getItem('fileAnalysisData');
        if (savedData) {
          const data = JSON.parse(savedData);
          setFileAnalysis(data.fileAnalysis);
          setSessionId(data.sessionId);
          setFileName(data.fileName);
          setFieldMappings(data.fileAnalysis.suggestedMappings || {});
          setRequiresReupload(false);
        } else {
          fetchLatestSessionData();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const fetchLatestSessionData = async () => {
    try {
      const response = await fetch(apiUrl('/api/workflow/dashboard-stats'));
      if (response.ok) {
        const data = await response.json();
        if (data.success && !data.data.isEmpty) {
          const mockFileAnalysis = {
            totalRows: data.data.totalStudents,
            columns: data.data.columns,
            sampleData: data.data.sampleData,
            allData: data.data.allData,
            suggestedMappings: {}
          };
          setFileAnalysis(mockFileAnalysis);
          setFileName(data.data.fileName);
          setFieldMappings(mockFileAnalysis.suggestedMappings || {});
          setRequiresReupload(true);
        } else {
          setFileAnalysis({ isEmpty: true });
        }
      }
    } catch (error) {
      console.error('Failed to fetch session data:', error);
      setFileAnalysis({ isEmpty: true });
    }
  };

  const updateFieldMapping = (targetField, sourceColumn) => {
    setFieldMappings(prev => ({
      ...prev,
      [targetField]: sourceColumn
    }));
  };

  const generateZKProofsForStudents = async (students) => {
    if (!enableZKProofs) return null;
    
    try {
      setZkProofStatus('Generating privacy-preserving ZK proofs...');
      
      console.log('🔐 STARTING ZK PROOF GENERATION:', {
        studentCount: students.length,
        enableZKProofs: enableZKProofs,
        firstStudent: students[0] ? {
          keys: Object.keys(students[0]),
          studentId: students[0].studentId,
          student_id: students[0].student_id,
          hasName: !!students[0].name
        } : 'N/A'
      });
      
      const zkProofs = await Promise.all(
        students.map(async (student, index) => {
          try {
            // ─────────────────────────────────────────────────────────────
            // FIX: Use the real student ID from ALL possible field names.
            // Previously only checked student.studentId (camelCase) which
            // was undefined for CSV data that uses student_id (underscore),
            // causing fallback to STU0, STU1... index IDs.
            // Now checks every field name that DynamicCertificateService
            // and the field mapping could produce.
            // ─────────────────────────────────────────────────────────────
            const studentId =
              student.student_id         ||   // underscore — from CSV field mapping
              student.studentId          ||   // camelCase — from some sources
              student['Student ID']      ||   // original CSV column name
              student['STUDENT ID']      ||
              student['Roll No']         ||
              student['Roll_No']         ||
              student['roll_no']         ||
              student['ID']              ||
              student['id']              ||
              student.roll               ||
              student.Roll               ||
              student.registration_no    ||
              student.reg_no             ||
              null;

            // Only fall back to index if truly no ID found
            const finalStudentId = studentId || `STU${index}`;

            if (index < 3) {
              console.log(`  📝 Student ${index + 1}: resolved studentId="${finalStudentId}"`, {
                raw_student_id: student.student_id,
                raw_studentId:  student.studentId,
                name:           student.name,
                email:          student.email
              });
            }
            
            const requestBody = {
              studentId: finalStudentId,
              subjects: [
                student.math    || 0,
                student.science || 0,
                student.english || 0,
                student.history || 0,
                student.art     || 0
              ],
              salt: Math.random().toString(36).substr(2, 16),
              minPassingGrade: 60,
              requireAllPassed: false
            };
            
            const response = await fetch(apiUrl('/api/zkproofs/generate'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            });
            
            if (response.ok) {
              const zkData = await response.json();
              const result = {
                studentId: finalStudentId,
                zkProof: zkData.data,
                status: 'success'
              };
              if (index < 3) {
                console.log(`    ✓ Generated proof for: ${finalStudentId}`, {
                  hasProof: !!result.zkProof,
                  proofKeys: result.zkProof ? Object.keys(result.zkProof) : 'N/A'
                });
              }
              return result;
            } else {
              const errorData = await response.json();
              if (index < 3) {
                console.log(`    ✗ Failed to generate: ${finalStudentId}`, errorData);
              }
              return {
                studentId: finalStudentId,
                status: 'failed',
                error: 'ZK proof generation failed'
              };
            }
          } catch (error) {
            if (index < 3) {
              console.log(`    ✗ Error for student ${index}: ${error.message}`);
            }
            return {
              studentId:
                student.student_id || student.studentId ||
                student['Student ID'] || student['ID'] || `STU${index}`,
              status: 'failed',
              error: error.message
            };
          }
        })
      );
      
      const successful = zkProofs.filter(p => p.status === 'success').length;
      const failed     = zkProofs.filter(p => p.status === 'failed').length;
      
      console.log('✅ ZK PROOF BATCH COMPLETE:', {
        total: zkProofs.length,
        successful,
        failed,
        sampleProofs: zkProofs.slice(0, 3).map(p => ({
          studentId: p.studentId,
          status: p.status,
          hasProof: !!p.zkProof
        }))
      });
      
      setZkProofStatus(`Generated ${successful} ZK proofs (${failed} failed)`);
      return zkProofs;

    } catch (error) {
      console.warn('ZK proof generation failed:', error);
      setZkProofStatus('ZK proof generation failed - proceeding with standard verification');
      return null;
    }
  };

  const processAndProceedToIssue = async () => {
    if (!sessionId) {
      alert('Session data is missing. Please re-upload your file to continue.');
      return;
    }

    setIsProcessing(true);
    setZkProofStatus('');

    try {
      const response = await fetch(apiUrl('/api/workflow/process'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          fieldMappings: fieldMappings,
          processingOptions: {
            requiredFields: ['name'],
            skipEmptyRows: true,
            validateEmails: true
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to process data');
      }

      const data = await response.json();
      if (!data.success) throw new Error(data.message || 'Data processing failed');

      const zkProofs = await generateZKProofsForStudents(data.certificates);

      console.log('📊 ZK PROOF GENERATION COMPLETE:', {
        generated:   zkProofs ? zkProofs.length : 0,
        successful:  zkProofs ? zkProofs.filter(p => p.status === 'success').length : 0,
        failed:      zkProofs ? zkProofs.filter(p => p.status === 'failed').length : 0,
        firstProof:  zkProofs && zkProofs[0] ? {
          studentId:    zkProofs[0].studentId,
          status:       zkProofs[0].status,
          hasProofData: !!zkProofs[0].zkProof
        } : 'N/A',
        allProofs: JSON.stringify(zkProofs)
      });

      const certificateData = {
        certificates:   data.certificates,
        merkleRoot:     data.merkleRoot,
        merkleTreeStats:data.merkleTreeStats,
        zkProofs:       zkProofs,
        enabledPrivacy: enableZKProofs,
        totalCount:     data.certificates.length,
        processedAt:    new Date().toISOString(),
        fileName:       fileName
      };

      console.log('💾 STORING TO LOCALSTORAGE - verifiedStudentData:', {
        certificatesCount: certificateData.certificates?.length,
        zkProofsCount:     certificateData.zkProofs?.length,
        enabledPrivacy:    certificateData.enabledPrivacy
      });

      localStorage.setItem('verifiedStudentData', JSON.stringify(certificateData));
      router.push('/issue');

    } catch (error) {
      console.error('Error processing data:', error);
      alert(`Error processing data: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const backToUpload = () => {
    localStorage.removeItem('fileAnalysisData');
    router.push('/generate-proof');
  };

  // ── render (unchanged from original) ────────────────────────────────────────

  if (!fileAnalysis) {
    return (
      <Layout title="Process & Map Data - ZK Certificates">
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600">Loading data...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (fileAnalysis.isEmpty) {
    return (
      <Layout title="Process & Map Data - ZK Certificates">
        <div className="min-h-screen bg-gray-50">
          <div className="bg-white border-b">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
              <div className="text-center">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Process & Map Data</h1>
                <p className="text-lg text-gray-600 max-w-2xl mx-auto">No data available to process</p>
              </div>
            </div>
          </div>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="bg-white rounded-xl shadow-sm p-12 text-center">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">No Data Available</h2>
              <p className="text-gray-600 mb-8">Please upload a CSV or Excel file first.</p>
              <Link href="/generate-proof">
                <a className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors">
                  Upload Student Data
                </a>
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Process & Map Data - ZK Certificates">
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Verify & Process Data
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Review your student data and field mappings before generating certificates
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {requiresReupload && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-yellow-800">
                <strong>Session data missing:</strong> Please re-upload your file to proceed with processing.
              </p>
            </div>
          )}

          {/* File info */}
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {fileName || 'Uploaded File'}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {fileAnalysis.totalRows} students &nbsp;·&nbsp; {fileAnalysis.columns?.length || 0} columns
                </p>
              </div>
              <button
                onClick={backToUpload}
                className="text-sm border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Upload Different File
              </button>
            </div>
          </div>

          {/* Student data preview table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                Student Data Preview ({fileAnalysis.totalRows} students)
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Review data before processing
              </p>
            </div>

            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">#</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Student Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Student ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Email Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Score/Percentage</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(fileAnalysis.allData && fileAnalysis.allData.length > 0
                    ? fileAnalysis.allData
                    : fileAnalysis.sampleData || []
                  ).map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-500">{idx + 1}</td>
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">
                        {row[fieldMappings.name] || row.name || row.Name || row.STUDENT_NAME || ''}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {row[fieldMappings.student_id] || row.student_id || row.Student_ID || row.Roll_No || row.ID || ''}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {row[fieldMappings.email] || row.email || row.Email || row.EMAIL || ''}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">
                        {row[fieldMappings.percentage] || row.percentage || row.Percentage || row.score || row.Score || row.marks || row.Marks || row.total || row.Total || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-sm text-gray-600 text-center px-6 pb-4">
              Showing all {(fileAnalysis.allData && fileAnalysis.allData.length > 0
                ? fileAnalysis.allData.length
                : (fileAnalysis.sampleData || []).length
              )} students
            </div>
          </div>

          {/* Smart mapping status */}
          {Object.entries(fieldMappings).some(([, v]) => v) && (
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-6">
              <h4 className="text-sm font-semibold text-blue-800 mb-2">🧠 Smart Mapping Applied</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                {Object.entries(fieldMappings).filter(([, v]) => v).map(([field, column]) => (
                  <div key={field} className="flex items-center">
                    <span className="text-blue-600 font-medium capitalize">{field.replace('_', ' ')}</span>
                    <span className="mx-1 text-blue-400">→</span>
                    <span className="text-blue-700">{column}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual field mapping if name not mapped */}
          {!Object.entries(fieldMappings).some(([key, value]) => value && key === 'name') && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-6">
              <h4 className="text-sm font-semibold text-yellow-800 mb-2">Manual Field Mapping Required</h4>
              <label className="block text-left">
                <span className="text-sm font-medium text-gray-700">Student Name Column:</span>
                <select
                  value={fieldMappings.name || ''}
                  onChange={(e) => updateFieldMapping('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 mt-1"
                >
                  <option value="">-- Select Column --</option>
                  {fileAnalysis.columns?.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Processing errors */}
          {processingErrors.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-6">
              <h4 className="text-sm font-semibold text-yellow-800 mb-2">⚠ Data Issues</h4>
              <div className="text-xs text-yellow-700 space-y-1">
                {processingErrors.slice(0, 3).map((error, idx) => (
                  <div key={idx}>Row {error.row}: {error.error}</div>
                ))}
                {processingErrors.length > 3 && (
                  <div>... and {processingErrors.length - 3} more issues</div>
                )}
              </div>
            </div>
          )}

          {/* Privacy & ZK Proof toggle */}
          <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-lg mb-8">
            <h4 className="text-lg font-semibold text-indigo-800 mb-4">Privacy-Preserving Options</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900">Generate Zero-Knowledge Proofs</h5>
                  <p className="text-sm text-gray-600">
                    Enable privacy-preserving verification that proves academic achievements without revealing actual grades
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={enableZKProofs}
                    onChange={(e) => setEnableZKProofs(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              {enableZKProofs && (
                <div className="bg-white p-4 rounded-lg border border-indigo-200">
                  <div className="flex items-center space-x-2 text-sm text-indigo-700">
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                    <span>ZK proofs will use the real student IDs from your uploaded data</span>
                  </div>
                </div>
              )}
              {zkProofStatus && (
                <div className="bg-white p-3 rounded-lg border border-indigo-200">
                  <div className="text-sm text-indigo-700">{zkProofStatus}</div>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-center space-x-4">
            <button
              onClick={backToUpload}
              className="border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Upload Different File
            </button>

            {requiresReupload && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm max-w-md">
                Session data is missing. Please re-upload your file before proceeding.
              </div>
            )}

            <button
              onClick={processAndProceedToIssue}
              disabled={
                requiresReupload ||
                !Object.entries(fieldMappings).some(([key, value]) => value && key === 'name') ||
                isProcessing
              }
              className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : `Proceed to Generate ${fileAnalysis.totalRows} Certificates`}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}