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

    try {
      const geojsonUrls = await listResultsGeojsonUrls();

      if (geojsonUrls.length === 0) {
        setError('No scan folders found in results_redmond_downtown/.');
        setLoading(false);
        return;
      }

      let allFeatures: any[] = [];
      const failedUrls: string[] = [];

      const fetchPromises = geojsonUrls.map(async (geojsonUrl, index) => {
        try {
          const response = await fetch(geojsonUrl);
          if (!response.ok){
            console.log(`HTTP ${response.status}`);
            throw new Error(`HTTP ${response.status}`);
          } 
          const fetchedGeojson = await response.json();
          fetchedGeojson.features.forEach((feature: any) => {
            feature.properties.sourceUrl = geojsonUrl;
            feature.properties.sourceIndex = index;
            feature.properties.globalTimestamp =  parseInt(fetchedGeojson.metadata.scan_info.timestamp) + parseInt(feature.properties.frame_number);
          });

          allFeatures = allFeatures.concat(fetchedGeojson.features);

        } catch (err: any) {
          failedUrls.push(geojsonUrl);
          console.error(`Error loading ${geojsonUrl}`, err);
        }
      });

      await Promise.allSettled(fetchPromises);

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
            {loading ? 'Loading... (allow couple seconds)' : 'Load Maps'}
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
        padding: '0.75rem 1.5rem',
        borderRadius: '12px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        fontSize: '0.9rem',
        fontWeight: '500',
        textAlign: 'center',
        maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ marginBottom: '0.25rem' }}>
          📍 <strong>Zoom in</strong> to see clusters of cracks • <strong>Click clusters</strong> to see all cracks
        </div>
        <div style={{ fontSize: '0.8rem', opacity: '0.8' }}>
          Zoom in more to see each crack pinpointed
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