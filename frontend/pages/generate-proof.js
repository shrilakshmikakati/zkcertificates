import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../src/components/Layout';
import { apiUrl } from '../src/lib/api';

export default function GenerateProof() {
  const router = useRouter();
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [fieldSuggestions, setFieldSuggestions] = useState([]);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      const response = await fetch(apiUrl('/api/workflow/dashboard-stats'));
      if (response.ok) {
        const data = await response.json();
        if (data.success && !data.data.isEmpty) {
          setDashboardStats(data.data);
          // Generate field suggestions from actual uploaded data
          if (data.data.columns) {
            setFieldSuggestions(data.data.columns);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    }
  };

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

      const response = await fetch(apiUrl('/api/workflow/parse'), {
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

      // Clear old fileAnalysisData
      localStorage.removeItem('fileAnalysisData');

      // Store new file analysis data
      localStorage.setItem('fileAnalysisData', JSON.stringify({
        sessionId: data.sessionId,
        fileName: file.name,
        fileAnalysis: data,
        uploadedAt: new Date().toISOString()
      }));

      // Redirect to verify page
      router.push('/verify');

    } catch (error) {
      console.error('Error parsing file:', error);
      alert(`Error parsing file: ${error.message}`);
      setIsProcessing(false);
    }
  };

  return (
    <Layout title="Upload Student Data - ZK Certificate System">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Upload Student Data
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Upload Excel/CSV file with student data to begin certificate generation process
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* File Upload Section */}
          {!isProcessing ? (
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <h2 className="text-2xl font-semibold text-gray-900 mb-8">Upload Student Data File</h2>

                <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 hover:border-primary-500 transition-colors">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Select CSV or Excel File
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Upload a file containing student data. After processing, you'll be redirected to verify all student records.
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
                  {fieldSuggestions.length > 0 ? (
                    <>
                      <h4 className="font-semibold text-blue-800 mb-2">Detected from Previous Uploads:</h4>
                      <ul className="text-sm text-blue-700 space-y-1">
                        {fieldSuggestions.map((field, index) => (
                          <li key={index}>• <strong>{field}</strong></li>
                        ))}
                      </ul>
                      <p className="text-xs text-blue-600 mt-2">
                        Your file can have different column names. Smart mapping will automatically detect the best matches.
                      </p>
                    </>
                  ) : (
                    <>
                      <h4 className="font-semibold text-blue-800 mb-2">Expected CSV/Excel Columns:</h4>
                      <ul className="text-sm text-blue-700 space-y-1">
                        <li>• <strong>name</strong> - Student full name (Required)</li>
                        <li>• <strong>student_id</strong> - Student ID or roll number (Recommended)</li>
                        <li>• <strong>email</strong> - Student email address (Recommended)</li>
                        <li>• <strong>percentage</strong> - Score in percentage(Recommended)</li>
                      </ul>
                      <p className="text-xs text-blue-600 mt-2">
                        After upload, you'll verify all student data before proceeding to certificate generation.
                      </p>
                    </>
                  )}
                  {dashboardStats && !dashboardStats.isEmpty && (
                    <div className="mt-4 pt-2 border-t border-blue-200">
                      {dashboardStats.isDemo ? (
                        <p className="text-xs text-yellow-700 bg-yellow-50 p-2 rounded border border-yellow-200">
                          <strong>Currently showing demo data:</strong> {dashboardStats.totalStudents} students from "{dashboardStats.fileName}"
                          <br />Upload your own CSV file below to replace this with your actual data
                        </p>
                      ) : (
                        <p className="text-xs text-blue-600">
                          <strong>Current Data:</strong> {dashboardStats.totalStudents} students with {dashboardStats.dataColumns} columns from "{dashboardStats.fileName}"
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Processing Step */
            <div className="text-center">
              <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Processing File</h2>
                <p className="text-gray-600">
                  Analyzing file structure and preparing student data...
                </p>
                <p className="text-sm text-gray-500 mt-4">
                  You'll be redirected to verification page once processing is complete
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
