// frontend/src/app/about/page.tsx
import Link from 'next/link';
import React from 'react';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4">
      <h1 className="text-4xl font-bold text-center my-8 text-gray-800">About Pavement AI</h1>
      <div className="max-w-3xl bg-white p-8 rounded-lg shadow-md text-gray-700">
        <p className="mb-4">
          Pavement AI is an innovative platform dedicated to enhancing the efficiency and accuracy of road infrastructure assessment.
          Leveraging state-of-the-art computer vision and machine learning models, we automate the detection of pavement defects,
          providing precise location data and visual evidence for maintenance planning.
        </p>
        <p className="mb-4">
          Our system processes video feeds and synchronized GPS/accelerometer data to generate detailed GeoJSON reports,
          enabling engineers and urban planners to make informed decisions about road repairs and upkeep.
        </p>
        <p className="mb-4">
          Key features include:
          <ul className="list-disc list-inside ml-4 mt-2">
            <li>Automated defect detection (cracks, potholes, etc.)</li>
            <li>Distance-based frame extraction for consistent data points</li>
            <li>Integration with GPS for accurate geolocation of defects</li>
            <li>Comprehensive reporting with image evidence and GeoJSON output</li>
            <li>Scalable cloud-based processing</li>
          </ul>
        </p>
        <p className="mb-4">
          Our mission is to contribute to safer, more durable, and more sustainable road networks worldwide.
        </p>
        <Link href="/" className="inline-block mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out">
            Back to Home
        </Link>
      </div>
    </div>
  );
}