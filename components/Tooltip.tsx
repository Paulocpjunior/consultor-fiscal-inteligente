
import React, { ReactNode, useState } from 'react';

interface TooltipProps {
    content: string;
    children: ReactNode;
    className?: string;
    position?: 'top' | 'bottom';
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, className = "", position = 'top' }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div 
            className={`relative flex items-center ${className}`}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
            onFocus={() => setIsVisible(true)}
            onBlur={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div 
                    className={`
                        absolute left-1/2 -translate-x-1/2 w-48 p-2 
                        bg-slate-800 text-white text-xs rounded shadow-lg z-50 animate-fade-in text-center pointer-events-none
                        ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}
                    `}
                >
                    {content}
                    {/* Arrow */}
                    <div 
                        className={`
                            absolute left-1/2 -translate-x-1/2 border-4 border-transparent
                            ${position === 'top' ? 'top-full border-t-slate-800' : 'bottom-full border-b-slate-800'}
                        `}
                    ></div>
                </div>
            )}
        </div>
    );
};

export default Tooltip;
