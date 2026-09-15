/**
 * A lista VAZIA de saída aponta a primeira parada do MODELO filtrado.
 *
 * O caso: PRONTO SOCORRO 0896 · 08/2026 (Paulo, 15/09). Filtro em NFCe +
 * Saída, e a tela respondia com a frase do modelo 55 — mandando importar por
 * uma aba chamada "saída 55" e sem citar a 🧾 NFC-e Saída (SP), que é quem
 * traz o modelo 65. Aviso certo apontando o lugar de OUTRO problema é o
 * achado 18 (21/08).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    motivoDaListaVaziaDeSaida,
    ABA_NFCE_SAIDA,
    ABA_STATUS_EMPRESA,
    ABA_PORTAL_SP,
    ABA_MANUAL_COFRE,
    ABA_NFSE_PDF,
    ABA_NFSE_CSV,
} from '../services/documentosVazioMotivo';

const raiz = join(__dirname, '..');
const lerFonte = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('motivoDaListaVaziaDeSaida — a primeira parada muda com o modelo', () => {
    it('NFCe manda ao SAE-NFC-e e nomeia o Agente A3', () => {
        const m = motivoDaListaVaziaDeSaida({ direcao: 'saida', tipoDoc: 'NFCe' })!;
        expect(m.causa).toBe('saida-nfce');
        expect(m.titulo).toMatch(/NFC-e/);
        expect(m.acao).toContain(ABA_NFCE_SAIDA);
        expect(m.acao).toMatch(/Agente A3/);
        // O certificado é o que decide se o trilho roda — a tela diz ONDE vê-lo,
        // nunca AFIRMA qual a empresa tem.
        expect(m.acao).toContain(ABA_STATUS_EMPRESA);
        expect(m.acao).not.toMatch(/esta empresa (usa|tem) A3/i);
    });

    it('NFCe NÃO repete a frase do modelo 55 nem a aba que não existe', () => {
        const m = motivoDaListaVaziaDeSaida({ direcao: 'saida', tipoDoc: 'NFCe' })!;
        const tudo = `${m.titulo} ${m.explicacao} ${m.acao}`;
        // "Importação Manual" nunca foi o rótulo de aba nenhuma.
        expect(tudo).not.toMatch(/Importação Manual/);
        // A frase antiga falava de "NF-e emitidas", que manda procurar o 55.
        expect(tudo).not.toMatch(/NF-e emitidas pela empresa/);
    });

    it('NFSe não fala em Distribuição DF-e — o trilho é municipal', () => {
        const m = motivoDaListaVaziaDeSaida({ direcao: 'saida', tipoDoc: 'NFSe' })!;
        expect(m.causa).toBe('saida-nfse');
        expect(m.explicacao).toMatch(/MUNICIPAL/);
        expect(m.acao).toContain(ABA_PORTAL_SP);
        expect(m.acao).toContain(ABA_NFSE_PDF);
        expect(m.acao).toContain(ABA_NFSE_CSV);
        // Mandar rodar a captura de NFC-e aqui seria a primeira parada errada.
        expect(m.acao).not.toContain(ABA_NFCE_SAIDA);
    });

    it('CTe separa o frete TOMADO do emitido pela empresa', () => {
        const m = motivoDaListaVaziaDeSaida({ direcao: 'saida', tipoDoc: 'CTe' })!;
        expect(m.causa).toBe('saida-cte');
        expect(m.explicacao).toMatch(/TOMA/);
        expect(m.acao).toContain(ABA_MANUAL_COFRE);
    });

    it('sem modelo filtrado mantém a resposta do caso comum (NF-e)', () => {
        const m = motivoDaListaVaziaDeSaida({ direcao: 'saida' })!;
        expect(m.causa).toBe('saida-nfe');
        expect(m.explicacao).toMatch(/DESTINAT/);
        expect(m.acao).toContain(ABA_MANUAL_COFRE);
    });

    it('AUSÊNCIA NÃO É PROVA: nenhuma frase afirma que faltam notas', () => {
        for (const tipoDoc of ['NFCe', 'NFSe', 'CTe', 'NFe', undefined]) {
            const m = motivoDaListaVaziaDeSaida({ direcao: 'saida', tipoDoc })!;
            expect(m.ressalva).toMatch(/não afirma que faltam notas/);
            const tudo = `${m.titulo} ${m.explicacao} ${m.acao}`;
            expect(tudo).not.toMatch(/faltam notas|notas perdidas|perdeu nota/i);
        }
    });

    it('só responde por SAÍDA — entrada e sem direção ficam com a tela', () => {
        expect(motivoDaListaVaziaDeSaida({ direcao: 'entrada', tipoDoc: 'NFCe' })).toBeNull();
        expect(motivoDaListaVaziaDeSaida({ tipoDoc: 'NFCe' })).toBeNull();
        expect(motivoDaListaVaziaDeSaida({})).toBeNull();
    });

    it('o modelo casa sem depender de caixa', () => {
        expect(motivoDaListaVaziaDeSaida({ direcao: 'saida', tipoDoc: 'nfce' })!.causa).toBe('saida-nfce');
        expect(motivoDaListaVaziaDeSaida({ direcao: 'SAIDA', tipoDoc: 'NFCE' })!.causa).toBe('saida-nfce');
    });
});

describe('a aba que o aviso nomeia TEM de existir', () => {
    // Aviso que aponta aba renomeada envelhece em SILÊNCIO, levando a pessoa ao
    // lugar errado sem nada acusar. Os rótulos saem do menu, não da memória.
    const menu = lerFonte('components/xml/CentralDocumentosFiscais.tsx');

    const abas = [
        ABA_NFCE_SAIDA, ABA_STATUS_EMPRESA, ABA_PORTAL_SP,
        ABA_MANUAL_COFRE, ABA_NFSE_PDF, ABA_NFSE_CSV,
    ];

    it.each(abas)('%s está no menu da Central', (aba) => {
        const [grupo, sub] = aba.split('→').map(s => s.trim());
        expect(menu).toContain(grupo);
        expect(menu).toContain(sub);
    });
});

describe('a tela DELEGA — a frase não volta a morar no .tsx', () => {
    const lista = lerFonte('components/xml/XmlDocumentosList.tsx');

    it('chama o dono', () => {
        expect(lista).toMatch(/motivoDaListaVaziaDeSaida\(filters\)/);
        expect(lista).toMatch(/from '\.\.\/\.\.\/services\/documentosVazioMotivo'/);
    });

    it('não carrega a frase antiga escrita à mão', () => {
        // A prosa dos comentários explica a correção e cita o rótulo; a
        // varredura lê o JSX, nunca a explicação (a mordida do ISS, 22/08).
        const semComentarios = lista
            .replace(/\/\/.*$/gm, '')
            .split('\n').filter(l => !l.trim().startsWith('*')).join('\n');
        expect(semComentarios).not.toMatch(/Distribuição DF-e da SEFAZ, que entrega apenas/);
        expect(semComentarios).not.toMatch(/Importação Manual/);
    });
});
