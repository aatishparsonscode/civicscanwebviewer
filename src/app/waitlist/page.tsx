'use client';
import Link from 'next/link';
import React, { useState } from 'react';

export default function WaitlistPage() {
  const [name, setName] = useState('');
  const [occupation, setOccupation] = useState('');
  const [organization, setOrganization] = useState('');
  const [useCase, setUseCase] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e : any) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      // Replace with your Google Apps Script Web App URL
      const scriptUrl = 'https://script.google.com/macros/s/AKfycbz1T34ThUfdMkZfFRxq1KmkVK4FyQ62P-QWgce76GmCp1o-e0exiuFbqimN7m3K7fvS/exec';
      
      const formData = new FormData();
      formData.append('name', name);
      formData.append('occupation', occupation);
      formData.append('organization', organization);
      formData.append('useCase', useCase);
      formData.append('timestamp', new Date().toISOString());
      
      const response = await fetch(scriptUrl, {
        method: 'POST',
        body: formData,
        mode: 'no-cors' // Required for Google Apps Script
      });
      
      // Since we're using no-cors, we can't read the response
      // but we'll assume success if no error is thrown
      setIsSubmitted(true);
    } catch (error) {
      console.error('Error submitting form:', error);
      alert('There was an error submitting the form. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <>
        <div className="waitlist-container">
          <div className="content-wrapper">
            <div className="success-section">
              <div className="success-icon">✅</div>
              <h1 className="success-title">You're signed up!</h1>
              <p className="success-message">
                Thank you for joining our waitlist! We're excited to have you on board.
              </p>
              <p className="success-details">
                You'll be among the first to know when CivicScan launches. We'll send you updates 
                on our progress and early access when it's ready.
              </p>
              <div className="success-actions">
                <Link href="/" className="btn-home">
                  Back to Home
                </Link>
                <Link href="/about" className="btn-secondary">
                  Learn More
                </Link>
              </div>
            </div>
          </div>
        </div>
        <style jsx global>{`
          .success-section {
            text-align: center;
            max-width: 600px;
            margin: 4rem auto;
            animation: fadeInUp 0.8s ease-out;
          }

          .success-icon {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
          }

          .success-title {
            font-size: clamp(2rem, 5vw, 2.5rem);
            font-weight: 800;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }

          .success-message {
            font-size: 1.2rem;
            color: #e2e8f0;
            margin-bottom: 1rem;
            line-height: 1.6;
          }

          .success-details {
            color: #cbd5e1;
            font-size: 1rem;
            line-height: 1.6;
            margin-bottom: 2rem;
          }

          .success-actions {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
          }

          .btn-home,
          .btn-secondary {
            padding: 1rem 2rem;
            border-radius: 12px;
            font-weight: 600;
            font-size: 1rem;
            text-decoration: none;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 140px;
          }

          .btn-home {
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            color: #1a1a1a;
            box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3);
          }

          .btn-home:hover {
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

          @media (max-width: 640px) {
            .success-actions {
              flex-direction: column;
              align-items: center;
            }

            .btn-home,
            .btn-secondary {
              width: 100%;
              max-width: 280px;
            }
          }
        `}</style>
      </>
    );
  }

  return (
    <>
      <div className="waitlist-container">
        <div className="content-wrapper">
          <div className="hero-section">
            <h1 className="page-title">Join the Waitlist</h1>
            <p className="hero-subtitle">
              Be among the first to experience AI-powered road assessment technology
            </p>
          </div>

          <div className="form-section">
            <div className="form-container">
              <div className="form-header">
                <h2 className="form-title">Get Early Access</h2>
                <p className="form-description">
                  Sign up now and we'll notify you when CivicScan is ready for launch
                </p>
              </div>

              <form onSubmit={handleSubmit} className="waitlist-form">
                <div className="form-group">
                  <label htmlFor="name" className="form-label">Full Name *</label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="form-input"
                    placeholder="Enter your full name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="occupation" className="form-label">Occupation</label>
                  <input
                    type="text"
                    id="occupation"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    className="form-input"
                    placeholder="Your job title or profession (optional)"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="organization" className="form-label">Organization</label>
                  <input
                    type="text"
                    id="organization"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    className="form-input"
                    placeholder="City, company, or organization (optional)"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="useCase" className="form-label">How do you plan to use CivicScan?</label>
                  <select
                    id="useCase"
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                    className="form-select"
                  >
                    <option value="">Select your use case</option>
                    <option value="municipal">Municipal road maintenance</option>
                    <option value="engineering">Engineering consulting</option>
                    <option value="research">Academic research</option>
                    <option value="construction">Construction/Infrastructure</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <button 
                  type="submit" 
                  className="submit-btn"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <span className="loading-spinner"></span>
                      Adding to Waitlist...
                    </>
                  ) : (
                    'Join Waitlist'
                  )}
                </button>
              </form>

              <div className="form-footer">
                <p className="privacy-text">
                  We respect your privacy. Your information will only be used to notify you about CivicScan updates.
                </p>
              </div>
            </div>

            <div className="benefits-section">
              <h3 className="benefits-title">Why Join Early?</h3>
              <div className="benefits-list">
                <div className="benefit-item">
                  <div className="benefit-icon">🚀</div>
                  <div>
                    <h4>Early Access</h4>
                    <p>Be the first to try CivicScan when it launches</p>
                  </div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon">💰</div>
                  <div>
                    <h4>Special Pricing</h4>
                    <p>Exclusive discounts for early adopters</p>
                  </div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon">🎯</div>
                  <div>
                    <h4>Shape the Product</h4>
                    <p>Your feedback will help us build the perfect solution</p>
                  </div>
                </div>
                <div className="benefit-item">
                  <div className="benefit-icon">📊</div>
                  <div>
                    <h4>Priority Support</h4>
                    <p>Get dedicated support when you need it most</p>
                  </div>
                </div>
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

        .waitlist-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f0f23 100%);
          position: relative;
          padding-top: 5rem;
        }

        .waitlist-container::before {
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
          padding: 2rem;
        }

        .hero-section {
          text-align: center;
          margin-bottom: 3rem;
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

        .form-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4rem;
          align-items: start;
          animation: fadeInUp 0.8s ease-out 0.2s both;
        }

        .form-container {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 2.5rem;
          transition: all 0.3s ease;
        }

        .form-container:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateY(-2px);
        }

        .form-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .form-title {
          font-size: 1.8rem;
          font-weight: 700;
          color: #fbbf24;
          margin-bottom: 0.5rem;
        }

        .form-description {
          color: #cbd5e1;
          font-size: 1rem;
        }

        .waitlist-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-label {
          color: #e2e8f0;
          font-weight: 500;
          font-size: 0.95rem;
        }

        .form-input,
        .form-select {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          padding: 0.875rem 1rem;
          color: #ffffff;
          font-size: 1rem;
          transition: all 0.3s ease;
        }

        .form-input:focus,
        .form-select:focus {
          outline: none;
          border-color: #fbbf24;
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.1);
        }

        .form-input::placeholder {
          color: #94a3b8;
        }

        .form-select option {
          background: #1a1a2e;
          color: #ffffff;
        }

        .submit-btn {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          color: #1a1a1a;
          border: none;
          border-radius: 12px;
          padding: 1rem 2rem;
          font-size: 1.1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 8px 24px rgba(251, 191, 36, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(251, 191, 36, 0.4);
          background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%);
        }

        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .loading-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #1a1a1a;
          border-top: 2px solid transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .form-footer {
          text-align: center;
          margin-top: 1.5rem;
        }

        .privacy-text {
          color: #94a3b8;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .benefits-section {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 2.5rem;
        }

        .benefits-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #fbbf24;
          margin-bottom: 1.5rem;
          text-align: center;
        }

        .benefits-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .benefit-item {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .benefit-icon {
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

        .benefit-item h4 {
          color: #ffffff;
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        .benefit-item p {
          color: #cbd5e1;
          font-size: 0.95rem;
          line-height: 1.5;
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

        @media (max-width: 968px) {
          .form-section {
            grid-template-columns: 1fr;
            gap: 2rem;
          }
        }

        @media (max-width: 768px) {
          .content-wrapper {
            padding: 1rem;
          }

          .form-container,
          .benefits-section {
            padding: 2rem;
          }

          .waitlist-container {
            padding-top: 4rem;
          }
        }
      `}</style>
    </>
  );
}