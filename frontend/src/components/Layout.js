import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';

const navigation = [
  { name: 'Dashboard', href: '/' },
  { name: 'Generate Proof', href: '/generate-proof' },
  { name: 'Data Verification', href: '/verify' },
  { name: 'Issue Certificates', href: '/issue' },
  { name: 'Documentation', href: '/docs' }
];

export default function Layout({ children, title = 'ZK Certificate System' }) {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path) => router.pathname === path;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content="Privacy-preserving certificate verification using Zero-Knowledge Proofs" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-100">
        {/* Navigation */}
        <nav className="bg-white/80 glass border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <Link href="/">
                  <a className="flex items-center space-x-2">
                    <div className="h-8 w-8 bg-primary-600 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">ZK</span>
                    </div>
                    <span className="text-xl font-bold text-gray-900">ZK Certificates</span>
                  </a>
                </Link>
              </div>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center space-x-8">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                  >
                    <a className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive(item.href)
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-700 hover:text-primary-600 hover:bg-gray-100'
                      }`}>
                      {item.name}
                    </a>
                  </Link>
                ))}
              </div>

              {/* Mobile menu button */}
              <div className="md:hidden flex items-center">
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="text-gray-700 hover:text-primary-600 p-2"
                >
                  {mobileMenuOpen ? (
                    <span className="text-xl">×</span>
                  ) : (
                    <span className="text-xl">☰</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden bg-white border-t border-gray-200">
              <div className="px-2 pt-2 pb-3 space-y-1">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                  >
                    <a
                      className={`block px-3 py-2 rounded-md text-base font-medium transition-colors ${isActive(item.href)
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-700 hover:text-primary-600 hover:bg-gray-100'
                        }`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {item.name}
                    </a>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Main Content */}
        <main className="flex-1">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200">
          <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="col-span-1 md:col-span-2">
                <div className="flex items-center space-x-2 mb-4">
                  <div className="h-8 w-8 bg-primary-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-sm">ZK</span>
                  </div>
                  <span className="text-xl font-bold text-gray-900">Certificates</span>
                </div>
                <p className="text-gray-600 text-sm max-w-md">
                  Privacy-preserving bulk certificate generation and verification system using
                  Zero-Knowledge Proofs and blockchain technology.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Features</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>Bulk Certificate Issuance</li>
                  <li>Zero-Knowledge Verification</li>
                  <li>Blockchain Security</li>
                  <li>Privacy Preservation</li>
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Technology</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>Circom Circuits</li>
                  <li>Groth16 Proofs</li>
                  <li>Merkle Trees</li>
                  <li>Smart Contracts</li>
                </ul>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-gray-200">
              <p className="text-center text-sm text-gray-500">
                © 2026 Nitminer Technologies Pvt Ltd. Built with privacy and security in mind.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}