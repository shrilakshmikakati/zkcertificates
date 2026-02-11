import React from 'react';
import Link from 'next/link';
import Layout from '../src/components/Layout';

export default function Home() {
  return (
    <Layout title="Certificate System - Privacy-Preserving Digital Certificates">
      <div className="min-h-screen">
        {/* Hero Section */}
        <div className="bg-gradient-to-br from-primary-50 to-primary-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
            <div className="text-center">
              <div className="mx-auto h-24 w-24 bg-primary-600 rounded-full flex items-center justify-center mb-8">
                <span className="text-white text-4xl font-bold">ZK</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
                Privacy-Preserving <br />
                <span className="text-primary-600">Digital Certificates</span>
              </h1>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-12">
                Generate PDF certificates from CSV/Excel data with dynamic field mapping.
                Complete workflow for privacy-preserving digital certificate management.
              </p>

              <div className="flex flex-col sm:flex-row gap-6 justify-center">
                <Link href="/generate-proof">
                  <a className="inline-flex items-center justify-center px-8 py-4 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors shadow-lg">
                    Generate Certificates →
                  </a>
                </Link>
                <Link href="/verify">
                  <a className="inline-flex items-center justify-center px-8 py-4 bg-white text-primary-600 font-semibold rounded-lg border-2 border-primary-600 hover:bg-primary-50 transition-colors shadow-lg">
                    Verify Certificate
                  </a>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div className="bg-white py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                How It Works
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                A complete workflow: collect data, verify mappings, generate certificates, deploy to blockchain
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="mx-auto h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                  <span className="text-2xl font-bold text-blue-600">1</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Collect Data</h3>
                <p className="text-gray-600">
                  Upload CSV or Excel files with student information. Dynamic column mapping supported.
                </p>
              </div>

              <div className="text-center">
                <div className="mx-auto h-16 w-16 bg-purple-100 rounded-full flex items-center justify-center mb-6">
                  <span className="text-2xl font-bold text-purple-600">2</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Verify & Map</h3>
                <p className="text-gray-600">
                  Review data structure and map your columns to certificate fields dynamically.
                </p>
              </div>

              <div className="text-center">
                <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
                  <span className="text-2xl font-bold text-green-600">3</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Generate PDFs</h3>
                <p className="text-gray-600">
                  Create professional PDF certificates with Merkle tree integration for verification.
                </p>
              </div>

              <div className="text-center">
                <div className="mx-auto h-16 w-16 bg-yellow-100 rounded-full flex items-center justify-center mb-6">
                  <span className="text-2xl font-bold text-yellow-600">4</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Deploy Blockchain</h3>
                <p className="text-gray-600">
                  Optional: Deploy to blockchain with Zero-Knowledge Proofs for immutable verification.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Key Benefits */}
        <div className="bg-gray-50 py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Why Choose ZK Certificates?
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div className="bg-white p-8 rounded-xl shadow-sm">
                <div className="flex items-center mb-4">
                  <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center mr-3">
                    <span className="text-green-600 font-bold">✓</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">Complete Privacy</h3>
                </div>
                <p className="text-gray-600">
                  Student grades and personal information never stored on-chain.
                  Zero-Knowledge Proofs ensure privacy while enabling verification.
                </p>
              </div>

              <div className="bg-white p-8 rounded-xl shadow-sm">
                <div className="flex items-center mb-4">
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                    <span className="text-blue-600 font-bold">⚡</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">Dynamic & Flexible</h3>
                </div>
                <p className="text-gray-600">
                  Works with any CSV or Excel format. Smart field mapping automatically detects your data structure.
                  No need to restructure your existing data files.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-primary-600 py-16">
          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-primary-100 mb-8 max-w-2xl mx-auto">
              Start with certificate generation, then optionally deploy to blockchain for immutable verification.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/generate-proof">
                <a className="bg-white text-primary-600 hover:bg-gray-100 font-semibold px-8 py-3 rounded-lg transition-colors">
                  Start Generating Certificates
                </a>
              </Link>
              <Link href="/issue">
                <a className="bg-yellow-500 text-white hover:bg-yellow-600 font-semibold px-8 py-3 rounded-lg transition-colors">
                  Deploy to Blockchain
                </a>
              </Link>
              <Link href="/verify">
                <a className="border-2 border-white text-white hover:bg-white hover:text-primary-600 font-semibold px-8 py-3 rounded-lg transition-colors">
                  Verify Certificates
                </a>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}