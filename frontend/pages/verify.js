import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../src/components/Layout';

export default function VerifyData() {
  const router = useRouter();
  const [fileAnalysis, setFileAnalysis] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [fieldMappings, setFieldMappings] = useState({});
  const [fileName, setFileName] = useState('');
  const [processingErrors, setProcessingErrors] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Load file analysis data from localStorage (set by generate-proof.js)
    const savedData = localStorage.getItem('fileAnalysisData');
    if (savedData) {
      const data = JSON.parse(savedData);
      setFileAnalysis(data.fileAnalysis);
      setSessionId(data.sessionId);
      setFileName(data.fileName);
      setFieldMappings(data.fileAnalysis.suggestedMappings || {});
    } else {
      // Redirect to generate-proof if no data
      router.push('/generate-proof');
    }
  }, [router]);

  const updateFieldMapping = (targetField, sourceColumn) => {
    setFieldMappings(prev => ({
      ...prev,
      [targetField]: sourceColumn
    }));
  };

  const processAndProceedToIssue = async () => {
    if (!sessionId) {
      alert('No file session found. Please upload a file again.');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch('http://localhost:3001/api/workflow/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      if (!data.success) {
        throw new Error(data.message || 'Data processing failed');
      }

      // Store processed student data for issue page
      const certificateData = {
        certificates: data.certificates,
        merkleRoot: data.merkleRoot,
        merkleTreeStats: data.merkleTreeStats,
        totalCount: data.certificates.length,
        processedAt: new Date().toISOString(),
        fileName: fileName
      };
      localStorage.setItem('verifiedStudentData', JSON.stringify(certificateData));

      // Redirect to issue page for certificate generation
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

  if (!fileAnalysis) {
    return (
      <Layout title="Loading...">
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600">Loading file data...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Verify Student Data - ZK Certificate System">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
                <span className="text-green-600 text-2xl">✅</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Verify Student Data
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Review all student records from <strong>{fileName}</strong> before proceeding to certificate generation
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-8">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  Data Verification
                </h2>
                <p className="text-gray-600">
                  Found {fileAnalysis.totalRows} rows with {fileAnalysis.columns.length} columns.
                  Review your data before generating certificates.
                </p>
              </div>

              {/* File Analysis Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-blue-50 p-6 rounded-lg text-center">
                  <div className="text-3xl font-bold text-blue-600 mb-2">{fileAnalysis.totalRows}</div>
                  <div className="text-sm font-medium text-blue-800">Total Students</div>
                </div>
                <div className="bg-green-50 p-6 rounded-lg text-center">
                  <div className="text-3xl font-bold text-green-600 mb-2">{fileAnalysis.columns.length}</div>
                  <div className="text-sm font-medium text-green-800">Data Columns</div>
                </div>
                <div className="bg-purple-50 p-6 rounded-lg text-center">
                  <div className="text-3xl font-bold text-purple-600 mb-2">{Object.values(fieldMappings).filter(v => v).length}</div>
                  <div className="text-sm font-medium text-purple-800">Auto-Mapped Fields</div>
                </div>
              </div>

              {/* Complete Student Data - All Rows */}
              <div className="bg-gray-50 p-6 rounded-lg mb-8">
                <h3 className="font-semibold text-gray-900 mb-4">👥 Complete Student List ({fileAnalysis.totalRows} students)</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          #
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          Student Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          Student ID
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          Email Address
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          Score/Percentage
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(fileAnalysis.allData && fileAnalysis.allData.length > 0 
                        ? fileAnalysis.allData 
                        : fileAnalysis.sampleData || []
                      ).map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-500">
                            {idx + 1}
                          </td>
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
                            {row[fieldMappings.percentage] || row.percentage || row.Percentage || row.PERCENTAGE || row.score || row.Score || row.marks || row.Marks || row.total || row.Total || ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 text-sm text-gray-600 text-center">
                  Showing all {(fileAnalysis.allData && fileAnalysis.allData.length > 0 
                    ? fileAnalysis.allData.length 
                    : (fileAnalysis.sampleData || []).length
                  )} students • Essential columns: Name, Student ID, Email, Score/Percentage
                </div>
              </div>

              {/* Field Mapping Status */}
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-8">
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

              {/* Processing Errors */}
              {processingErrors.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-8">
                  <h4 className="text-sm font-semibold text-yellow-800 mb-2">⚠️ Data Issues</h4>
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

              {/* Action Buttons */}
              <div className="flex justify-center space-x-4">
                <button
                  onClick={backToUpload}
                  className="border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Upload Different File
                </button>
                
                {/* Manual Field Mapping Option */}
                {!Object.entries(fieldMappings).some(([key, value]) => value && key === 'name') && (
                  <div className="text-center">
                    <p className="text-sm text-red-600 mb-4">⚠️ Name field mapping required</p>
                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-4">
                      <h4 className="text-sm font-semibold text-yellow-800 mb-2">Manual Field Mapping Required</h4>
                      <div className="space-y-2">
                        <label className="block text-left">
                          <span className="text-sm font-medium text-gray-700">Student Name Column:</span>
                          <select
                            value={fieldMappings.name || ''}
                            onChange={(e) => updateFieldMapping('name', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 mt-1"
                          >
                            <option value="">-- Select Column --</option>
                            {fileAnalysis.columns.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={processAndProceedToIssue}
                  disabled={!Object.entries(fieldMappings).some(([key, value]) => value && key === 'name') || isProcessing}
                  className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isProcessing ? 'Processing...' : `Proceed to Generate ${fileAnalysis.totalRows} Certificates`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
