/**
 * Farol da ordem técnica do envio de imposto (#293).
 *
 * A auditoria já registrava cada etapa; faltava o agregado. Regra: envio pela
 * METADE não é sucesso — cópia no SharePoint e baixa da obrigação fazem parte
 * do envio, e cada pendência precisa sair com motivo e ação.
 */
import {
    montarPainelEnvios, pendenciaSharePoint, pendenciaBaixa, conferirRitoDosEnvios,
} from '../sefaz-backend/envio-imposto-painel.js';

const envio = (over: any = {}) => ({
    empresaNome: 'CLIENTE LTDA',
    empresaCnpj: '11111111000191',
    tipo: 'DARE',
    competencia: '2026-07',
    valor: 1000,
    copiaPara: ['alexandre@spassessoriacontabil.com.br'],
    sharePoint: { status: 'arquivado' },
    baixa: { status: 'baixada' },
    ...over,
});

describe('pendências por etapa', () => {
    it('SharePoint arquivado ou sem PDF não é pendência', () => {
        expect(pendenciaSharePoint(envio())).toBeNull();
        expect(pendenciaSharePoint(envio({ sharePoint: { status: 'sem-pdf' } }))).toBeNull();
    });

    it('empresa sem pasta configurada vira causa única com a ação', () => {
        const p = pendenciaSharePoint(envio({ sharePoint: { status: 'sem-config' } }));
        expect(p!.causa).toMatch(/sem pasta do SharePoint/i);
        expect(p!.acao).toMatch(/Integrações → SharePoint/);
    });

    it('erro de gravação leva o motivo técnico junto', () => {
        const p = pendenciaSharePoint(envio({ sharePoint: { status: 'erro', motivo: '403 Forbidden' } }));
        expect(p!.acao).toMatch(/403 Forbidden/);
    });

    it('baixa sem tarefa explica que a obrigação do mês não existe', () => {
        const p = pendenciaBaixa(envio({ baixa: { status: 'sem-tarefa' } }));
        expect(p!.causa).toMatch(/Sem obrigação correspondente/);
        expect(p!.acao).toMatch(/Gere as tarefas da competência/);
    });
});

describe('montarPainelEnvios', () => {
    it('tudo completo → farol ok', () => {
        const p = montarPainelEnvios([envio(), envio({ tipo: 'DAS' })], { competencia: '2026-07' });
        expect(p.total).toBe(2);
        expect(p.completos).toBe(2);
        expect(p.farol).toBe('ok');
        expect(p.porTipo).toEqual({ DARE: 1, DAS: 1 });
        expect(p.valorTotal).toBe(2000);
    });

    it('envio pela metade NÃO é sucesso — vira atenção com a causa', () => {
        const p = montarPainelEnvios([
            envio(),
            envio({ empresaNome: 'OUTRA LTDA', sharePoint: { status: 'sem-config' } }),
        ], { competencia: '2026-07' });
        expect(p.completos).toBe(1);
        expect(p.incompletos).toBe(1);
        expect(p.farol).toBe('atencao');
        expect(p.resumo).toMatch(/ficaram pela metade/);
        const causa = Object.keys(p.pendencias)[0];
        expect(p.pendencias[causa].qtd).toBe(1);
        expect(p.pendencias[causa].empresas[0]).toMatch(/OUTRA LTDA/);
    });

    it('agrupa a MESMA causa de várias empresas (uma tarefa, não N mistérios)', () => {
        const p = montarPainelEnvios([
            envio({ empresaNome: 'A', sharePoint: { status: 'sem-config' } }),
            envio({ empresaNome: 'B', sharePoint: { status: 'sem-config' } }),
            envio({ empresaNome: 'C', sharePoint: { status: 'sem-config' } }),
        ]);
        const causa = 'Empresa sem pasta do SharePoint';
        expect(p.pendencias[causa].qtd).toBe(3);
        expect(p.pendencias[causa].empresas).toHaveLength(3);
    });

    it('um envio com DUAS pendências conta nas duas causas, mas incompleto uma vez só', () => {
        const p = montarPainelEnvios([
            envio({ sharePoint: { status: 'sem-config' }, baixa: { status: 'sem-tarefa' } }),
        ]);
        expect(p.incompletos).toBe(1);
        expect(Object.keys(p.pendencias)).toHaveLength(2);
    });

    it('gestor fora da cópia é desvio da ordem técnica e aparece', () => {
        const p = montarPainelEnvios([envio({ copiaPara: ['outro@empresa.com'] })]);
        expect(p.semGestorEmCopia).toHaveLength(1);
        expect(montarPainelEnvios([envio()]).semGestorEmCopia).toHaveLength(0);
    });

    it('competência sem envio nenhum não é verde — é vazio', () => {
        const p = montarPainelEnvios([envio({ competencia: '2026-06' })], { competencia: '2026-07' });
        expect(p.total).toBe(0);
        expect(p.farol).toBe('vazio');
        expect(p.resumo).toMatch(/Nenhum imposto enviado/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ENVIO SEM REGISTRO DA ETAPA NÃO É ENVIO COMPLETO (22/08)
//
// `pendenciaSharePoint`/`pendenciaBaixa` devolvem **null** quando não há status
// gravado — e o painel lia esse null como "etapa cumprida". Resultado: o envio
// entrava em `completos` e o resumo afirmava *"todos completos (arquivados e
// com baixa)"*, uma afirmação que a rodada NUNCA estabeleceu.
//
// É a mesma família da conferência CFI × SPED que pulava o confronto de valor
// em silêncio: **ausência de alarme não pode ser indistinguível de "está tudo
// certo"**. Auditoria gravada antes do rito #293 existir cai exatamente aqui.
// ═══════════════════════════════════════════════════════════════════════════
/** Envio como a auditoria antiga gravou: sem o registro das etapas do rito. */
const semRito = (over: any = {}) => {
    const e: any = envio();
    delete e.sharePoint;
    delete e.baixa;
    // O override vem DEPOIS do delete — senão ele é apagado junto (pego pelo
    // próprio teste quando eu tentei manter só a baixa).
    return { ...e, ...over };
};

describe('🚨 não conferido ≠ completo', () => {
    it('envio sem registro das etapas NÃO entra em completos', () => {
        const p = montarPainelEnvios([envio(), semRito({ tipo: 'DARF' })], { competencia: '2026-07' });
        expect(p.total).toBe(2);
        expect(p.completos).toBe(1);
        expect(p.incompletos).toBe(0);
        expect(p.naoConferidos).toHaveLength(1);
    });

    it('e o resumo para de afirmar "todos completos"', () => {
        const p = montarPainelEnvios([envio(), semRito()], { competencia: '2026-07' });
        expect(p.resumo).not.toMatch(/todos completos/);
        expect(p.resumo).toMatch(/sem registro das etapas/);
        // Farol honesto: com envio que não dá para conferir, não é verde.
        expect(p.farol).toBe('atencao');
    });

    it('a linha diz QUAL etapa não tem registro', () => {
        const so = montarPainelEnvios([semRito({ baixa: { status: 'baixada' } })]);
        expect(so.naoConferidos[0]).toMatch(/sem registro de arquivamento/);
        expect(so.naoConferidos[0]).not.toMatch(/e baixa/);
    });

    // ⚠️ `sem-pdf` é desfecho LEGÍTIMO (envio sem anexo, como aviso de guia já
    // paga) — ele não pode virar "não conferido".
    it('sem-pdf continua contando como completo', () => {
        const p = montarPainelEnvios([envio({ sharePoint: { status: 'sem-pdf' } })]);
        expect(p.completos).toBe(1);
        expect(p.naoConferidos).toHaveLength(0);
        expect(p.farol).toBe('ok');
    });

    // Pendência de verdade continua sendo pendência, não "não conferido".
    it('pendência real não vira não-conferido', () => {
        const p = montarPainelEnvios([envio({ sharePoint: { status: 'sem-config' } })]);
        expect(p.incompletos).toBe(1);
        expect(p.naoConferidos).toHaveLength(0);
    });

    it('e a TELA mostra o bloco — flag que ninguém lê é a classe que isto fecha', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'components/EnviosImpostoPainel.tsx'), 'utf8',
        );
        expect(src).toContain('naoConferidos');
        expect(src).toMatch(/sem registro das etapas do rito/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 A BAIXA É DA OBRIGAÇÃO, O ARQUIVO É DO ENVIO
//
// 27/08, VINCENZO GUERRA BANANAS · 07/2026 (Paulo, com o print da lista de DAS
// ao lado: guia PAGA e ✉ ENVIADA em 12/08): *"ESSE FOI ENVIADO PELO SISTEMA,
// ELE TEM QUE ENTENDER"*. A Rotina dizia `3 envio(s), 1 completo(s) pelo rito`
// — os outros dois são o MESMO DAS indo de novo, e na segunda vez a baixa não
// acha tarefa PENDENTE (a primeira já concluiu), caindo em `sem-tarefa`, que é
// pendência de verdade.
// ════════════════════════════════════════════════════════════════════════════
describe('reenvio da mesma guia', () => {
    const das = (over: any = {}) => envio({ tipo: 'DAS', ...over });

    it('a baixa dada por um envio resolve a etapa para os irmãos da MESMA obrigação', () => {
        const rito = conferirRitoDosEnvios([
            das(),                                        // deu a baixa
            das({ baixa: { status: 'sem-tarefa' } }),      // reenvio
            das({ baixa: { status: 'sem-tarefa' } }),      // reenvio
        ]);
        expect(rito.every((r) => r.completo)).toBe(true);
        expect(rito.filter((r) => r.baixaJaFeitaNaObrigacao)).toHaveLength(2);
        // Quem deu a própria baixa NÃO é reenvio.
        expect(rito[0].baixaJaFeitaNaObrigacao).toBe(false);
    });

    it('⚠️ mas o ARQUIVO é de cada envio — SharePoint não se dissolve pelo irmão', () => {
        const rito = conferirRitoDosEnvios([
            das(),
            das({ baixa: { status: 'sem-tarefa' }, sharePoint: { status: 'sem-config' } }),
        ]);
        expect(rito[1].completo).toBe(false);
        expect(rito[1].pendencias.map((p: any) => p.causa)).toEqual(['Empresa sem pasta do SharePoint']);
        // A baixa saiu da lista (não há segunda baixa a dar), o arquivo ficou.
        expect(rito[1].baixaJaFeitaNaObrigacao).toBe(true);
    });

    it('obrigação DIFERENTE não é coberta — tipo e competência entram na chave', () => {
        const rito = conferirRitoDosEnvios([
            das(),
            das({ tipo: 'DARF', baixa: { status: 'sem-tarefa' } }),
            das({ competencia: '2026-06', baixa: { status: 'sem-tarefa' } }),
        ]);
        expect(rito.filter((r) => r.completo)).toHaveLength(1);
        expect(rito[1].pendencias).toHaveLength(1);
        expect(rito[2].pendencias).toHaveLength(1);
    });

    it('e a EMPRESA também — baixa de um cliente não fecha a do outro', () => {
        const rito = conferirRitoDosEnvios([
            das(),
            das({ empresaCnpj: '22222222000191', baixa: { status: 'sem-tarefa' } }),
        ]);
        expect(rito[1].completo).toBe(false);
    });

    it('o painel conta o reenvio À PARTE e DIZ na frase — 3 completos com 2 baixas que não existem confunde', () => {
        const p = montarPainelEnvios([
            das(),
            das({ baixa: { status: 'sem-tarefa' } }),
            das({ baixa: { status: 'sem-tarefa' } }),
        ], { competencia: '2026-07' });
        expect(p.completos).toBe(3);
        expect(p.incompletos).toBe(0);
        expect(p.reenvios).toBe(2);
        expect(p.farol).toBe('ok');
        expect(p.resumo).toMatch(/2 reenvio\(s\) da mesma guia/);
        // E a fila de trabalho não ganha "dê baixa manual" numa tarefa concluída.
        expect(Object.keys(p.pendencias)).toHaveLength(0);
    });
});
