import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../src/components/Layout';
import { apiUrl } from '../src/lib/api';

export default function DataVerification() {
  const router = useRouter();
  const [dashboardStats, setDashboardStats] = useState(null);  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      const response = await fetch(apiUrl('/api/workflow/dashboard-stats'));
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setDashboardStats(data.data);
        } else {
          setError('Failed to load dashboard data');
        }
      } else {
        setError('Server error while fetching data');
      }
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
      setError('Network error while loading data');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshData = () => {
    setIsLoading(true);
    setError(null);
    fetchDashboardStats();
  };

  if (isLoading) {
    return (
      <Layout title="Data Verification - ZK Certificates">
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600">Loading verification data...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Data Verification - ZK Certificates">
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Error Loading Data</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <div className="space-x-4">
              <button
                onClick={refreshData}
                className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors"
              >
                Try Again
              </button>
              <Link href="/generate-proof">
                <a className="border border-primary-600 text-primary-600 px-6 py-3 rounded-lg hover:bg-primary-50 transition-colors inline-block">
                  Upload New File
                </a>
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!dashboardStats || dashboardStats.isEmpty) {
    return (
      <Layout title="Data Verification - ZK Certificates">
        <div className="min-h-screen bg-gray-50">
          {/* Header */}
          <div className="bg-white border-b">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
              <div className="text-center">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                  Data Verification
                </h1>
                <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                  No student data has been uploaded yet
                </p>
              </div>
            </div>
          </div>

          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="bg-white rounded-xl shadow-sm p-12 text-center">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">No Data Available</h2>
              <p className="text-gray-600 mb-8">
                Upload a CSV or Excel file with student data to start the verification process.
              </p>
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
    <Layout title="Data Verification - ZK Certificates">
      <div className="min-h-screen bg-gray-50">
        {/* Header with Dynamic Navigation */}
        <div className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center space-x-8">
                <Link href="/">
                  <a className="flex items-center space-x-3">
                   
                    <span className="text-xl font-bold text-gray-900">National Institute of Technology, Warangal</span>
                  </a>
                </Link>
                <nav className="hidden md:flex space-x-8">
                  <Link href="/">
                    <a className="text-gray-700 hover:text-primary-600 font-medium transition-colors">Dashboard</a>
                  </Link>
                  <Link href="/generate-proof">
                    <a className="text-gray-700 hover:text-primary-600 font-medium transition-colors">Generate Proof</a>
                  </Link>
                  <a href="#" className="text-primary-600 font-semibold border-b-2 border-primary-600">
                    Data Verification
                  </a>
                  <Link href="/issue">
                    <a className="text-gray-700 hover:text-primary-600 font-medium transition-colors">Issue Certificates</a>
                  </Link>
                  <Link href="/verify">
                    <a className="text-gray-700 hover:text-primary-600 font-medium transition-colors">Process & Map Data</a>
                  </Link>
                </nav>
              </div>
              <button
                onClick={refreshData}
                className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-blue-50 p-6 rounded-lg text-center border">
              <div className="text-4xl font-bold text-blue-600 mb-2">{dashboardStats.totalStudents}</div>
              <div className="text-sm font-medium text-blue-800">Total Students</div>
            </div>
            <div className="bg-green-50 p-6 rounded-lg text-center border">
              <div className="text-4xl font-bold text-green-600 mb-2">{dashboardStats.dataColumns}</div>
              <div className="text-sm font-medium text-green-800">Data Columns</div>
            </div>
            <div className="bg-purple-50 p-6 rounded-lg text-center border">
              <div className="text-4xl font-bold text-purple-600 mb-2">{dashboardStats.autoMappedFields}</div>
              <div className="text-sm font-medium text-purple-800">Auto-Mapped Fields</div>
            </div>
          </div>

          {/* Student Data Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                    Complete Student List ({dashboardStats.totalStudents} students)
                    {dashboardStats.isDemo && (
                      <span className="ml-3 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        DEMO DATA
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {dashboardStats.isDemo ? (
                      <>Sample data from: <strong>{dashboardStats.fileName}</strong> (Upload your own CSV to see your data)</>
                    ) : (
                      <>Data from: <strong>{dashboardStats.fileName}</strong></>
                    )}
                  </p>
                </div>
                <div className="text-sm text-gray-500">
                  Last updated: {new Date(dashboardStats.lastUpload).toLocaleDateString()}
                </div>
              </div>
            </div>
            
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
                    {dashboardStats.columns && dashboardStats.columns
                      .filter(col => !['Name', 'Student ID', 'Email', 'Math', 'Science', 'English', 'History', 'Art'].includes(col))
                      .slice(0, 3)
                      .map(col => (
                      <th key={col} className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(dashboardStats.allData && dashboardStats.allData.length > 0 
                    ? dashboardStats.allData 
                    : dashboardStats.sampleData || []
                  ).map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-500">
                        {idx + 1}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">
                        {row.Name || row.name || row.STUDENT_NAME || Object.values(row)[0] || ''}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {row['Student ID'] || row.student_id || row.Student_ID || row.Roll_No || row.ID || ''}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">
                        {row.Email || row.email || row.EMAIL || ''}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">
                        {row.Math || row.Science || row.percentage || row.Percentage || row.PERCENTAGE || row.score || row.Score || row.marks || row.Marks || row.total || row.Total || ''}
                      </td>
                      {dashboardStats.columns && dashboardStats.columns
                        .filter(col => !['Name', 'Student ID', 'Email', 'Math', 'Science', 'English', 'History', 'Art'].includes(col))
                        .slice(0, 3)
                        .map(col => (
                        <td key={col} className="px-6 py-3 text-sm text-gray-600">
                          {row[col] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <div>
                  Showing all {dashboardStats.allData ? dashboardStats.allData.length : (dashboardStats.sampleData || []).length} students • 
                  Essential columns: Name, Student ID, Email, Score/Percentage
                </div>
                <div className="flex space-x-3">
                  <Link href="/verify">
                    <a className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                      Process Data
                    </a>
                  </Link>
                  <Link href="/generate-proof">
                    <a className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
                      Upload New File
                    </a>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}