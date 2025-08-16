'use client';
import Link from 'next/link';
import React, { useState, useEffect } from 'react';

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
        <div className="nav-container">
          <Link href="/" className="nav-logo" style={{ color: '#ffffff', textDecoration: 'none', fontSize:20 }}>
            CivicScan
            <span className="beta-label">beta</span>
          </Link>
          
          <div className="nav-links desktop-only">
            <Link href="/" className="nav-link" style={{ color: '#ffffff', textDecoration: 'none', fontSize:20 }}>
              Home
            </Link>
            <Link href="/map" className="nav-link" style={{ color: '#ffffff', textDecoration: 'none', fontSize:20 }}>
              Live Map
            </Link>
            <Link href="/waitlist" className="nav-link " style={{ color: '#ffffff', textDecoration: 'none', fontSize:20 }}>
              Join Waitlist
            </Link>
          </div>

          <button 
            className="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <span className={`hamburger-line ${isMobileMenuOpen ? 'open' : ''}`}></span>
            <span className={`hamburger-line ${isMobileMenuOpen ? 'open' : ''}`}></span>
            <span className={`hamburger-line ${isMobileMenuOpen ? 'open' : ''}`}></span>
          </button>
        </div>

        <div className={`mobile-menu ${isMobileMenuOpen ? 'open' : ''}`}>
          <Link href="/" className="mobile-nav-link" onClick={() => setIsMobileMenuOpen(false)} style={{ color: '#ffffff', textDecoration: 'none' }}>
            Home
          </Link>
          <Link href="/map" className="mobile-nav-link" onClick={() => setIsMobileMenuOpen(false)} style={{ color: '#ffffff', textDecoration: 'none' }}>
            Live Map
          </Link>
          <Link href="/about" className="mobile-nav-link" onClick={() => setIsMobileMenuOpen(false)} style={{ color: '#ffffff', textDecoration: 'none' }}>
            About
          </Link>
          <Link href="/waitlist" className="mobile-nav-link mobile-cta" onClick={() => setIsMobileMenuOpen(false)} style={{ color: '#ffffff', textDecoration: 'none'  }}>
            Join Waitlist
          </Link>
        </div>
      </nav>

      <style jsx>{`
        .navbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          background: rgba(26, 26, 46, 0.8);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          padding: 0.75rem 0;
        }

        .navbar.scrolled {
          background: rgba(15, 15, 35, 0.95);
          backdrop-filter: blur(25px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .nav-container {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 1.5rem;
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.5rem;
          font-weight: 700;
          color: #ffffff;
          text-decoration: none;
          transition: all 0.3s ease;
          position: relative;
        }

        .nav-logo:hover {
          color: #fbbf24;
          transform: translateY(-1px);
        }

        .beta-label {
          font-style: italic;
          font-size: 0.7rem;
          font-weight: 400;
          color: #94a3b8;
          margin-left: 0.3rem;
          position: relative;
          top: -0.5rem;
          opacity: 0.8;
        }

        .logo-icon {
          font-size: 1.8rem;
          filter: drop-shadow(0 2px 4px rgba(251, 191, 36, 0.3));
        }

        .nav-links {
          display: flex;
          align-items: center;
          gap: 2rem;
        }

        .nav-link {
          font-weight: 600;
          font-size: 1.1rem;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          transition: all 0.3s ease;
          position: relative;
        }

        .nav-link,
        .nav-link:link,
        .nav-link:visited,
        .nav-link:active {
          color: #ffffff !important;
          text-decoration: none !important;
        }

        .nav-link:hover {
          color: #fbbf24 !important;
          background: rgba(255, 255, 255, 0.1);
          transform: translateY(-1px);
        }

        .nav-link::after {
          content: '';
          position: absolute;
          bottom: -2px;
          left: 50%;
          width: 0;
          height: 2px;
          background: linear-gradient(135deg, #fbbf24, #f59e0b);
          transition: all 0.3s ease;
          transform: translateX(-50%);
        }

        .nav-link:hover::after {
          width: 80%;
        }

        .nav-cta {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1a1a1a !important;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(251, 191, 36, 0.3);
          padding: 0.75rem 1.5rem !important;
        }

        .nav-cta:hover {
          background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
          box-shadow: 0 6px 16px rgba(251, 191, 36, 0.4);
          transform: translateY(-2px);
          color: #1a1a1a !important;
        }

        .nav-cta::after {
          display: none;
        }

        .desktop-only {
          display: flex;
        }

        .mobile-menu-toggle {
          display: none;
          flex-direction: column;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0.5rem;
          gap: 4px;
        }

        .hamburger-line {
          width: 24px;
          height: 2px;
          background: #ffffff;
          transition: all 0.3s ease;
          border-radius: 2px;
        }

        .hamburger-line.open:nth-child(1) {
          transform: rotate(45deg) translate(6px, 6px);
        }

        .hamburger-line.open:nth-child(2) {
          opacity: 0;
        }

        .hamburger-line.open:nth-child(3) {
          transform: rotate(-45deg) translate(6px, -6px);
        }

        .mobile-menu {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: rgba(15, 15, 35, 0.98);
          backdrop-filter: blur(25px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 1rem 0;
          display: none;
          flex-direction: column;
          gap: 0.5rem;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .mobile-menu.open {
          display: flex;
        }

        .mobile-nav-link {
          padding: 1rem 1.5rem;
          font-weight: 600;
          font-size: 1.1rem;
          transition: all 0.3s ease;
          border-left: 3px solid transparent;
        }

        .mobile-nav-link,
        .mobile-nav-link:link,
        .mobile-nav-link:visited,
        .mobile-nav-link:active {
          color: #ffffff !important;
          text-decoration: none !important;
        }

        .mobile-nav-link:hover {
          color: #fbbf24 !important;
          background: rgba(255, 255, 255, 0.05);
          border-left-color: #fbbf24;
        }

        .mobile-cta {
          margin: 0.5rem 1.5rem;
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1a1a1a !important;
          border-radius: 8px;
          font-weight: 600;
          text-align: center;
          border-left: none !important;
        }

        .mobile-cta:hover {
          background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
          color: #1a1a1a !important;
        }

        @media (max-width: 768px) {
          .desktop-only {
            display: none;
          }

          .mobile-menu-toggle {
            display: flex;
          }

          .nav-container {
            padding: 0 1rem;
          }

          .nav-logo {
            font-size: 1.3rem;
          }

          .logo-icon {
            font-size: 1.5rem;
          }

          .beta-label {
            font-size: 0.6rem;
            top: -0.4rem;
          }
        }
      `}</style>
    </>
  );
}