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
    const finalClassName = className || "h-14 w-auto";
    const isLight = variant === 'light';

    const spFill = isLight ? 'fill-white' : 'fill-slate-800 dark:fill-white';
    const dividerFill = isLight ? 'fill-white/40' : 'fill-slate-300 dark:fill-slate-600';
    const assessoriaFill = isLight ? 'fill-sky-100' : 'fill-slate-600 dark:fill-slate-300';
    const contabilFill = isLight ? 'fill-sky-200' : 'fill-sky-600 dark:fill-sky-400';

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 320 80"
            className={finalClassName}
            aria-label="Logo SP Assessoria Contábil"
            fill="none"
        >
            <defs>
                <linearGradient id="logo_grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0ea5e9" />
                    <stop offset="100%" stopColor="#0284c7" />
                </linearGradient>
            </defs>

            {/* Ícone Gráfico: Box com Gráfico de Evolução (Identidade Visual Moderna) */}
            <g transform="translate(5, 10)">
                <rect x="0" y="0" width="60" height="60" rx="14" fill="url(#logo_grad)" />

                <path
                    d="M12 45 L12 45"
                    stroke="white"
                    strokeWidth="4"
                    strokeLinecap="round"
                />
                <rect x="14" y="38" width="8" height="12" rx="2" fill="white" fillOpacity="0.6" />
                <rect x="26" y="28" width="8" height="22" rx="2" fill="white" fillOpacity="0.8" />
                <rect x="38" y="18" width="8" height="32" rx="2" fill="white" />

                <path
                    d="M14 30 L26 20 L38 10 L50 10"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                />
                <path d="M46 10 L50 10 L50 14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </g>

            {/* Tipografia da Marca */}
            <g transform="translate(75, 0)">
                <text
                    x="0"
                    y="50"
                    fontFamily="Arial, sans-serif"
                    fontWeight="900"
                    fontSize="52"
                    className={spFill}
                    letterSpacing="-3"
                >
                    SP
                </text>

                <rect x="74" y="18" width="1.5" height="44" className={dividerFill} />

                <g transform="translate(88, 0)">
                    <text
                        x="0"
                        y="34"
                        fontFamily="Arial, sans-serif"
                        fontWeight="700"
                        fontSize="15"
                        className={assessoriaFill}
                        letterSpacing="0.5"
                    >
                        ASSESSORIA
                    </text>
                    <text
                        x="0"
                        y="53"
                        fontFamily="Arial, sans-serif"
                        fontWeight="800"
                        fontSize="15"
                        className={contabilFill}
                        letterSpacing="0.5"
                    >
                        CONTÁBIL
                    </text>
                </g>
            </g>
        </svg>
    );
};

export default Logo;
