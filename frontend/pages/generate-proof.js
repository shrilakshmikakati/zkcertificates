import React, { useState } from 'react';
import Link from 'next/link';
import Layout from '../src/components/Layout';

export default function GenerateProof() {
  const [uploadedFile, setUploadedFile] = useState(null);
  const [fileAnalysis, setFileAnalysis] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [fieldMappings, setFieldMappings] = useState({});
  const [students, setStudents] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingErrors, setProcessingErrors] = useState([]);
  const [generatedCertificates, setGeneratedCertificates] = useState([]);
  const [certificateTemplate, setCertificateTemplate] = useState('standard');
  const [currentStep, setCurrentStep] = useState('upload'); // upload, mapping, select, generate, complete

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      const validTypes = [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ];

      if (!validTypes.includes(file.type)) {
        alert('Please upload a CSV or XLSX file');
        return;
      }

      setUploadedFile(file);
      parseFile(file);
    }
  };

  const parseFile = async (file) => {
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:3001/api/workflow/parse', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to parse file');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'File analysis failed');
      }

      setFileAnalysis(data);
      setSessionId(data.sessionId);
      setFieldMappings(data.suggestedMappings || {});
      setCurrentStep('mapping'); // Move to field mapping step

    } catch (error) {
      console.error('Error parsing file:', error);
      alert(`Error parsing file: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const processWithMappings = async () => {
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

      // Store Merkle tree data for blockchain deployment
      const certificateData = {
        certificates: data.certificates,
        merkleRoot: data.merkleRoot,
        merkleTreeStats: data.merkleTreeStats,
        totalCount: data.certificates.length,
        processedAt: new Date().toISOString()
      };
      localStorage.setItem('generatedCertificates', JSON.stringify(certificateData));

      setStudents(data.certificates);
      setSelectedStudents(new Set(data.certificates.map(s => s.id)));
      setProcessingErrors(data.errors || []);
      setCurrentStep('select'); // Move to student selection

    } catch (error) {
      console.error('Error processing data:', error);
      alert(`Error processing data: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const updateFieldMapping = (targetField, sourceColumn) => {
    setFieldMappings(prev => ({
      ...prev,
      [targetField]: sourceColumn
    }));
  };

  const toggleStudentSelection = (studentId) => {
    const newSelected = new Set(selectedStudents);
    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
    } else {
      newSelected.add(studentId);
    }
    setSelectedStudents(newSelected);
  };

  const selectAll = () => {
    setSelectedStudents(new Set(students.map(s => s.id)));
  };

  const deselectAll = () => {
    setSelectedStudents(new Set());
  };

  const generateCertificates = async () => {
    if (selectedStudents.size === 0) {
      alert('Please select at least one student');
      return;
    }

    setIsProcessing(true);
    setCurrentStep('generate');

    try {
      const selectedStudentData = students.filter(s => selectedStudents.has(s.id));

      // The certificates already have Merkle proofs from the processing step
      const certificates = selectedStudentData.map((student) => ({
        ...student,
        certificateId: student.certificateId || `CERT${Date.now()}${student.id}`,
        issueDate: new Date().toLocaleDateString(),
        verificationCode: `VF${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        status: 'ready'
      }));

      setGeneratedCertificates(certificates);

      // Update certificate data in localStorage to include selected certificates only
      const existingData = JSON.parse(localStorage.getItem('generatedCertificates') || '{}');
      const updatedData = {
        ...existingData,
        selectedCertificates: certificates,
        totalSelectedCount: certificates.length
      };
      localStorage.setItem('generatedCertificates', JSON.stringify(updatedData));

      setCurrentStep('complete');

    } catch (error) {
      console.error('Error generating certificates:', error);
      alert(`Error generating certificates: ${error.message}`);
    } finally {
      setIsProcessing(false);
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
            type: certificateTemplate,
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

    try {
      // Download each certificate individually
      for (let i = 0; i < generatedCertificates.length; i++) {
        const certificate = generatedCertificates[i];
        await downloadCertificate(certificate);

        // Add a small delay between downloads to avoid overwhelming the server
        if (i < generatedCertificates.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error('Error downloading all certificates:', error);
      alert('Failed to download certificates. Please try again.');
    }
  };

  const resetProcess = () => {
    // Clean up session if exists
    if (sessionId) {
      fetch(`http://localhost:3001/api/workflow/cleanup/${sessionId}`, {
        method: 'DELETE'
      }).catch(err => console.warn('Session cleanup failed:', err));
    }

    setUploadedFile(null);
    setFileAnalysis(null);
    setSessionId(null);
    setFieldMappings({});
    setStudents([]);
    setSelectedStudents(new Set());
    setGeneratedCertificates([]);
    setProcessingErrors([]);
    setCurrentStep('upload');
  };

  return (
    <Layout title="Generate Proof Certificate - ZK Certificate System">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 bg-primary-600 rounded-full flex items-center justify-center mb-6">
                <span className="text-white text-2xl font-bold">📊</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Generate Digital Certificates
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Complete workflow: Upload CSV/Excel → Map data fields → Select students → Generate PDF certificates with Merkle tree integration for blockchain verification.
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Step 1: File Upload */}
          {currentStep === 'upload' && (
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <h2 className="text-2xl font-semibold text-gray-900 mb-8">Upload Student Data</h2>

                <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 hover:border-primary-500 transition-colors">
                  <div className="text-center">
                    <div className="mx-auto h-16 w-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
                      <span className="text-primary-600 text-2xl">📄</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Select CSV or Excel File
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Upload a file containing student names, courses, grades, and other certificate details
                    </p>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors cursor-pointer inline-block"
                    >
                      Choose File
                    </label>
                  </div>
                </div>

                <div className="mt-8 bg-blue-50 p-4 rounded-lg text-left">
                  <h4 className="font-semibold text-blue-800 mb-2">Required CSV/Excel Columns:</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• <strong>name</strong> - Student full name</li>
                    <li>• <strong>email</strong> - Student email address</li>
                    <li>• <strong>course</strong> - Course/program name</li>
                    <li>• <strong>institution</strong> - Institution name</li>
                    <li>• <strong>graduation_date</strong> - Date of graduation</li>
                    <li>• <strong>grade</strong> - Merit level (e.g., "Merit - First Class")</li>
                    <li>• <strong>percentage</strong> - Overall percentage</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Processing Step */}
          {(currentStep === 'processing' || isProcessing) && (
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Processing File</h2>
                <p className="text-gray-600">
                  {currentStep === 'processing' ? 'Analyzing file structure...' : 'Processing your data...'}
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Field Mapping */}
          {currentStep === 'mapping' && fileAnalysis && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-8">
                <div className="text-center mb-8">
                  <div className="mx-auto h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-blue-600 text-2xl">🔗</span>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    Map Your Data Fields
                  </h2>
                  <p className="text-gray-600">
                    Found {fileAnalysis.totalRows} rows with {fileAnalysis.columns.length} columns.
                    Map your data fields to certificate requirements.
                  </p>
                </div>

                {/* File Analysis Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="bg-gray-50 p-6 rounded-lg text-center">
                    <div className="text-3xl font-bold text-gray-600 mb-2">{fileAnalysis.totalRows}</div>
                    <div className="text-sm font-medium text-gray-800">Total Records</div>
                  </div>
                  <div className="bg-blue-50 p-6 rounded-lg text-center">
                    <div className="text-3xl font-bold text-blue-600 mb-2">{fileAnalysis.columns.length}</div>
                    <div className="text-sm font-medium text-blue-800">Data Columns</div>
                  </div>
                  <div className="bg-green-50 p-6 rounded-lg text-center">
                    <div className="text-3xl font-bold text-green-600 mb-2">{Object.values(fieldMappings).filter(v => v).length}</div>
                    <div className="text-sm font-medium text-green-800">Mapped Fields</div>
                  </div>
                </div>

                {/* Sample Data Preview */}
                <div className="bg-gray-50 p-6 rounded-lg mb-8">
                  <h3 className="font-semibold text-gray-900 mb-4">Sample Data Preview:</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          {fileAnalysis.columns.slice(0, 6).map(col => (
                            <th key={col} className="px-3 py-2 text-left font-medium text-gray-700 border-b">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fileAnalysis.sampleData.map((row, idx) => (
                          <tr key={idx}>
                            {fileAnalysis.columns.slice(0, 6).map(col => (
                              <td key={col} className="px-3 py-2 text-gray-600 border-b">
                                {String(row[col] || '').substring(0, 30)}
                                {String(row[col] || '').length > 30 ? '...' : ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Field Mapping Interface */}
                <div className="space-y-6">
                  <h3 className="text-xl font-semibold text-gray-900">Map Certificate Fields</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      { key: 'name', label: 'Student Name', required: true, description: 'Full name of the student' },
                      { key: 'email', label: 'Email Address', required: false, description: 'Student email for verification' },
                      { key: 'course', label: 'Course/Program', required: false, description: 'Course or program name' },
                      { key: 'institution', label: 'Institution', required: false, description: 'School or institution name' },
                      { key: 'graduation_date', label: 'Graduation Date', required: false, description: 'Date of completion' },
                      { key: 'grade', label: 'Grade/Merit', required: false, description: 'Grade or merit level achieved' },
                      { key: 'percentage', label: 'Percentage/Score', required: false, description: 'Overall percentage or score' },
                      { key: 'student_id', label: 'Student ID', required: false, description: 'Unique student identifier' }
                    ].map(field => (
                      <div key={field.key} className="space-y-2">
                        <label className="block">
                          <span className="text-sm font-medium text-gray-700">
                            {field.label} {field.required && <span className="text-red-500">*</span>}
                          </span>
                          <p className="text-xs text-gray-500 mb-2">{field.description}</p>
                          <select
                            value={fieldMappings[field.key] || ''}
                            onChange={(e) => updateFieldMapping(field.key, e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          >
                            <option value="">-- Select Column --</option>
                            {fileAnalysis.columns.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>

                  {/* Suggested Mappings */}
                  {fileAnalysis.suggestedMappings && Object.keys(fileAnalysis.suggestedMappings).some(k => fileAnalysis.suggestedMappings[k]) && (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-blue-800 mb-2">💡 Suggested Mappings</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {Object.entries(fileAnalysis.suggestedMappings).filter(([, v]) => v).map(([field, column]) => (
                          <div key={field} className="flex items-center">
                            <span className="text-blue-600 font-medium">{field}</span>
                            <span className="mx-1 text-blue-400">→</span>
                            <span className="text-blue-700">{column}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Processing Errors */}
                  {processingErrors.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-yellow-800 mb-2">⚠️ Data Issues Found</h4>
                      <div className="text-xs text-yellow-700 space-y-1">
                        {processingErrors.slice(0, 5).map((error, idx) => (
                          <div key={idx}>Row {error.row}: {error.error}</div>
                        ))}
                        {processingErrors.length > 5 && (
                          <div>... and {processingErrors.length - 5} more issues</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-center space-x-4 mt-8">
                  <button
                    onClick={resetProcess}
                    className="border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Upload Different File
                  </button>
                  <button
                    onClick={processWithMappings}
                    disabled={!fieldMappings.name || isProcessing} // At least name is required
                    className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Processing...' : 'Process Data'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Field Mapping Step */}
          {currentStep === 'mapping' && fileAnalysis && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-8">
                <div className="text-center mb-8">
                  <div className="mx-auto h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-blue-600 text-2xl">🔗</span>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    Map Your Data Fields
                  </h2>
                  <p className="text-gray-600">
                    Connect your data columns to certificate fields. We've suggested mappings based on column names.
                  </p>
                </div>

                {/* File Analysis Summary */}
                <div className="bg-gray-50 p-6 rounded-lg mb-8">
                  <h3 className="font-semibold text-gray-900 mb-4">File Analysis Summary</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold text-blue-600 mb-1">{fileAnalysis.totalRows}</div>
                      <div className="text-sm text-gray-600">Total Rows</div>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold text-green-600 mb-1">{fileAnalysis.columns.length}</div>
                      <div className="text-sm text-gray-600">Columns Found</div>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <div className="text-2xl font-bold text-purple-600 mb-1">{Object.values(fieldMappings).filter(v => v).length}</div>
                      <div className="text-sm text-gray-600">Fields Mapped</div>
                    </div>
                  </div>
                </div>

                {/* Field Mapping Interface */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Map Certificate Fields</h3>

                  {[
                    { key: 'name', label: 'Student Name', required: true },
                    { key: 'email', label: 'Email Address', required: false },
                    { key: 'course', label: 'Course/Program', required: false },
                    { key: 'institution', label: 'Institution', required: false },
                    { key: 'graduation_date', label: 'Graduation Date', required: false },
                    { key: 'grade', label: 'Grade/Merit', required: false },
                    { key: 'percentage', label: 'Percentage/Score', required: false },
                    { key: 'student_id', label: 'Student ID', required: false }
                  ].map((field) => (
                    <div key={field.key} className="flex items-center space-x-4 p-4 border border-gray-200 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <label className="font-medium text-gray-900">{field.label}</label>
                          {field.required && (
                            <span className="text-red-500 text-sm">*</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">Field: {field.key}</p>
                      </div>
                      <div className="flex-1">
                        <select
                          value={fieldMappings[field.key] || ''}
                          onChange={(e) => updateFieldMapping(field.key, e.target.value || null)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Select Column --</option>
                          {fileAnalysis.columns.map((column) => (
                            <option key={column} value={column}>{column}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sample Data Preview */}
                {fileAnalysis.sampleData && fileAnalysis.sampleData.length > 0 && (
                  <div className="bg-gray-50 p-6 rounded-lg mt-8">
                    <h3 className="font-semibold text-gray-900 mb-4">Sample Data Preview</h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100">
                          <tr>
                            {fileAnalysis.columns.slice(0, 6).map((column) => (
                              <th key={column} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                {column}
                              </th>
                            ))}
                            {fileAnalysis.columns.length > 6 && (
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                ...{fileAnalysis.columns.length - 6} more
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {fileAnalysis.sampleData.slice(0, 3).map((row, index) => (
                            <tr key={index}>
                              {fileAnalysis.columns.slice(0, 6).map((column) => (
                                <td key={column} className="px-4 py-2 text-sm text-gray-900">
                                  {row[column] || '-'}
                                </td>
                              ))}
                              {fileAnalysis.columns.length > 6 && (
                                <td className="px-4 py-2 text-sm text-gray-500">...</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Processing Errors */}
                {processingErrors.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mt-6">
                    <h4 className="font-semibold text-yellow-800 mb-2">⚠️ Data Issues Found</h4>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {processingErrors.slice(0, 5).map((error, index) => (
                        <li key={index}>Row {error.row}: {error.error || error.errors?.join(', ')}</li>
                      ))}
                      {processingErrors.length > 5 && (
                        <li>...and {processingErrors.length - 5} more issues</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-center space-x-4 mt-8">
                  <button
                    onClick={resetProcess}
                    className="border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Upload Different File
                  </button>
                  <button
                    onClick={processWithMappings}
                    disabled={!fieldMappings.name || isProcessing}
                    className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Processing...' : 'Process Data'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Data Verification */}
          {currentStep === 'verify' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-8">
                <div className="text-center mb-8">
                  <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-green-600 text-2xl">✅</span>
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                    Data Verification Complete
                  </h2>
                  <p className="text-gray-600">
                    Successfully parsed {students.length} student records. All required data fields are present.
                  </p>
                </div>

                {/* Verification Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="bg-blue-50 p-6 rounded-lg text-center">
                    <div className="text-3xl font-bold text-blue-600 mb-2">{students.length}</div>
                    <div className="text-sm font-medium text-blue-800">Total Students</div>
                  </div>
                  <div className="bg-green-50 p-6 rounded-lg text-center">
                    <div className="text-3xl font-bold text-green-600 mb-2">100%</div>
                    <div className="text-sm font-medium text-green-800">Data Complete</div>
                  </div>
                  <div className="bg-purple-50 p-6 rounded-lg text-center">
                    <div className="text-3xl font-bold text-purple-600 mb-2">7</div>
                    <div className="text-sm font-medium text-purple-800">Required Fields</div>
                  </div>
                </div>

                {/* Sample Data Preview */}
                <div className="bg-gray-50 p-6 rounded-lg mb-8">
                  <h3 className="font-semibold text-gray-900 mb-4">Data Preview - First 3 Records:</h3>
                  <div className="space-y-3">
                    {students.slice(0, 3).map((student, index) => (
                      <div key={student.id} className="bg-white p-4 rounded-lg border">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-600">Name:</span>
                            <span className="ml-2 text-gray-900">{student.name}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Course:</span>
                            <span className="ml-2 text-gray-900">{student.course}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Grade:</span>
                            <span className="ml-2 text-green-600 font-semibold">{student.grade}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Validation Checklist */}
                <div className="bg-green-50 border border-green-200 p-6 rounded-lg mb-8">
                  <h3 className="font-semibold text-green-800 mb-4">✅ Validation Checklist</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center text-green-700">
                      <span className="text-green-600 mr-2">✓</span>
                      <span className="text-sm">All student names present</span>
                    </div>
                    <div className="flex items-center text-green-700">
                      <span className="text-green-600 mr-2">✓</span>
                      <span className="text-sm">Valid email addresses</span>
                    </div>
                    <div className="flex items-center text-green-700">
                      <span className="text-green-600 mr-2">✓</span>
                      <span className="text-sm">Course information complete</span>
                    </div>
                    <div className="flex items-center text-green-700">
                      <span className="text-green-600 mr-2">✓</span>
                      <span className="text-sm">Grade levels assigned</span>
                    </div>
                    <div className="flex items-center text-green-700">
                      <span className="text-green-600 mr-2">✓</span>
                      <span className="text-sm">Graduation dates valid</span>
                    </div>
                    <div className="flex items-center text-green-700">
                      <span className="text-green-600 mr-2">✓</span>
                      <span className="text-sm">Institution names present</span>
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <button
                    onClick={verifyStudentData}
                    className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors shadow-lg mr-4"
                  >
                    Proceed to Student Selection
                  </button>
                  <button
                    onClick={resetProcess}
                    className="border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Upload Different File
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Student Selection */}
          {currentStep === 'select' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm p-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-semibold text-gray-900">
                    Select Students ({students.length} found)
                  </h2>
                  <div className="space-x-2">
                    <button
                      onClick={selectAll}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm"
                    >
                      Select All
                    </button>
                    <button
                      onClick={deselectAll}
                      className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors text-sm"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Select
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Student Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Course
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Grade
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Percentage
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {students.map((student) => (
                        <tr key={student.id} className={selectedStudents.has(student.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={selectedStudents.has(student.id)}
                              onChange={() => toggleStudentSelection(student.id)}
                              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{student.name}</div>
                                <div className="text-sm text-gray-500">{student.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {student.course}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              {student.grade}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {student.percentage}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-center space-x-4">
                <button
                  onClick={resetProcess}
                  className="border-2 border-gray-300 text-gray-700 font-semibold px-8 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Upload Different File
                </button>
                <button
                  onClick={generateCertificates}
                  disabled={selectedStudents.size === 0}
                  className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Generate Certificates ({selectedStudents.size})
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Generating */}
          {currentStep === 'generate' && (
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Generating Certificates</h2>
                <p className="text-gray-600">
                  Creating blockchain-verified certificates for {selectedStudents.size} students...
                </p>
                <div className="mt-4 bg-gray-200 rounded-full h-2 max-w-xs mx-auto">
                  <div className="bg-primary-600 h-2 rounded-full transition-all duration-500" style={{ width: '60%' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Complete - Generated Certificates */}
          {currentStep === 'complete' && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-green-600 text-2xl">✅</span>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  Certificates Generated Successfully!
                </h2>
                <p className="text-gray-600 mb-6">
                  {generatedCertificates.length} certificates have been generated with Merkle tree structure.
                  Each certificate includes cryptographic proofs for blockchain verification.
                </p>

                {/* Enhanced Status Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600 mb-1">{generatedCertificates.length}</div>
                    <div className="text-xs font-medium text-blue-800">Certificates Generated</div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-600 mb-1">✓</div>
                    <div className="text-xs font-medium text-green-800">Merkle Tree Built</div>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600 mb-1">🔐</div>
                    <div className="text-xs font-medium text-purple-800">Cryptographic Proofs</div>
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600 mb-1">📋</div>
                    <div className="text-xs font-medium text-orange-800">Ready for Blockchain</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-center space-y-4 sm:space-y-0 sm:space-x-4">
                  <button
                    onClick={downloadAllCertificates}
                    className="bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    📄 Download All PDFs
                  </button>
                  <Link href="/issue">
                    <a className="bg-green-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-green-700 transition-colors text-center">
                      🚀 Deploy to Blockchain
                    </a>
                  </Link>
                  <button
                    onClick={resetProcess}
                    className="border-2 border-primary-600 text-primary-600 font-semibold px-6 py-3 rounded-lg hover:bg-primary-50 transition-colors"
                  >
                    🔄 Generate More
                  </button>
                </div>
              </div>

              {/* Blockchain Information */}
              <div className="bg-white rounded-xl shadow-sm p-8">
                <div className="text-center mb-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Blockchain Integration Ready</h3>
                  <p className="text-gray-600">Your certificates have been prepared with cryptographic proofs for secure blockchain deployment.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h4 className="font-semibold text-gray-900 mb-2">🌳 Merkle Tree Features</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Cryptographic verification for each certificate</li>
                      <li>• Privacy-preserving data structure</li>
                      <li>• Tamper-proof certificate validation</li>
                      <li>• Efficient batch processing</li>
                    </ul>
                  </div>
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h4 className="font-semibold text-gray-900 mb-2">🔗 Next Steps</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Download certificates as needed</li>
                      <li>• Deploy to blockchain for immutable storage</li>
                      <li>• Enable public verification</li>
                      <li>• Share verification links with recipients</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Certificate List */}
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-900">Generated Certificates</h3>
                </div>
                <div className="divide-y divide-gray-200">
                  {generatedCertificates.map((certificate) => (
                    <div key={certificate.id} className="p-8">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Certificate Preview */}
                        <div className="lg:col-span-2">
                          <div className="border-4 border-primary-600 rounded-lg p-6 bg-gradient-to-br from-white to-primary-50">
                            <div className="text-center mb-6">
                              <h1 className="text-2xl font-bold text-primary-800 mb-2">CERTIFICATE OF ACHIEVEMENT</h1>
                              <div className="h-1 w-24 bg-primary-600 mx-auto"></div>
                            </div>

                            <div className="text-center mb-4">
                              <h2 className="text-lg font-semibold text-gray-800 mb-2">
                                {certificate.institution}
                              </h2>
                              <p className="text-gray-600 mb-4">This is to certify that</p>
                              <h3 className="text-2xl font-bold text-gray-900 border-b-2 border-gray-300 pb-1 inline-block mb-4">
                                {certificate.name}
                              </h3>
                              <p className="text-gray-700 mb-2">has successfully completed the course of study in</p>
                              <h4 className="text-xl font-semibold text-primary-700 mb-4">{certificate.course}</h4>
                              <div className="bg-green-100 border border-green-300 rounded-lg p-3 inline-block">
                                <p className="text-green-800 font-semibold">🏆 {certificate.grade}</p>
                                <p className="text-green-700 text-sm">Overall Performance: {certificate.percentage}</p>
                              </div>
                            </div>

                            <div className="text-center text-xs text-gray-600 mt-4">
                              <p>Certificate ID: {certificate.certificateId}</p>
                              <p>Verification Code: {certificate.verificationCode}</p>
                            </div>
                          </div>
                        </div>

                        {/* Certificate Details & Actions */}
                        <div className="space-y-4">
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">Blockchain Verification</h4>
                            <div className="space-y-2 text-sm">
                              <div>
                                <p className="text-gray-600">Transaction Hash:</p>
                                <p className="font-mono text-xs text-gray-800 break-all">{certificate.transactionHash}</p>
                              </div>
                              <div>
                                <p className="text-gray-600">Block Number:</p>
                                <p className="font-mono text-xs">#{certificate.blockNumber}</p>
                              </div>
                              <div>
                                <p className="text-gray-600">Issue Date:</p>
                                <p className="text-gray-800">{certificate.issueDate}</p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <button
                              onClick={() => downloadCertificate(certificate)}
                              className="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors text-sm"
                            >
                              📄 Download PDF
                            </button>
                            <Link href="/verify">
                              <a className="block w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 transition-colors text-sm text-center">
                                🔍 Verify Certificate
                              </a>
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}