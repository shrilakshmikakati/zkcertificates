import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import Layout from '../src/components/Layout';

export default function VerifyCertificate() {
    const [students, setStudents] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasFile, setHasFile] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [error, setError] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [processingIndividual, setProcessingIndividual] = useState({});
    const [fileName, setFileName] = useState('');

    const handleFileUpload = useCallback(async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsLoading(true);
        setError(null);
        setUploadProgress(0);
        setFileName(file.name);

        try {
            const formData = new FormData();
            formData.append('file', file);

            // Step 1: Parse the file
            const parseResponse = await fetch('http://localhost:3001/api/workflow/parse', {
                method: 'POST',
                body: formData,
            });

            if (!parseResponse.ok) {
                throw new Error('Failed to parse file');
            }

            const parseData = await parseResponse.json();
            setUploadProgress(50);

            // Step 2: Process the file to get student data
            const processResponse = await fetch('http://localhost:3001/api/workflow/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: parseData.sessionId,
                    fieldMapping: parseData.suggestedMapping || parseData.analysis.suggestedMapping
                }),
            });

            if (!processResponse.ok) {
                throw new Error('Failed to process file data');
            }

            const processData = await processResponse.json();
            setUploadProgress(100);

            // Store student data but hide grades initially
            const studentsWithHiddenGrades = processData.students.map((student, index) => ({
                ...student,
                id: student.id || `ST${String(index + 1).padStart(3, '0')}`,
                gradeHidden: true,
                originalGrade: student.grade || 'N/A',
                originalPercentage: student.percentage || 'N/A',
                grade: '***',
                percentage: '***',
                status: 'Pending Verification'
            }));

            setStudents(studentsWithHiddenGrades);
            setSessionId(parseData.sessionId);
            setHasFile(true);

        } catch (error) {
            console.error('Upload error:', error);
            setError(error.message || 'Failed to upload and parse file');
        } finally {
            setIsLoading(false);
            setUploadProgress(0);
        }
    }, []);

    const handleVerifyData = useCallback(() => {
        // Reveal grades after verification
        const verifiedStudents = students.map(student => ({
            ...student,
            gradeHidden: false,
            grade: student.originalGrade,
            percentage: student.originalPercentage,
            status: 'Verified'
        }));

        setStudents(verifiedStudents);
        setIsVerified(true);
    }, [students]);

    const generateIndividualPDF = useCallback(async (student) => {
        if (!sessionId) return;

        setProcessingIndividual(prev => ({ ...prev, [student.id]: true }));
        setError(null);

        try {
            const response = await fetch('http://localhost:3001/api/workflow/generate-pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId,
                    students: [student], // Generate for single student
                    certificateTitle: `Certificate of Completion - ${student.department || student.course || 'Course'}`,
                    institutionName: 'University',
                    includeGrades: true
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to generate PDF certificate');
            }

            // Download the PDF
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `certificate_${student.name.replace(/\s+/g, '_')}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

        } catch (error) {
            console.error('PDF generation error:', error);
            setError(`Failed to generate certificate for ${student.name}: ${error.message}`);
        } finally {
            setProcessingIndividual(prev => ({ ...prev, [student.id]: false }));
        }
    }, [sessionId]);

    const resetUpload = () => {
        setStudents([]);
        setHasFile(false);
        setIsVerified(false);
        setSessionId(null);
        setError(null);
        setFileName('');
        setProcessingIndividual({});
    };

    return (
        <Layout title="Student Data Verification - ZK Certificate System">
            <div className="min-h-screen bg-gray-50">
                {/* Header */}
                <div className="bg-white border-b">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                        <div className="text-center">
                            <div className="mx-auto h-16 w-16 bg-primary-600 rounded-full flex items-center justify-center mb-6">
                                <span className="text-white text-2xl font-bold">✓</span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                                Student Data Verification
                            </h1>
                            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                                Upload and verify student data from CSV/Excel files. Grades are protected until verification is complete.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

                    {/* File Upload Section */}
                    {!hasFile && (
                        <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto text-center">
                            <div className="mx-auto h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                                <span className="text-blue-600 text-2xl">📄</span>
                            </div>
                            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Upload Student Data</h2>
                            <p className="text-gray-600 mb-8">
                                Upload a CSV or Excel file containing student information for verification and certificate generation.
                            </p>

                            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-primary-400 transition-colors">
                                <input
                                    type="file"
                                    id="file-upload"
                                    className="hidden"
                                    accept=".csv,.xlsx,.xls"
                                    onChange={handleFileUpload}
                                    disabled={isLoading}
                                />
                                <label
                                    htmlFor="file-upload"
                                    className={`cursor-pointer ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
                                >
                                    <div className="text-center">
                                        <div className="text-4xl mb-4">📊</div>
                                        <p className="text-lg font-medium text-gray-900 mb-2">
                                            {isLoading ? 'Processing...' : 'Choose your file'}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            CSV, Excel (.xlsx, .xls) up to 25MB
                                        </p>
                                    </div>
                                </label>
                            </div>

                            {isLoading && (
                                <div className="mt-6">
                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                                            style={{ width: `${uploadProgress}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-2">Processing {fileName}... {uploadProgress}%</p>
                                </div>
                            )}

                            {error && (
                                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Data Display */}
                    {hasFile && !isLoading && (
                        <>
                            {/* Verification Controls */}
                            <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-900 mb-2">
                                            Data Verification Status
                                        </h2>
                                        <p className="text-gray-600">
                                            {isVerified
                                                ? 'Data verified ✓ Grades are now visible and certificates can be generated.'
                                                : 'Data loaded. Grades are hidden for privacy. Click "Proceed" to verify and reveal grades.'
                                            }
                                        </p>
                                        <p className="text-sm text-gray-500 mt-1">
                                            File: {fileName} • {students.length} students found
                                        </p>
                                    </div>
                                    <div className="flex space-x-3">
                                        {!isVerified && (
                                            <button
                                                onClick={handleVerifyData}
                                                className="bg-green-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
                                            >
                                                🔍 Proceed
                                            </button>
                                        )}
                                        <button
                                            onClick={resetUpload}
                                            className="border border-gray-300 text-gray-700 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
                                        >
                                            Upload New File
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Student List */}
                            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                                <div className="px-8 py-6 border-b border-gray-200 bg-gray-50">
                                    <div className="flex justify-between items-center">
                                        <h2 className="text-2xl font-semibold text-gray-900">
                                            Student Data Summary ({students.length})
                                        </h2>
                                        <div className="text-sm text-gray-600">
                                            📊 From Uploaded File
                                        </div>
                                    </div>
                                </div>

                                {/* Desktop Table View */}
                                <div className="hidden lg:block">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Student ID
                                                </th>
                                                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Student Name
                                                </th>
                                                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Department
                                                </th>
                                                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Grade & Performance
                                                </th>
                                                <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Status
                                                </th>
                                                {isVerified && (
                                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Action
                                                    </th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {students.map((student, index) => (
                                                <tr key={student.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                    <td className="px-6 py-6 whitespace-nowrap">
                                                        <div className="text-sm font-mono font-bold text-primary-600">
                                                            {student.id}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-6 whitespace-nowrap">
                                                        <div className="flex items-center">
                                                            <div className="h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center mr-4">
                                                                <span className="text-sm font-bold text-gray-600">
                                                                    {student.name.charAt(0)}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-medium text-gray-900">
                                                                    {student.name}
                                                                </div>
                                                                {student.email && (
                                                                    <div className="text-xs text-gray-500">
                                                                        {student.email}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-6 whitespace-nowrap">
                                                        <div className="text-sm text-gray-900">
                                                            {student.department || student.course || 'N/A'}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-6 whitespace-nowrap">
                                                        <div>
                                                            <div className={`text-sm font-medium ${student.gradeHidden ? 'text-gray-400' : 'text-gray-900'}`}>
                                                                {student.grade}
                                                            </div>
                                                            <div className={`text-sm font-semibold ${student.gradeHidden ? 'text-gray-400' : 'text-green-600'}`}>
                                                                {student.percentage}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-6 whitespace-nowrap">
                                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${isVerified
                                                                ? 'bg-green-100 text-green-800'
                                                                : 'bg-yellow-100 text-yellow-800'
                                                            }`}>
                                                            <span className="mr-1">{isVerified ? '✓' : '⏳'}</span>
                                                            {student.status}
                                                        </span>
                                                    </td>
                                                    {isVerified && (
                                                        <td className="px-6 py-6 whitespace-nowrap">
                                                            <button
                                                                onClick={() => generateIndividualPDF(student)}
                                                                disabled={processingIndividual[student.id]}
                                                                className={`text-sm font-medium ${processingIndividual[student.id]
                                                                        ? 'text-gray-400 cursor-not-allowed'
                                                                        : 'text-primary-600 hover:text-primary-900'
                                                                    }`}
                                                            >
                                                                {processingIndividual[student.id] ? (
                                                                    <>
                                                                        <span className="inline-block animate-spin mr-1">⟳</span>
                                                                        Generating...
                                                                    </>
                                                                ) : (
                                                                    '📄 Generate PDF'
                                                                )}
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Card View */}
                                <div className="lg:hidden divide-y divide-gray-200">
                                    {students.map((student) => (
                                        <div key={student.id} className="p-6">
                                            <div className="flex items-start space-x-4">
                                                <div className="h-12 w-12 bg-gray-200 rounded-full flex items-center justify-center">
                                                    <span className="text-lg font-bold text-gray-600">
                                                        {student.name.charAt(0)}
                                                    </span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <h3 className="text-lg font-medium text-gray-900 truncate">
                                                            {student.name}
                                                        </h3>
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isVerified
                                                                ? 'bg-green-100 text-green-800'
                                                                : 'bg-yellow-100 text-yellow-800'
                                                            }`}>
                                                            <span className="mr-1">{isVerified ? '✓' : '⏳'}</span>
                                                            {student.status}
                                                        </span>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <p className="text-sm text-primary-600 font-mono font-bold">
                                                            ID: {student.id}
                                                        </p>
                                                        {student.email && (
                                                            <p className="text-sm text-gray-500">
                                                                {student.email}
                                                            </p>
                                                        )}
                                                        <p className="text-sm text-gray-900">
                                                            {student.department || student.course || 'N/A'}
                                                        </p>
                                                        <div className="pt-2">
                                                            <p className={`text-sm font-medium ${student.gradeHidden ? 'text-gray-400' : 'text-gray-800'}`}>
                                                                {student.grade}
                                                            </p>
                                                            <p className={`text-sm font-semibold ${student.gradeHidden ? 'text-gray-400' : 'text-green-600'}`}>
                                                                Performance: {student.percentage}
                                                            </p>
                                                        </div>
                                                        {isVerified && (
                                                            <div className="pt-3">
                                                                <button
                                                                    onClick={() => generateIndividualPDF(student)}
                                                                    disabled={processingIndividual[student.id]}
                                                                    className={`text-sm font-medium px-4 py-2 rounded-md ${processingIndividual[student.id]
                                                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                            : 'bg-primary-600 text-white hover:bg-primary-700'
                                                                        }`}
                                                                >
                                                                    {processingIndividual[student.id] ? (
                                                                        <>
                                                                            <span className="inline-block animate-spin mr-1">⟳</span>
                                                                            Generating...
                                                                        </>
                                                                    ) : (
                                                                        '📄 Generate PDF'
                                                                    )}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Error Display */}
                            {error && (
                                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Info Section */}
                <div className="bg-white border-t py-16">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="text-center mb-12">
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">Data Verification Process</h2>
                            <p className="text-gray-600">Comprehensive validation of student data with privacy protection</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-blue-600 text-2xl">📊</span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-2">Data Upload</h3>
                                <p className="text-sm text-gray-600">Upload CSV or Excel files with student information from any format</p>
                            </div>

                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-yellow-600 text-2xl">🔒</span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-2">Protected Verification</h3>
                                <p className="text-sm text-gray-600">Grades are hidden during initial review for privacy protection</p>
                            </div>

                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-green-600 text-2xl">🎓</span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-2">Individual Certificates</h3>
                                <p className="text-sm text-gray-600">Generate PDF certificates individually for each student</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}