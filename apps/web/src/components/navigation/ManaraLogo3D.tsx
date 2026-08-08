import React, { useState } from 'react';

interface ManaraLogo3DProps {
  readonly size?: 'sm' | 'md' | 'lg' | 'hero';
  readonly animated?: boolean;
  readonly className?: string;
}

export function ManaraLogo3D({ size = 'md', animated = true, className = '' }: ManaraLogo3DProps) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!animated) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 15, y: -y * 15 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  const sizeDimensions = {
    sm: { width: 36, height: 36, scale: 0.6 },
    md: { width: 48, height: 48, scale: 0.8 },
    lg: { width: 64, height: 64, scale: 1 },
    hero: { width: 140, height: 140, scale: 2.2 },
  }[size];

  return (
    <div
      className={`manara-logo-3d manara-logo-3d--${size} ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(600px) rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
        transition: tilt.x === 0 ? 'transform 0.5s ease-out' : 'none',
      }}
      aria-label="شعار منارة ثلاثي الأبعاد / Manara 3D Logo"
      role="img"
    >
      <svg
        width={sizeDimensions.width}
        height={sizeDimensions.height}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="manara-logo-svg"
      >
        <defs>
          {/* Institutional Green Base Gradient */}
          <linearGradient id="foundation-green-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#17675B" />
            <stop offset="1" stopColor="#0B332F" />
          </linearGradient>

          {/* Copper Glow Light Beam Gradient */}
          <linearGradient id="copper-beam-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#D48b5c" />
            <stop offset="0.5" stopColor="#A8673D" />
            <stop offset="1" stopColor="#6A3929" />
          </linearGradient>

          {/* Light Beacon Glow Gradient */}
          <radialGradient id="beacon-pulse-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#F6E7DC" stopOpacity="0.9" />
            <stop offset="0.6" stopColor="#A8673D" stopOpacity="0.5" />
            <stop offset="1" stopColor="#17675B" stopOpacity="0" />
          </radialGradient>

          {/* 3D Drop Shadow */}
          <filter id="logo-3d-shadow" x="-0.2" y="-0.2" width="1.4" height="1.4">
            <feDropShadow dx="2" dy="4" stdDeviation="3" floodColor="#062420" floodOpacity="0.4" />
          </filter>
        </defs>

        {/* Outer 3D M-shaped / Lighthouse Facet (Institutional Green) */}
        <g filter="url(#logo-3d-shadow)">
          {/* Left Pillar of M / Lighthouse Base */}
          <path
            d="M 20 85 L 20 35 L 35 20 L 35 85 Z"
            fill="url(#foundation-green-grad)"
            stroke="#247D6C"
            strokeWidth="0.8"
          />
          {/* Right Pillar of M / Beacon Spire */}
          <path
            d="M 80 85 L 80 35 L 65 20 L 65 85 Z"
            fill="url(#foundation-green-grad)"
            stroke="#247D6C"
            strokeWidth="0.8"
          />
          {/* Central Converging Arch (Arabic letter Mim / Lighthouse Top) */}
          <path
            d="M 35 20 L 50 40 L 65 20 L 50 10 Z"
            fill="#105047"
            stroke="#4BA18E"
            strokeWidth="0.8"
          />
        </g>

        {/* 4-Step Branching Path Beam (Copper) */}
        {/* Step 1: Institution (Origin) */}
        <circle cx="50" cy="40" r="4" fill="url(#copper-beam-grad)" className="logo-step-node node-1" />
        
        {/* Path Step 1 -> 2 -> 3 -> 4 */}
        <path
          d="M 50 40 L 35 55 L 50 70 L 65 85"
          stroke="url(#copper-beam-grad)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="logo-light-path"
        />

        {/* Step 2: Program */}
        <circle cx="35" cy="55" r="3.5" fill="#A8673D" className="logo-step-node node-2" />
        
        {/* Step 3: Learner */}
        <circle cx="50" cy="70" r="3.5" fill="#A8673D" className="logo-step-node node-3" />
        
        {/* Step 4: Impact / Achievement */}
        <circle cx="65" cy="85" r="4.5" fill="#DF9B6D" className="logo-step-node node-4" />

        {/* Flowing Light Beacon Pulse Point */}
        <circle cx="50" cy="40" r="6" fill="url(#beacon-pulse-glow)" className="flowing-beacon-pulse" />
      </svg>
    </div>
  );
}
