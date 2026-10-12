// components/Logo.tsx
// Identidade visual da SP Assessoria Contábil: o monograma "SP" com a caneta-tinteiro, pelo ARQUIVO OFICIAL
// (public/logo-sp.png, 512 px). Nada de redesenho em SVG: só o arquivo oficial vale. O mesmo arquivo gera o
// favicon e o ícone do iPhone (public/favicon.png e public/apple-touch-icon.png).
//
// Visual de 12/10/2026 (estilo Apple): o logo fica num quadrado branco de cantos arredondados, como os ícones de
// app — assim ele aparece igual sobre fundo claro, escuro ou gradiente (antes sumia sobre o azul-marinho do login).
// Por isso o tamanho é QUADRADO (ex.: "h-14 w-14").

import React from 'react';

interface LogoProps {
    /** Tamanho em classes Tailwind (quadrado). Default: h-14 w-14 */
    className?: string;
}

const ARQUIVO = '/logo-sp.png';

const Logo: React.FC<LogoProps> = ({ className }) => (
    <span className={`inline-block shrink-0 overflow-hidden rounded-[22%] bg-white ring-1 ring-black/5 ${className || 'h-14 w-14'}`}>
        <img src={ARQUIVO} alt="SP Assessoria Contábil" className="h-full w-full object-contain" draggable={false} />
    </span>
);

export default Logo;
