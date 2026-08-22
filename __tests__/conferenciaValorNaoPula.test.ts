// ============================================================================
// 🚨 A CONFERÊNCIA CFI × SPED PULAVA O CONFRONTO DE VALOR — CALADA
//
// A tela montava o input lendo **só `d.totais?.vNF`**, e a captura pela SEFAZ
// grava **`valorTotal`**. Resultado: em toda nota capturada automaticamente —
// a maioria — `valorTotal` chegava `undefined`, o serviço PULAVA a comparação
// e a tela mostrava "nenhuma inconsistência".
//
// Ou seja: a conferência que existe para pegar divergência de valor dizia que
// estava tudo certo sem ter comparado nada. É pior que não ter a tela — a
// lição de 12/08 ("conferência que promete número diferente do arquivo é pior
// que não ter tela"), na versão silenciosa.
//
// ⚠️ E o pulo continua existindo, porque documento sem valor legível de fato
// não dá para confrontar. O que mudou é que ele é CONTADO e DITO.
// ============================================================================
import { conferXmlContraSped } from '../services/spedFiscalConferenceService';
import type { SpedFiscalParseResult } from '../types';

const CHAVE = '35260731947349000169550010000034853106861510';

const spedCom = (valorDocumento: number): SpedFiscalParseResult => ({
    documentosC100: [{
        chave: CHAVE, numDoc: '3485', codSit: '00',
        valorDocumento, valorIcms: 0,
    }],
    documentosD100: [],
} as unknown as SpedFiscalParseResult);

describe('🚨 confronto de valor: ou compara, ou DIZ que não comparou', () => {
    it('valor divergente é acusado quando há o que comparar', () => {
        const r = conferXmlContraSped(
            [{ chave: CHAVE, numero: '3485', valorTotal: 1000, status: 'autorizado' }],
            spedCom(1200),
        );
        expect(r.inconsistencias.some(i => i.tipo === 'VALOR_DIVERGENTE')).toBe(true);
        expect(r.semValorParaConferir).toBe(0);
    });

    it('valor igual não acusa nada — e nada foi pulado', () => {
        const r = conferXmlContraSped(
            [{ chave: CHAVE, numero: '3485', valorTotal: 1200, status: 'autorizado' }],
            spedCom(1200),
        );
        expect(r.inconsistencias.some(i => i.tipo === 'VALOR_DIVERGENTE')).toBe(false);
        expect(r.semValorParaConferir).toBe(0);
    });

    // 🔴 O caso do defeito: sem valor, a comparação NÃO acontece. Antes isso
    // era silêncio, indistinguível de "os números batem".
    it('sem valor legível o pulo é CONTADO, nunca silencioso', () => {
        const r = conferXmlContraSped(
            [{ chave: CHAVE, numero: '3485', status: 'autorizado' }],
            spedCom(1200),
        );
        expect(r.inconsistencias.some(i => i.tipo === 'VALOR_DIVERGENTE')).toBe(false);
        expect(r.semValorParaConferir).toBe(1);
    });

    // A trava do lado da TELA: quem monta o input tem de ler pelo dono, senão
    // o serviço recebe `undefined` para toda nota capturada e o contador vira
    // "não conferi nada" — honesto, mas inútil.
    it('a tela monta o input pelo DONO do valor, não por uma forma só', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'components/SpedFiscal/AnaliseConferencia.tsx'), 'utf8',
        );
        expect(src).toContain('valorDoDocumento');
        // A forma antiga lia SÓ o aninhado — e era isso que sumia a captura.
        expect(src).not.toMatch(/valorTotal:\s*d\.totais\?\.vNF\s*,/);
    });

    it('e a tela DIZ o que não foi conferido', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'components/SpedFiscal/AnaliseConferencia.tsx'), 'utf8',
        );
        expect(src).toContain('semValorParaConferir');
        expect(src).toContain('não foram comparados');
    });
});
