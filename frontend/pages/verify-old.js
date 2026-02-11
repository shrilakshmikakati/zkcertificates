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
    const [fieldMapping, setFieldMapping] = useState(null);
    const [processingIndividual, setProcessingIndividual] = useState({});

    const handleFileUpload = useCallback(async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsLoading(true);
        setError(null);
        setUploadProgress(0);

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
            const studentsWithHiddenGrades = processData.students.map(student => ({
                ...student,
                gradeHidden: true,
                originalGrade: student.grade,
                originalPercentage: student.percentage,
                grade: '***',
                percentage: '***'
            }));

            setStudents(studentsWithHiddenGrades);
            setFieldMapping(processData.fieldMapping);
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
                    certificateTitle: `Certificate of Completion - ${student.department || 'Course'}`,
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

    return (
        <Layout title="Student Data Verification - Certificate System">
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
                    {isLoading ? (
                        /* Loading State */
                        <div className="text-center">
                            <div className="bg-white rounded-xl shadow-sm p-12 max-w-2xl mx-auto">
                                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
                                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Loading Certificates</h2>
                                <p className="text-gray-600">
                                    Fetching verified student certificates...
                                </p>
                            </div>
                        </div>
                    ) : (
                        /* Student List */
                        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                            <div className="px-8 py-6 border-b border-gray-200 bg-gray-50">
                                <div className="flex justify-between items-center">
                                    <h2 className="text-2xl font-semibold text-gray-900">
                                        Student Data Summary ({students.length})
                                    </h2>
                                    <div className="text-sm text-gray-600">
                                        📊 From Uploaded CSV/Excel
                                    </div>
                                </div>
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden md:block">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Student ID
                                            </th>
                                            <th className="px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Student Name
                                            </th>
                                            <th className="px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Department
                                            </th>
                                            <th className="px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Grade & Performance
                                            </th>
                                            <th className="px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Status
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {students.map((student, index) => (
                                            <tr key={student.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                <td className="px-8 py-6 whitespace-nowrap">
                                                    <div className="text-sm font-mono font-bold text-primary-600">
                                                        {student.id}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6 whitespace-nowrap">
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
                                                <td className="px-8 py-6 whitespace-nowrap">
                                                    <div className="text-sm text-gray-900">
                                                        {student.department}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6 whitespace-nowrap">
                                                    {student.grade && student.percentage ? (
                                                        <div>
                                                            <div className="text-sm font-medium text-gray-900">
                                                                {student.grade}
                                                            </div>
                                                            <div className="text-sm text-green-600 font-semibold">
                                                                {student.percentage}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-gray-500">-</span>
                                                    )}
                                                </td>
                                                <td className="px-8 py-6 whitespace-nowrap">
                                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                        <span className="mr-1">✓</span>
                                                        {student.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Card View */}
                            <div className="md:hidden divide-y divide-gray-200">
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
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                        <span className="mr-1">✓</span>
                                                        {student.status}
                                                    </span>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-sm text-primary-600 font-mono font-bold">
                                                        ID: {student.id}
                                                    </p>
                                                    {student.email && (
                                                        <p className="text-sm text-gray-500">
                                                            {student.email}
                                                        </p>
                                                    )}
                                                    <p className="text-sm text-gray-900">
                                                        {student.department}
                                                    </p>
                                                    {student.grade && student.percentage && (
                                                        <div className="pt-2">
                                                            <p className="text-sm font-medium text-gray-800">
                                                                {student.grade}
                                                            </p>
                                                            <p className="text-sm text-green-600 font-semibold">
                                                                Performance: {student.percentage}
                                                            </p>
                                                        </div>
                                                    )}
                                                    <p className="text-sm text-gray-500">
                                                        Verified: {new Date(student.issueDate).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    {!isLoading && (
                        <div className="mt-8 text-center space-x-4">
                            <Link href="/generate-proof">
                                <a className="bg-primary-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors shadow-lg">
                                    🎓 Generate New Certificates
                                </a>
                            </Link>
                            <Link href="/issue">
                                <a className="border-2 border-primary-600 text-primary-600 font-semibold px-8 py-3 rounded-lg hover:bg-primary-50 transition-colors">
                                    📄 Issue Certificates
                                </a>
                            </Link>
                        </div>
                    )}
                </div>

                {/* Info Section */}
                <div className="bg-white border-t py-16">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="text-center mb-12">
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">Data Verification Process</h2>
                            <p className="text-gray-600">Comprehensive validation of student data from uploaded CSV/Excel files</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-blue-600 text-2xl">📊</span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-2">Data Validation</h3>
                                <p className="text-sm text-gray-600">All required fields are checked for completeness and validity</p>
                            </div>

                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-green-600 text-2xl">✅</span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-2">Quality Assurance</h3>
                                <p className="text-sm text-gray-600">Student records are verified for accuracy and consistency</p>
                            </div>

                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-purple-600 text-2xl">🎓</span>
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-2">Certificate Ready</h3>
                                <p className="text-sm text-gray-600">Verified data is ready for bulk certificate generation</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}