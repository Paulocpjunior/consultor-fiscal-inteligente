import React from 'react';

/**
 * SafeMarkdown — render seguro de texto com **negrito** e quebras de linha.
 *
 * Substitui o padrão dangerouslySetInnerHTML usado pra exibir saída
 * do Gemini. Renderiza via JSX sem injetar HTML cru, eliminando o vetor
 * de XSS armazenado via prompt-injection (campos de empresa, PDFs PGDAS,
 * descrições controladas por usuário).
 *
 * Suporta apenas: **negrito** e \n. Qualquer outra tag chega literal.
 */

interface SafeMarkdownProps {
    text: string;
    className?: string;
}

function renderInlineBold(s: string): React.ReactNode[] {
    // Quebra em segmentos por **...**
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(p);
        if (m) return <strong key={i}>{m[1]}</strong>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
    });
}

function renderBlockWithLineBreaks(block: string, keyPrefix: string): React.ReactNode[] {
    const lines = block.split('\n');
    const out: React.ReactNode[] = [];
    lines.forEach((line, idx) => {
        if (idx > 0) out.push(<br key={`${keyPrefix}-br-${idx}`} />);
        out.push(<React.Fragment key={`${keyPrefix}-l-${idx}`}>{renderInlineBold(line)}</React.Fragment>);
    });
    return out;
}

const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ text, className }) => {
    if (!text) return null;
    const blocks = text.split(/\n\n+/);
    return (
        <>
            {blocks.map((b, i) => (
                <p key={i} className={className}>
                    {renderBlockWithLineBreaks(b, `b${i}`)}
                </p>
            ))}
        </>
    );
};

export default SafeMarkdown;
