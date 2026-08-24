// ============================================================================
// 🖼️ Mídia recebida abre DENTRO do app — nunca `blob:` em aba nova
// ----------------------------------------------------------------------------
// Colaborador no Teams do Windows (24/08): clicar na imagem dava "Você
// precisa de um novo app para abrir este link blob". O webview do Teams não
// abre `blob:` em aba — entrega o link pro SISTEMA, que não conhece o
// esquema. A regra: imagem amplia num visualizador NOSSO (overlay), e
// documento BAIXA pelo atributo download, sem target="_blank" no blob.
// URL pública https (banner de fila) pode continuar com target="_blank" —
// o Teams abre https no navegador padrão sem problema.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const fonte = fs.readFileSync(
    path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8',
);

describe('mídia no SP Connect dentro do Teams', () => {
    it('NENHUM blob (midias[...].url / zoom.url) abre com target="_blank"', () => {
        // É exatamente o padrão que o webview do Teams manda pro sistema.
        expect(fonte).not.toMatch(/midias\[m\.id\]\.url\}\s+target=/);
        expect(fonte).not.toMatch(/zoom\.url\}\s+target=/);
    });

    it('imagem abre o visualizador do app (clique → setZoom), não uma aba', () => {
        expect(fonte).toMatch(/onClick=\{\(\) => setZoom\(\{ url: midias\[m\.id\]\.url/);
        expect(fonte).toMatch(/cursor-zoom-in/);
    });

    it('o visualizador existe, fecha e oferece o download pelo atributo', () => {
        expect(fonte).toMatch(/\{zoom && \(/);
        expect(fonte).toMatch(/setZoom\(null\)/);
        expect(fonte).toMatch(/href=\{zoom\.url\} download=\{zoom\.nome\}/);
    });

    it('documento baixa pelo atributo download (sem aba nova de blob)', () => {
        expect(fonte).toMatch(/download=\{m\.midia\?\.nomeArquivo \|\| 'anexo'\}/);
    });
});
