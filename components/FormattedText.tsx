
import React from 'react';
import ReactMarkdown from 'react-markdown';

export const FormattedText: React.FC<{ text?: string | null }> = ({ text }) => {
    if (!text) {
        return null;
    }

    return (
        <div className="markdown-body prose prose-slate dark:prose-invert max-w-none">
            <ReactMarkdown>{text}</ReactMarkdown>
        </div>
    );
};
