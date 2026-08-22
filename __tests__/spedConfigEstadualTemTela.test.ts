// ============================================================================
// 🚨 DOIS CADASTROS QUE O GERADOR LIA E QUE NÃO EXISTIAM EM TELA NENHUMA
//
// Terceira leva do eixo "campo lido × campo gravável" (21/08). Desta vez a
// varredura cruzou o que os GERADORES leem de `dados.` contra o que os
// ORQUESTRADORES montam — o mesmo defeito do `saldoCredorIpiAnterior` de 19/08
// ("gerador que lê campo que ninguém passa", caso PWR).
//
//   · `obrigacoesStPorUf` → o **E250** (a guia do ICMS-ST): NENHUM orquestrador
//     passava, então o registro nunca saía;
//   · `difalCodigoAjusteC197` → o **C197** do DIFAL de aquisição: o orquestrador
//     passava, mas **nenhuma tela gravava** o campo.
//
// Nos DOIS o aviso mandava "informe no cadastro" — e o cadastro não existia.
// Mensagem que manda a pessoa a um lugar inexistente é pior que silêncio: ela
// procura, não acha, e conclui que o app está quebrado.
//
// ⚠️ O app continua NÃO DEDUZINDO nenhum dos dois: vencimento e código de
// receita da GNRE e o COD_AJ da tabela 5.3 são ESTADUAIS. O que mudou é que
// agora existe onde digitá-los — e o aviso diz ONDE.
// ============================================================================
// Este módulo TEM .d.ts (convenção do projeto) — import direto.
import { montarLinhasStBlocoE } from '../sefaz-backend/sped-bloco-e-st.js';

const fonte = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
};

const saidaComSt = (uf: string, vST: number) => ({
    direcao: 'saida', status: 'autorizado', destinatario: { uf, nome: 'CLIENTE X' },
    totais: { vST },
});

describe('🚨 E250 — a obrigação do ST agora tem onde ser cadastrada', () => {
    const base = {
        notas: [saidaComSt('MG', 1000)],
        ufEmpresa: 'SP', dtIni: '01072026', dtFin: '31072026',
    };

    it('sem cadastro: nada de E250 inventado, e o aviso diz ONDE cadastrar', () => {
        const r = montarLinhasStBlocoE(base);
        expect(r.linhas.some((l: string[]) => l[0] === 'E250')).toBe(false);
        const aviso = r.avisos.find((a: string) => a.includes('E250'));
        expect(aviso).toContain('Ajustes E111');
    });

    it('com a obrigação cadastrada, o E250 sai com o vencimento e o código', () => {
        const r = montarLinhasStBlocoE({
            ...base,
            obrigacoesPorUf: { MG: { dtVcto: '09082026', codRec: '220-2' } },
        });
        const e250 = r.linhas.find((l: string[]) => l[0] === 'E250');
        expect(e250).toBeDefined();
        expect(e250).toContain('09082026');
        expect(e250).toContain('220-2');
    });

    // A trava do #382 na versão "campo que mora em coleção": o orquestrador
    // tem que PASSAR e a tela tem que GRAVAR — senão o cadastro é decorativo.
    it('o orquestrador PASSA o campo e a tela GRAVA', () => {
        expect(fonte('sefaz-backend/sped-fiscal-orchestrator.js')).toMatch(/obrigacoesStPorUf,/);
        expect(fonte('components/SpedFiscal/AjustesE111.tsx')).toContain('obrigacoesStPorUf');
        expect(fonte('services/spedAjustesService.ts')).toContain('obrigacoesStPorUf');
    });

    it('o código do C197 também tem tela, e o aviso dele aponta pra ela', () => {
        expect(fonte('components/SpedFiscal/AjustesE111.tsx')).toContain('difalCodigoAjusteC197');
        expect(fonte('sefaz-backend/sped-difal-c197.js')).toContain('Ajustes E111');
    });

    // 🚨 TRÊS DONOS, UM DOCUMENTO: ajustes do E111, código do C197 e obrigações
    // de ST moram no MESMO doc. Um `setDoc` sem merge apagaria o que o outro
    // gravou — e apagaria CALADO, que é o pior jeito de perder um código de
    // tabela estadual que alguém digitou.
    it('a gravação usa MERGE — três donos no mesmo documento', () => {
        expect(fonte('services/spedAjustesService.ts')).toMatch(/\{\s*merge:\s*true\s*\}/);
    });
});
