import React from 'react';

interface LogoProps {
    className?: string;
}

const Logo: React.FC<LogoProps> = ({ className }) => {
    const finalClassName = className || "h-14 w-auto";
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 320 80"
            className={finalClassName}
            aria-label="Logo SP Assessoria Contabil"
        >
            <defs>
                <linearGradient id="logo_grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#1400FF" />
                    <stop offset="100%" stopColor="#08007A" />
                </linearGradient>
            </defs>
            <g transform="translate(5, 10)">
                <rect x="0" y="0" width="60" height="60" rx="14" fill="url(#logo_grad)"
                    style={{filter:"drop-shadow(0 0 8px rgba(20,0,255,0.7))"}} />
                <rect x="14" y="38" width="8" height="12" rx="2" fill="white" fillOpacity="0.6" />
                <rect x="26" y="28" width="8" height="22" rx="2" fill="white" fillOpacity="0.8" />
                <rect x="38" y="18" width="8" height="32" rx="2" fill="white" />
                <path
                    d="M14 30 L26 20 L38 10 L50 10"
                    stroke="white" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round" fill="none"
                />
                <path d="M46 10 L50 10 L50 14" stroke="white" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </g>
            <g transform="translate(75, 0)">
                <text x="0" y="50"
                    fontFamily="DM Sans, sans-serif"
                    fontWeight="900" fontSize="52"
                    fill="#F5F6FF" letterSpacing="-3">
                    SP
                </text>
                <rect x="74" y="18" width="1.5" height="44" fill="#C8D0FF" fillOpacity="0.25" />
                <g transform="translate(88, 0)">
                    <text x="0" y="34"
                        fontFamily="DM Sans, sans-serif"
                        fontWeight="700" fontSize="15"
                        fill="#C8D0FF" fillOpacity="0.55" letterSpacing="0.5">
                        ASSESSORIA
                    </text>
                    <text x="0" y="53"
                        fontFamily="DM Sans, sans-serif"
                        fontWeight="800" fontSize="15"
                        fill="#5B7FFF" letterSpacing="0.5">
                        CONTABIL
                    </text>
                </g>
            </g>
        </svg>
    );
};

export default Logo;
