export async function lerPdfVencimentos(bytes) {
            const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const tarefa = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true });
            const pdf = await tarefa.promise;
            try {
                if (pdf.numPages > 100) throw new Error('PDF muito extenso para leitura de vencimentos.');
                const textos = [];
                for (let i=1;i<=pdf.numPages;i++) { const page=await pdf.getPage(i); const text=await page.getTextContent(); textos.push(text.items.map(x=>x.str||'').join(' ')); }
                return textos.join('\n');
            } finally { await tarefa.destroy(); }
}
