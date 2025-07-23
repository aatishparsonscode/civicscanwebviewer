'use client';
import Link from 'next/link';
import React from 'react';

export default function HomePage() {
  return (
    <>
      <div className="hero-container">
        <div className="content-wrapper">
          <h1 className="main-title">
            AI-Powered Pavement Intelligence
          </h1>
          
          <p className="subtitle">
            Automatically detect cracks, assess road roughness, and map infrastructure conditions — all in real time with cutting-edge computer vision technology.
          </p>
          
          <div className="cta-buttons">
            <Link href="/map" className="btn btn-primary">
              View Live Map
            </Link>
            <Link href="/about" className="btn btn-secondary">
              Learn More
            </Link>
          </div>

          <div className="features-preview">
            <div className="feature-card floating">
              <div className="feature-icon">🛣️</div>
              <h3 className="feature-title">Real-Time Detection</h3>
              <p className="feature-description">
                Advanced AI algorithms instantly identify and classify pavement defects as you drive.
              </p>
            </div>
            
            <div className="feature-card floating" style={{animationDelay: '0.5s'}}>
              <div className="feature-icon">📊</div>
              <h3 className="feature-title">Smart Analytics</h3>
              <p className="feature-description">
                Generate comprehensive reports and insights to prioritize maintenance and optimize budgets.
              </p>
            </div>
            
            <div className="feature-card floating" style={{animationDelay: '1s'}}>
              <div className="feature-icon">🗺️</div>
              <h3 className="feature-title">Interactive Mapping</h3>
              <p className="feature-description">
                Visualize road conditions across your entire network with detailed, actionable maps.
              </p>
            </div>
          </div>
          
          <div className="footer">
            © {new Date().getFullYear()} CivicScan. All rights reserved.
          </div>
        </div>
      </div>

      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
          line-height: 1.6;
          color: #ffffff;
          overflow-x: hidden;
          margin: 0;
          padding: 0;
        }

        .hero-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f0f23 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 6rem 1.5rem 2rem;
          position: relative;
        }

        .hero-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.1) 0%, transparent 50%),
                      radial-gradient(circle at 80% 20%, rgba(255, 206, 84, 0.05) 0%, transparent 50%);
          pointer-events: none;
        }

        .content-wrapper {
          position: relative;
          z-index: 1;
          text-align: center;
          max-width: 1200px;
          width: 100%;
        }

        .main-title {
          font-size: clamp(2.5rem, 8vw, 4.5rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 1.5rem;
          background: linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          animation: fadeInUp 1s ease-out;
        }

        .subtitle {
          font-size: clamp(1.1rem, 3vw, 1.5rem);
          color: #cbd5e1;
          max-width: 42rem;
          margin: 0 auto 3rem;
          line-height: 1.7;
          animation: fadeInUp 1s ease-out 0.2s both;
        }

        .cta-buttons {
          display: flex;
          gap: 1.5rem;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 4rem;
          animation: fadeInUp 1s ease-out 0.4s both;
        }

        .btn {
          padding: 1rem 2rem;
          border-radius: 12px;
          font-weight: 600;
          font-size: 1.1rem;
          text-decoration: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border: none;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          min-width: 140px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .btn-primary {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1a1a1a;
          box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(251, 191, 36, 0.4);
          background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
        }

        .btn-secondary {
          background: transparent;
          color: #ffffff;
          border: 2px solid rgba(255, 255, 255, 0.3);
          backdrop-filter: blur(10px);
        }

        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.5);
          transform: translateY(-2px);
        }

        .features-preview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 2rem;
          margin: 3rem 0;
          animation: fadeInUp 1s ease-out 0.6s both;
        }

        .feature-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 2rem;
          transition: all 0.3s ease;
        }

        .feature-card:hover {
          transform: translateY(-5px);
          background: rgba(255, 255, 255, 0.08);
        }

        .feature-icon {
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          font-size: 1.5rem;
        }

        .feature-title {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #ffffff;
        }

        .feature-description {
          color: #cbd5e1;
          font-size: 0.95rem;
          line-height: 1.6;
        }

        .footer {
          color: #64748b;
          font-size: 0.9rem;
          animation: fadeInUp 1s ease-out 0.8s both;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 640px) {
          .hero-container {
            padding: 1.5rem 1rem;
          }
          
          .cta-buttons {
            flex-direction: column;
            align-items: center;
          }
          
          .btn {
            width: 100%;
            max-width: 280px;
          }
          
          .features-preview {
            grid-template-columns: 1fr;
            gap: 1.5rem;
          }
        }

        .floating {
          animation: floating 6s ease-in-out infinite;
        }

        @keyframes floating {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </>
  );
}