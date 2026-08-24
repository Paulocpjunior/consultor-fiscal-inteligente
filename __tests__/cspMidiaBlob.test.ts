// ============================================================================
// 🖼️ CSP × mídia do SP Connect: blob: liberado para imagem e áudio/vídeo
// ----------------------------------------------------------------------------
// O anexo recebido abre COM LOGIN (fetch com token → blob → object URL,
// porque <img src> não manda header). Em 24/08 o imgSrc do helmet não tinha
// blob: e o navegador bloqueava TODA imagem recebida em SILÊNCIO — miniatura
// e visualizador quebrados em Mac, Windows e Teams, enquanto o banner de
// fila (https:) aparecia normal, o que fazia parecer defeito da mídia e não
// da política. Áudio e vídeo saem pelo MESMO caminho e caem no mediaSrc.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const fonte = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');

function diretiva(nome: string): string[] {
    const m = fonte.match(new RegExp(`${nome}:\\s*\\[([^\\]]*)\\]`));
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim().replace(/^["']/, '').replace(/["']$/, '')).filter(Boolean);
}

describe('CSP do server.js × mídia por object URL', () => {
    it('imgSrc permite blob: (imagem recebida) além do https: (banner de fila)', () => {
        const lista = diretiva('imgSrc');
        expect(lista).toContain('blob:');
        expect(lista).toContain('https:');
    });

    it('mediaSrc existe e permite blob: (áudio/vídeo recebidos e a prévia da gravação)', () => {
        const lista = diretiva('mediaSrc');
        expect(lista).toContain("'self'");
        expect(lista).toContain('blob:');
    });
});
