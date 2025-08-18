'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import MapComponent to ensure it only loads on the client side
// We'll also pass sidebar state to it
const DynamicMapComponent = dynamic(() => import('../../components/MapComponent'), {
  ssr: false, // Do not render on server side
  loading: () => <p className="text-center text-gray-500 text-lg">Loading map...</p>,
});

export default function MultiS3GeoJSONMapPage() {
  const [geojson, setGeojson] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // State for sidebar in parent to control map width
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [screenSize, setScreenSize] = useState({ width: 0, height: 0 }); // Added to dynamically calc sidebar width
  const [urlLimit, setUrlLimit] = useState(100); // New state for URL limit

  useEffect(() => {
    const updateScreenSize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  const getSidebarWidth = () => {
    if (screenSize.width >= 1920) return 1000;
    if (screenSize.width >= 1600) return 800;
    if (screenSize.width >= 1200) return 500;
    return 450;
  };
  const sidebarWidth = getSidebarWidth(); // Calculate once per render cycle when screen size changes

  async function listResultsGeojsonUrls(): Promise<string[]> {
    const prefix = 'results_redmond_downtown/';
    const delimiter = '/';
    const baseUrl = 'https://civicscan-aatishparson-bucket-03-18-2004.s3.amazonaws.com';

    const res = await fetch(`${baseUrl}/?prefix=${prefix}&delimiter=${delimiter}`);
    const xmlText = await res.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    // Extract all folders
    const prefixes = [...xmlDoc.getElementsByTagName('CommonPrefixes')].map(cp => {
      return cp.getElementsByTagName('Prefix')[0].textContent!;
    });

    // Build full GeoJSON URLs
    return prefixes.map(folder => `${baseUrl}/${folder}metadata/results_metadata_grouped.geojson`);
  }

  const handleLoadMap = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setGeojson(null);

    // Retry helper function with exponential backoff
    const fetchWithRetry = async (url: string, maxRetries = 3): Promise<Response> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(url);
          
          // If it's a 404 and we have retries left, wait and try again
          if (response.status === 404 && attempt < maxRetries) {
            const delay = Math.min(100 * Math.pow(2, attempt), 400); // Cap at 4 seconds
            console.log(`404 for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          return response;
        } catch (err) {
          // For network errors, also retry
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
            console.log(`Network error for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw err;
        }
      }
      
      // This shouldn't be reached, but TypeScript needs it
      throw new Error('Max retries exceeded');
    };

    try {
      const allUrls = await listResultsGeojsonUrls();
      if (allUrls.length === 0) {
        setError('No scan folders found in results_redmond_downtown/.');
        setLoading(false);
        return;
      }
      
      // Limit the number of URLs to fetch
      const geojsonUrls = allUrls.slice(0, urlLimit);
      console.log(`Fetching data from ${geojsonUrls.length} GeoJSON files.`);

      let allFeatures: any[] = [];
      const failedUrls: string[] = [];

      const fetchPromises = geojsonUrls.map(async (geojsonUrl, index) => {
        try {
          const encodedUrl = encodeURI(geojsonUrl);
          const response = await fetchWithRetry(encodedUrl);
          
          if (!response.ok) {
            console.log(`HTTP fail for ${geojsonUrl}, status: ${response.status}`);
            failedUrls.push(geojsonUrl);
            return;
          }

          // Step 1: Get the raw response text
          const rawText = await response.text();
          
          // Step 2: Manually replace 'NaN' with a valid JSON value like 'null'
          // We use a regular expression to find all instances of ': NaN'
          const correctedText = rawText.replace(/: NaN/g, ': null');
          
          // Step 3: Parse the corrected string as JSON
          const fetchedGeojson = JSON.parse(correctedText);
          
          fetchedGeojson.features.forEach((feature: any) => {
            feature.properties.sourceUrl = geojsonUrl;
            feature.properties.sourceIndex = index;
            const timestamp = fetchedGeojson.metadata?.scan_info?.timestamp;
            const frameNumber = feature.properties?.frame_number;
            feature.properties.globalTimestamp = parseInt(timestamp) + parseInt(frameNumber);
          });
          
          allFeatures = allFeatures.concat(fetchedGeojson.features);
        } catch (err: any) {
          failedUrls.push(geojsonUrl);
          console.error(`Error loading ${geojsonUrl}`, err);
        }
      });

      await Promise.allSettled(fetchPromises);
      console.log("could not retrieve:")
      console.log(failedUrls)
      if (allFeatures.length > 0) {
        const combinedGeoJSON = {
          type: 'FeatureCollection',
          features: allFeatures,
          metadata: {
            totalFeaturesLoaded: allFeatures.length,
            failedSources: failedUrls,
            processedAt: new Date().toISOString(),
          },
        };
        
        setGeojson(combinedGeoJSON);
        setSuccessMessage(`Loaded ${allFeatures.length} crack-containing frames from ${geojsonUrls.length - failedUrls.length} sources.`);
      } else {
        setError('No defects found in any results.');
      }
    } catch (err: any) {
      console.error('Unexpected failure:', err);
      setError(`Unexpected error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Compact controls bar */}
      <div style={{ 
        position: 'fixed',
        top: '50px', // Just below navbar
        left: '0',
        right: '0',
        zIndex: 1000,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        padding: '1rem'
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap'
        }}>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: 'bold',
            color: '#1e40af',
            fontFamily: 'Inter, sans-serif',
            margin: '0',
            flex: '1',
            minWidth: '200px'
          }}>
            Pavement Defect Map
          </h1>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="urlLimit" style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: '500' }}>Max Segments:</label>
            <input
              id="urlLimit"
              type="number"
              value={urlLimit}
              onChange={(e) => setUrlLimit(Number(e.target.value))}
              min="1"
              style={{
                width: '60px',
                padding: '0.25rem',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontSize: '0.9rem',
                textAlign: 'center'
              }}
            />
          </div>

          <button
            onClick={handleLoadMap}
            disabled={loading}
            style={{
              background: loading ? '#9ca3af' : '#2563eb',
              color: 'white',
              fontWeight: '600',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease-in-out',
              fontSize: '0.9rem',
              minWidth: '120px'
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = '#1d4ed8';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background = '#2563eb';
              }
            }}
          >
            {loading ? 'Loading... (allow ~10 seconds)' : 'Load Maps'}
          </button>

          {loading && (
            <span style={{
              color: '#6b7280',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}>
              Fetching data...
            </span>
          )}
          
          {error && (
            <span style={{
              color: '#dc2626',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}>
              {error}
            </span>
          )}
          
          {successMessage && (
            <span style={{
              color: '#059669',
              fontSize: '0.9rem',
              fontWeight: '600'
            }}>
              ✓ {geojson?.features?.length || 0} frames loaded
            </span>
          )}
        </div>
      </div>

      {/* Main content area: Map + Sidebar */}
      <div style={{
        position: 'fixed',
        top: '0', // Below navbar + controls
        left: '0',
        right: '0',
        bottom: '0',
        display: 'flex', // Use flexbox here
        backgroundColor: '#e5e7eb', // This background color will be visible if map isn't full width
      }}>
        <div style={{
          flexGrow: 1, // Allows map container to take up available space
          transition: 'margin-right 0.3s ease', // Smooth transition for map shrinking/expanding
          marginRight: isSidebarOpen ? `${sidebarWidth}px` : '0', // Pushes map to the left
        }}>
          {/* Pass sidebar state and width to MapComponent */}
          <DynamicMapComponent 
            geojson={geojson} 
            isSidebarOpen={isSidebarOpen} 
            setIsSidebarOpen={setIsSidebarOpen} 
            sidebarWidth={sidebarWidth}
          />
        </div>
      </div>

      {/* Instructions overlay */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '0.75rem 1rem',
        borderRadius: '12px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        fontSize: '0.9rem',
        fontWeight: '500',
        textAlign: 'center',
        width: 'fit-content',
        whiteSpace: 'nowrap',  // This prevents text wrapping
        maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ marginBottom: '0.25rem' }}>
          <strong>AI Model under development</strong> - false positives remain
        </div>
        <div style={{ marginBottom: '0.25rem' }}>
          📍 <strong>Zoom in</strong> and click clusters/dots to see cracks
        </div>
      </div>

      <style jsx>{`
        /* Additional responsive styles */
        @media (max-width: 768px) {
          h1 {
            font-size: 2rem !important;
          }
          
          .container {
            padding: 0.5rem !important;
          }
        }
      `}</style>
    </>
  );
}