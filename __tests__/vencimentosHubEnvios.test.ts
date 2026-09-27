// ============================================================================
// Paulo, 22/09: "Não localizei esse ENVIOS - REFAZER RITO". A fusão dos três
// hubs em VencimentosHub tinha deixado o painel de Envios (rito) sem porta —
// o texto de ajuda mandava para uma aba que não existia. Este teste prende a
// porta: o hub monta o painel e as mensagens apontam para a aba pelo nome.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

describe('📤 Envios (rito) tem porta no hub de Vencimentos', () => {
    it('VencimentosHub monta o EnviosImpostoPainel numa sub-aba própria', () => {
        const hub = ler('components/Vencimentos/VencimentosHub.tsx');
        expect(hub).toContain("import('../EnviosImpostoPainel')");
        expect(hub).toMatch(/id: 'envios', label: '📤 Envios \(rito\)'/);
        expect(hub).toContain("{sub === 'envios' && <EnviosImpostoPainel />}");
    });
    it('a ajuda do SharePoint aponta para a aba pelo nome que ela tem na tela', () => {
        expect(ler('sefaz-backend/sharepoint-erro-credencial.js')).toContain('aba 📤 Envios (rito)');
    });
    it('o ♻️ Refazer o rito continua vivo dentro do painel, por causa', () => {
        expect(ler('components/EnviosImpostoPainel.tsx')).toContain('<RefazerRito');
    });
});
