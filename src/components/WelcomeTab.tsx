import React from 'react';

const WelcomeTab: React.FC = () => {
  // Elliptical arc path for animateMotion (rx=80, ry=32, centered at origin)
  const ellipsePath = 'M -80,0 A 80,32 0 1,1 80,0 A 80,32 0 1,1 -80,0';

  return (
    <div className="flex items-center justify-center h-full w-full select-none">
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 0.9; }
        }
        @keyframes electron-glow {
          0%, 100% { filter: drop-shadow(0 0 3px #41D1FF); }
          50%      { filter: drop-shadow(0 0 10px #41D1FF) drop-shadow(0 0 20px rgba(65,209,255,0.3)); }
        }
        .welcome-nucleus {
          animation: pulse-glow 3s ease-in-out infinite;
        }
        .welcome-electron-group {
          animation: electron-glow 2s ease-in-out infinite;
        }
        .welcome-orbit {
          fill: none;
          stroke: #A2ECFB;
          stroke-width: 1.5;
          opacity: 0.4;
        }
      `}</style>

      <div className="flex flex-col items-center gap-10">
        {/* Atom SVG */}
        <svg width="260" height="260" viewBox="-130 -130 260 260">
          {/* Nucleus glow */}
          <circle className="welcome-nucleus" cx="0" cy="0" r="24" fill="url(#welcome-nucleusGrad)" />

          {/* Orbital 1: 0 degrees */}
          <g transform="rotate(0)">
            <ellipse className="welcome-orbit" cx="0" cy="0" rx="80" ry="32" />
            <g className="welcome-electron-group">
              <circle r="5" fill="#41D1FF">
                <animateMotion dur="5s" repeatCount="indefinite" path={ellipsePath} />
              </circle>
            </g>
          </g>

          {/* Orbital 2: 60 degrees */}
          <g transform="rotate(60)">
            <ellipse className="welcome-orbit" cx="0" cy="0" rx="80" ry="32" />
            <g className="welcome-electron-group" style={{ animationDelay: '0.7s' }}>
              <circle r="5" fill="#41D1FF">
                <animateMotion dur="4s" repeatCount="indefinite" path={ellipsePath} />
              </circle>
            </g>
          </g>

          {/* Orbital 3: 120 degrees */}
          <g transform="rotate(120)">
            <ellipse className="welcome-orbit" cx="0" cy="0" rx="80" ry="32" />
            <g className="welcome-electron-group" style={{ animationDelay: '1.4s' }}>
              <circle r="5" fill="#41D1FF">
                <animateMotion dur="3s" repeatCount="indefinite" path={ellipsePath} />
              </circle>
            </g>
          </g>

          {/* Blue orb nucleus */}
          <circle cx="0" cy="0" r="12" fill="url(#welcome-orbGrad)" />
          <circle cx="0" cy="0" r="12" fill="url(#welcome-orbShine)" />

          {/* Gradients */}
          <defs>
            <radialGradient id="welcome-nucleusGrad">
              <stop offset="0%" stopColor="#41D1FF" stopOpacity="0.6" />
              <stop offset="60%" stopColor="#BD34FE" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#BD34FE" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="welcome-orbGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7EE0FF" />
              <stop offset="50%" stopColor="#41D1FF" />
              <stop offset="100%" stopColor="#1A6B9C" />
            </radialGradient>
            <radialGradient id="welcome-orbShine" cx="35%" cy="30%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="0.5" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>
        </svg>

        {/* Tagline */}
        <p className="text-lg tracking-wide text-[var(--text-muted)]" style={{ fontStyle: 'italic' }}>
          If you can dream it, we can build it
        </p>
      </div>
    </div>
  );
};

export default React.memo(WelcomeTab);
