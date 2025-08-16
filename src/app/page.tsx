'use client';
import Link from 'next/link';
import React, { useEffect } from 'react';
import Image from 'next/image';

export default function HomePage() {
  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    const animatedElements = document.querySelectorAll('.scroll-animate');
    animatedElements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="hero-container">
        <div className="content-wrapper">
          <h1 className="main-title">
            AI-Powered Pavement Intelligence
          </h1>

          <p className="subtitle">
            Automatically detect cracks, assess road roughness, and visualize road conditions — quicker and cheaper than ever.
          </p>

          <p className="subtitle-phone">
            All you need is <strong>a phone.</strong>
          </p>

          <div className="cta-buttons">
            <Link href="/map" className="btn btn-primary">
              View Live Map
            </Link>
            <Link href="/waitlist" className="btn btn-waitlist">
              Join Waitlist
            </Link>
          </div>

          <div className="features-preview">
            <div className="feature-card scroll-animate feature-card-1">
              <div className="feature-icon">🛣️</div>
              <h3 className="feature-title">Scalable Detection</h3>
              <p className="feature-description">
                Advanced AI algorithms identify and classify pavement defects as you drive with high accuracy.
              </p>
            </div>

            <div className="feature-card scroll-animate feature-card-2">
              <div className="feature-icon">📊</div>
              <h3 className="feature-title">Smart Analytics</h3>
              <p className="feature-description">
                Generate and export comprehensive reports and insights to prioritize maintenance, apply for grants, and optimize budgets.
              </p>
            </div>

            <div className="feature-card scroll-animate feature-card-3">
              <div className="feature-icon">🗺️</div>
              <h3 className="feature-title">Interactive Mapping</h3>
              <p className="feature-description">
                Visualize road conditions across your entire network with detailed, actionable maps.
              </p>
            </div>
          </div>

          <div className="scroll-encouragement">
            <p className="scroll-text">Discover how our AI technology works</p>
            <div className="scroll-indicator">
              <div className="scroll-arrow">↓</div>
            </div>
          </div>
        </div>
      </div>

      <div className="ai-detection-container">
        <div className="content-wrapper">
          <div className="ai-preview-section">
            <div className="section-header scroll-animate">
              <h3 className="section-title">See AI Detection in Action</h3>
              <p className="section-description">
                Our advanced machine learning models automatically identify and highlight pavement defects in real-time as you drive.
              </p>
            </div>

            <div className="detection-showcase">
              <div className="detection-content">
                <div className="detection-example scroll-animate">
                  <div className="detection-image-container scroll-animate">
                    <Image
                      src="/assets/crack_preview.png"
                      alt="AI crack detection highlighting pavement defects"
                      width={400}
                      height={280}
                      sizes="(max-width: 768px) 100vw, 400px"
                      className="detection-image"
                      priority
                    />
                    <div className="image-overlay">
                      <span className="ai-badge">AI Detected</span>
                    </div>
                  </div>
                  <div className="detection-info scroll-animate">
                    <div className="point-content">
                      <h4>Precise Crack Detection</h4>
                      <p>Advanced computer vision models identify crack patterns, measure severity, and classify defect types for targeted crack sealing and preventive maintenance.</p>
                    </div>
                  </div>
                </div>

                <div className="detection-example scroll-animate">
                  <div className="detection-image-container scroll-animate">
                    <Image
                      src="/assets/crack_preview_2.png"
                      alt="AI crack detection highlighting multiple pavement defects"
                      width={400}
                      height={280}
                      sizes="(max-width: 768px) 100vw, 400px"
                      className="detection-image"
                      priority
                    />
                    <div className="image-overlay">
                      <span className="ai-badge">AI Detected</span>
                    </div>
                  </div>
                  <div className="detection-info scroll-animate">
                    <div className="point-content">
                      <h4>Deterioration Monitoring</h4>
                      <p>Track pavement condition changes over time to prioritize resurfacing, overlay projects, and budget allocation for maximum infrastructure longevity.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="redmond-container">
        <div className="content-wrapper">
          <div className="map-preview-container scroll-animate">
            <div className="map-section-header">
              <h3 className="map-section-title">See Our Detections in Redmond</h3>
              <p className="map-section-description">
                View detected defects across your entire road network with our comprehensive mapping interface.
              </p>
            </div>
            <Link href="/map" className="map-preview-link">
              <div className="map-preview-wrapper">
                <Image
                  src="/assets/map_preview.png"
                  alt="Interactive map showing pavement defects - Click to explore live map"
                  width={800}
                  height={450}
                  sizes="(max-width: 768px) 100vw, 800px"
                  className="map-preview-image"
                  priority
                />
                <div className="map-overlay">
                  <div className="play-button">
                    <span className="play-icon">▶</span>
                  </div>
                  <span className="map-badge">Click to Explore Live Map</span>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>

      <div className="footer">
        © {new Date().getFullYear()} CivicScan. All rights reserved.
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

        .ai-detection-container {
          background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
          padding: 6rem 1.5rem 4rem;
          position: relative;
        }

        .ai-detection-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(circle at 80% 20%, rgba(120, 119, 198, 0.08) 0%, transparent 50%),
                      radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.05) 0%, transparent 50%);
          pointer-events: none;
        }

        .redmond-container {
          background: linear-gradient(135deg, #2a2a3e 0%, #1e1e2d 100%);
          padding: 6rem 1.5rem;
        }

        .content-wrapper {
          position: relative;
          z-index: 1;
          max-width: 1200px;
          width: 100%;
          margin: 0 auto;
          text-align: center;
        }

        .ai-detection-container .content-wrapper {
            text-align: left;
        }

        .main-title {
          font-size: 3.5rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 1.5rem;
          background: linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subtitle {
          font-size: 1.25rem;
          color: #cbd5e1;
          max-width: 42rem;
          margin: 0 auto 1rem;
          line-height: 1.7;
        }

        .subtitle-phone {
          font-size: 1.25rem;
          color: #cbd5e1;
          max-width: 42rem;
          margin: 0 auto 3rem;
          line-height: 1.7;
        }

        .subtitle-phone strong {
          color: #fbbf24;
          font-weight: 700;
        }

        .cta-buttons {
          display: flex;
          gap: 1.5rem;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 4rem;
          opacity: 0;
          transform: translateY(20px);
          animation: fadeInSlideUp 1s ease-out 1s forwards;
        }

        @keyframes fadeInSlideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
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
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          color: #ffffff;
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(59, 130, 246, 0.4);
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
        }

        .btn-waitlist {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1a1a1a;
          box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3);
          position: relative;
          overflow: hidden;
        }

        .btn-waitlist::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            45deg,
            transparent 30%,
            rgba(255, 255, 255, 0.6) 50%,
            transparent 70%
          );
          transform: rotate(45deg);
          animation: shine 2.5s infinite;
          pointer-events: none;
        }

        .btn-waitlist:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(251, 191, 36, 0.4);
          background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
        }

        .scroll-encouragement {
          margin-top: 4rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          opacity: 0;
          transform: translateY(20px);
          animation: fadeInSlideUp 2s ease-out 2s forwards;
        }

        .scroll-text {
          color: #ffffff;
          font-size: 1.1rem;
          font-weight: 500;
          margin-bottom: 1rem;
        }

        .scroll-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .scroll-arrow {
          font-size: 2.5rem;
          color: #fbbf24;
          animation: bounce 2s infinite;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .scroll-arrow:hover {
          color: #fcd34d;
          transform: scale(1.1);
        }

        .ai-preview-section {
          margin: 0 0 4rem 0;
        }

        .section-header {
          text-align: left;
          margin-right: auto;
          margin-bottom: 3rem;
        }

        .section-title {
          font-size: 2.5rem;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 1rem;
          background: linear-gradient(135deg, #ffffff 0%, #fbbf24 100%);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .section-description {
          font-size: 1.2rem;
          color: #cbd5e1;
          line-height: 1.6;
          max-width: 600px;
          margin: 0;
        }

        .detection-showcase {
          max-width: 1100px;
          margin: 0 auto 4rem auto;
        }

        .detection-content {
          display: flex;
          flex-direction: column;
          gap: 4rem;
        }

        .detection-example {
          display: flex;
          align-items: center;
          gap: 3rem;
          justify-content: flex-start;
        }

        .detection-image-container {
          max-width: 400px;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
          transition: all 0.3s ease;
          border: 2px solid rgba(251, 191, 36, 0.3);
        }

        .detection-image-container:hover {
          transform: scale(1.05);
          box-shadow: 0 16px 50px rgba(0, 0, 0, 0.5);
        }

        .detection-image {
          width: 100%;
          height: auto;
          display: block;
        }

        .detection-info {
          flex: 1;
          display: flex;
          gap: 1.5rem;
          align-items: center;
          justify-content: flex-start;
          max-width: 500px;
        }

        .point-content {
          flex: 1;
          max-width: 400px;
          text-align: left;
        }

        .point-content h4 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 0.75rem;
          line-height: 1.3;
        }

        .point-content p {
          color: #cbd5e1;
          font-size: 1.1rem;
          line-height: 1.7;
        }

        .image-overlay {
          position: absolute;
          top: 12px;
          right: 12px;
        }

        .ai-badge {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: #ffffff;
          padding: 0.6rem 1.2rem;
          border-radius: 25px;
          font-size: 0.9rem;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
          animation: pulse 2s infinite;
        }

        .map-preview-container {
          margin-bottom: 3rem;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          width: 100%;
        }

        .map-section-header {
          text-align: right;
          margin-left: auto;
          margin-bottom: 2rem;
          max-width: 600px;
        }

        .map-section-title {
          font-size: 2rem;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 1rem;
          background: linear-gradient(135deg, #ffffff 0%, #3b82f6 100%);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .map-section-description {
          font-size: 1.1rem;
          color: #cbd5e1;
          line-height: 1.6;
          max-width: 600px;
          margin: 0;
        }

        .map-preview-link {
          display: block;
          width: 100%;
          max-width: 800px;
          text-decoration: none;
          transition: all 0.3s ease;
        }

        .map-preview-link:hover {
          transform: translateY(-5px);
        }

        .map-preview-wrapper {
          max-width: 800px;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
          border: 2px solid rgba(59, 130, 246, 0.3);
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .map-preview-wrapper:hover {
          border-color: rgba(59, 130, 246, 0.6);
          box-shadow: 0 25px 70px rgba(0, 0, 0, 0.5);
        }

        .map-preview-image {
          width: 100%;
          height: auto;
          display: block;
        }

        .map-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: all 0.3s ease;
        }

        .map-preview-wrapper:hover .map-overlay {
          opacity: 1;
        }

        .play-button {
          width: 80px;
          height: 80px;
          background: rgba(59, 130, 246, 0.9);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          transition: all 0.3s ease;
        }

        .map-preview-wrapper:hover .play-button {
          background: rgba(59, 130, 246, 1);
          transform: scale(1.1);
        }

        .play-icon {
          color: #ffffff;
          font-size: 2rem;
          margin-left: 4px;
          font-weight: bold;
        }

        .map-badge {
          background: rgba(255, 255, 255, 0.95);
          color: #1a1a1a;
          padding: 0.75rem 1.5rem;
          border-radius: 25px;
          font-size: 1rem;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }

        .features-preview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 2rem;
          margin: 3rem 0;
          opacity: 0;
          transform: translateY(20px);
          animation: fadeInSlideUp 1.5s ease-out 1.5s forwards;
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
          margin: 0 auto 1rem auto;
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
          text-align: center;
          padding: 2rem 0;
          background-color: #0f0f23;
        }

        .scroll-animate {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.8s ease-out, transform 0.8s ease-out;
        }

        .scroll-animate.animate-in {
          opacity: 1;
          transform: translateY(0);
        }

        .feature-card-1.animate-in {
          transition-delay: 0.2s;
        }
        .feature-card-2.animate-in {
          transition-delay: 0.4s;
        }
        .feature-card-3.animate-in {
          transition-delay: 0.6s;
        }

        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-10px);
          }
          60% {
            transform: translateY(-5px);
          }
        }

        @keyframes shine {
          0% {
            transform: translateX(-100%) translateY(-100%) rotate(45deg);
          }
          100% {
            transform: translateX(100%) translateY(100%) rotate(45deg);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.05);
          }
        }

        @keyframes floating {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        @media (max-width: 1024px) {
          .detection-example {
            flex-direction: column !important;
            text-align: center;
            gap: 2rem;
          }

          .detection-image-container {
            max-width: 500px;
          }

          .detection-info {
            justify-content: center;
            text-align: center;
            max-width: 100%;
          }

          .point-content {
            text-align: center;
          }

          .map-preview-container {
            align-items: center;
            text-align: center;
          }

          .map-section-header {
            text-align: center;
            margin-left: auto;
            margin-right: auto;
          }

          .map-preview-wrapper {
            max-width: 100%;
          }
        }

        @media (max-width: 768px) {
          .hero-container {
            padding: calc(64px + 1.5rem) 1rem 1.5rem;
          }

          .main-title {
            font-size: 2.5rem;
          }

          .subtitle, .subtitle-phone {
            font-size: 1.1rem;
          }

          .ai-detection-container, .redmond-container {
            padding: 4rem 1rem 3rem;
          }

          .cta-buttons {
            flex-direction: column;
            align-items: center;
          }

          .btn {
            width: 100%;
            max-width: 280px;
          }

          .scroll-text {
            font-size: 1rem;
          }

          .section-title {
            font-size: 2rem;
          }

          .section-description {
            font-size: 1rem;
          }

          .map-section-title {
            font-size: 1.8rem;
          }

          .map-section-description {
            font-size: 1rem;
          }

          .map-preview-wrapper {
            margin: 0;
          }

          .detection-showcase {
            margin: 0 1rem 4rem 1rem;
          }

          .detection-content {
            gap: 3rem;
          }

          .detection-example {
            gap: 1.5rem;
          }

          .detection-image-container {
            max-width: 100%;
          }

          .detection-info {
            gap: 1rem;
          }

          .point-content h4 {
            font-size: 1.3rem;
          }

          .point-content p {
            font-size: 1rem;
          }

          .features-preview {
            grid-template-columns: 1fr;
            gap: 1.5rem;
          }
        }

        @media (max-width: 480px) {
          .detection-info {
            flex-direction: column;
            text-align: center;
            gap: 1rem;
          }

          .point-content {
            text-align: center;
          }
        }
      `}</style>
    </>
  );
}