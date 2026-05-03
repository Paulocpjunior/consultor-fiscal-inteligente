import React from 'react';

interface LogoProps {
    className?: string;
    /**
     * 'default' adapta cores ao tema (light/dark) — uso padrão dentro do app.
     * 'light' força tonalidades claras, ideal sobre fundos escuros (banners, headers gradient).
     */
    variant?: 'default' | 'light';
}

const Logo: React.FC<LogoProps> = ({ className, variant = 'default' }) => {
    const finalClassName = className || 'h-14 w-auto';

    return (
        <img
            src="/sp-logo.png"
            alt="SP Assessoria Contábil"
            className={`${finalClassName} object-contain ${variant === 'light' ? 'drop-shadow-[0_0_12px_rgba(91,127,255,0.35)]' : ''}`}
            draggable={false}
        />
    );
};

export default Logo;
