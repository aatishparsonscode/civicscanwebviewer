'use client';
import Link from 'next/link';
import React from 'react';

export default function AboutPage() {
  return (
    <>
      <div className="about-container">
        <div className="content-wrapper">
          <div className="hero-section">
            <h1 className="page-title">About CivicScan</h1>
            <p className="hero-subtitle">
              Revolutionizing road infrastructure assessment with AI-powered intelligence
            </p>
          </div>

          <div className="content-grid">
            <div className="main-content">
              <div className="content-section">
                <h2 className="section-title">Our Mission</h2>
                <p className="section-text">
                  CivicScan is an innovative platform dedicated to enhancing the efficiency and accuracy of road infrastructure assessment. 
                  Leveraging state-of-the-art computer vision and machine learning models, we automate the detection of pavement defects, 
                  providing precise location data and visual evidence for maintenance planning.
                </p>
              </div>

              <div className="content-section">
                <h2 className="section-title">How It Works</h2>
                <p className="section-text">
                  Our system processes video feeds and synchronized GPS/accelerometer data to generate detailed GeoJSON reports, 
                  enabling engineers and urban planners to make informed decisions about road repairs and upkeep. 
                  All you need is a smartphone to start collecting data.
                </p>
              </div>

              <div className="content-section">
                <h2 className="section-title">Key Features</h2>
                <div className="features-grid">
                  <div className="feature-item">
                    <div className="feature-icon">🔍</div>
                    <div className="feature-content">
                      <h3>Automated Detection</h3>
                      <p>Advanced AI identifies cracks, potholes, and surface defects with high accuracy</p>
                    </div>
                  </div>
                  
                  <div className="feature-item">
                    <div className="feature-icon">📍</div>
                    <div className="feature-content">
                      <h3>GPS Integration</h3>
                      <p>Precise geolocation mapping of every detected defect for accurate reporting</p>
                    </div>
                  </div>
                  
                  <div className="feature-item">
                    <div className="feature-icon">📊</div>
                    <div className="feature-content">
                      <h3>Comprehensive Reports</h3>
                      <p>Detailed analytics with image evidence and exportable GeoJSON data</p>
                    </div>
                  </div>
                  
                  <div className="feature-item">
                    <div className="feature-icon">☁️</div>
                    <div className="feature-content">
                      <h3>Cloud Processing</h3>
                      <p>Scalable infrastructure that handles large datasets efficiently</p>
                    </div>
                  </div>
                  
                  <div className="feature-item">
                    <div className="feature-icon">📏</div>
                    <div className="feature-content">
                      <h3>Distance-Based Analysis</h3>
                      <p>Consistent data points through intelligent frame extraction</p>
                    </div>
                  </div>
                  
                  <div className="feature-item">
                    <div className="feature-icon">🌍</div>
                    <div className="feature-content">
                      <h3>Global Impact</h3>
                      <p>Contributing to safer, more durable road networks worldwide</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="content-section">
                <h2 className="section-title">Our Vision</h2>
                <p className="section-text">
                  We envision a world where road maintenance is proactive rather than reactive, where infrastructure decisions 
                  are data-driven, and where communities have access to safer, more sustainable transportation networks. 
                  Through accessible technology and intelligent automation, we're making this vision a reality.
                </p>
              </div>

              <div className="cta-section">
                <Link href="/" className="btn-home">
                  Back to Home
                </Link>
                <Link href="/map" className="btn-primary">
                  Take a sneak peek
                </Link>
              </div>
            </div>
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
          background: #0f0f23;
        }

        .about-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f0f23 100%);
          position: relative;
        }

        .about-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(circle at 30% 20%, rgba(120, 119, 198, 0.08) 0%, transparent 50%),
                      radial-gradient(circle at 70% 80%, rgba(255, 206, 84, 0.06) 0%, transparent 50%);
          pointer-events: none;
        }

        .content-wrapper {
          position: relative;
          z-index: 1;
          max-width: 1200px;
          margin: 0 auto;
          padding: 6rem 2rem 4rem;
        }

        .hero-section {
          text-align: center;
          margin-bottom: 4rem;
          animation: fadeInUp 0.8s ease-out;
        }

        .page-title {
          font-size: clamp(2.5rem, 6vw, 3.5rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 1rem;
          background: linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }

        .hero-subtitle {
          font-size: clamp(1.1rem, 3vw, 1.4rem);
          color: #cbd5e1;
          max-width: 600px;
          margin: 0 auto;
          line-height: 1.6;
        }

        .content-grid {
          display: grid;
          gap: 2rem;
        }

        .main-content {
          animation: fadeInUp 0.8s ease-out 0.2s both;
        }

        .content-section {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 2.5rem;
          margin-bottom: 2rem;
          transition: all 0.3s ease;
        }

        .content-section:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-2px);
        }

        .section-title {
          font-size: 1.8rem;
          font-weight: 700;
          color: #fbbf24;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .section-text {
          font-size: 1.1rem;
          color: #e2e8f0;
          line-height: 1.8;
          margin-bottom: 1rem;
        }

        .section-text:last-child {
          margin-bottom: 0;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
          margin-top: 1.5rem;
        }

        .feature-item {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          transition: all 0.3s ease;
        }

        .feature-item:hover {
          background: rgba(255, 255, 255, 0.06);
          transform: translateY(-2px);
        }

        .feature-icon {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          flex-shrink: 0;
        }

        .feature-content h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: #ffffff;
          margin-bottom: 0.5rem;
        }

        .feature-content p {
          font-size: 0.95rem;
          color: #cbd5e1;
          line-height: 1.5;
        }

        .cta-section {
          display: flex;
          gap: 1.5rem;
          justify-content: center;
          flex-wrap: wrap;
          margin-top: 3rem;
          padding-top: 2rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .btn-home, .btn-primary {
          padding: 1rem 2rem;
          border-radius: 12px;
          font-weight: 600;
          font-size: 1rem;
          text-decoration: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 140px;
        }

        .btn-home {
          background: transparent;
          color: #ffffff;
          border: 2px solid rgba(255, 255, 255, 0.3);
          backdrop-filter: blur(10px);
        }

        .btn-home:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.5);
          transform: translateY(-2px);
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

        @media (max-width: 768px) {
          .content-wrapper {
            padding: 4rem 1rem 2rem;
          }
          
          .content-section {
            padding: 2rem;
          }
          
          .features-grid {
            grid-template-columns: 1fr;
          }
          
          .cta-section {
            flex-direction: column;
            align-items: center;
          }
          
          .btn-home, .btn-primary {
            width: 100%;
            max-width: 280px;
          }
        }

        @media (max-width: 480px) {
          .feature-item {
            flex-direction: column;
            text-align: center;
          }
          
          .feature-icon {
            align-self: center;
          }
        }
      `}</style>
    </>
  );
}