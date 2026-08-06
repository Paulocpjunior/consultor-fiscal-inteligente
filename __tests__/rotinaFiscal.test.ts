/**
 * A ROTINA FISCAL como trilho (Paulo, 28/07/2026: "o colaborador não está
 * seguindo uma linha de processo: captura notas, valida as nfs, cálculo de
 * impostos, entrega de obrigações e emissão de guias").
 *
 * Regras que este teste protege:
 *  - a ordem é fixa e o PRÓXIMO PASSO é sempre a primeira etapa não fechada
 *    (etapa adiantada não "pula" a anterior);
 *  - cada etapa nasce de dado REAL — nada aqui se marca como feito na mão;
 *  - farol honesto: sem tarefa não é sucesso, envio pela metade não é sucesso,
 *    mês pela metade não é mês fechado.
 */
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal, resumirFunil, ehResumoSemCompleta, acharApuracaoDaCompetencia, ETAPAS_ROTINA } from '../sefaz-backend/rotina-fiscal.js';

const CHAVE_55 = '3526' + '07'.padEnd(2, '0') + '1'.repeat(14) + '55' + '1'.repeat(22);
const CHAVE_57 = '3526' + '07'.padEnd(2, '0') + '1'.repeat(14) + '57' + '1'.repeat(22);

const doc = (over: any = {}) => ({
    chave: CHAVE_55, direcao: 'entrada', competencia: '2026-07',
    valorTotal: 100, temItens: true, schema: 'procNFe', status: 'autorizado', ...over,
});
const tarefa = (over: any = {}) => ({ obrigacao: 'DCTFWEB', competencia: '07/2026', status: 'a_fazer', ...over });
const envio = (over: any = {}) => ({
    tipo: 'DAS', competencia: '2026-07',
    sharePoint: { status: 'arquivado' }, baixa: { status: 'baixada' }, ...over,
});

/** Cenário "mês fechado": as cinco etapas com prova. */
const completo = (over: any = {}) => montarRotinaFiscal({
    empresa: { nome: 'CLIENTE LTDA', cnpj: '11111111000191' },
    competencia: '2026-07',
    documentos: [doc(), doc({ direcao: 'saida', chave: CHAVE_55.replace(/1$/, '2') })],
    apuracao: { fonte: 'simples', totalImpostos: 1234.56 },
    tarefas: [tarefa({ status: 'concluida' })],
    envios: [envio()],
    ...over,
});

const etapaDe = (r: any, id: string) => r.etapas.find((e: any) => e.id === id);

describe('a linha do processo', () => {
    it('tem as cinco etapas, sempre na mesma ordem', () => {
        expect(ETAPAS_ROTINA.map((e: any) => e.id))
            .toEqual(['captura', 'validacao', 'apuracao', 'obrigacoes', 'guias']);
        expect(completo().etapas.map((e: any) => e.id))
            .toEqual(['captura', 'validacao', 'apuracao', 'obrigacoes', 'guias']);
    });

    it('mês inteiro provado → farol ok e sem próximo passo', () => {
        const r = completo();
        expect(r.farol).toBe('ok');
        expect(r.proximoPasso).toBeNull();
        expect(r.progresso).toEqual({ concluidas: 5, total: 5 });
    });

    it('PRÓXIMO PASSO é a primeira etapa não fechada — etapa adiantada não pula a anterior', () => {
        // Guia enviada e obrigação entregue, mas nada capturado: a linha volta
        // pro começo. É o erro que o colaborador vinha cometendo.
        const r = completo({ documentos: [] });
        expect(r.proximoPasso.id).toBe('captura');
        expect(etapaDe(r, 'guias').status).toBe('concluida');
        expect(r.farol).toBe('pendente');
    });

    it('cada etapa pendente sai com a AÇÃO, não só com o problema', () => {
        const r = montarRotinaFiscal({
            empresa: { nome: 'X' }, competencia: '2026-07',
            documentos: [], apuracao: null, tarefas: [], envios: [],
        });
        for (const e of r.etapas) {
            if (e.status !== 'concluida' && e.status !== 'na') expect(String(e.acao || '')).not.toHaveLength(0);
        }
    });
});

describe('1. captura', () => {
    it('sem nota nenhuma é pendente e aponta o Diagnóstico', () => {
        const e = etapaDe(completo({ documentos: [] }), 'captura');
        expect(e.status).toBe('pendente');
        expect(e.acao).toMatch(/Diagnóstico/);
    });

    it('empresa fora da captura automática recebe outra ação (é cadastro, não trilho)', () => {
        const e = etapaDe(completo({ documentos: [], capturaAtiva: false }), 'captura');
        expect(e.acao).toMatch(/Status por Empresa/);
    });

    it('só entradas = atenção: saída mod 55 depende do cofre/autXML (Rejeição 641)', () => {
        const r = completo({ documentos: [doc(), doc({ chave: CHAVE_55 + 'x' })] });
        const e = etapaDe(r, 'captura');
        expect(e.status).toBe('atencao');
        expect(e.acao).toMatch(/cofre de e-mail ou pelo autXML/);
        expect(r.proximoPasso.id).toBe('captura');
    });
});

describe('2. validação', () => {
    it('resumo sem a completa trava a linha (apuração sairia a menor)', () => {
        const r = completo({
            documentos: [doc({ direcao: 'saida' }), doc({ schema: 'resNFe', temItens: false, valorTotal: null })],
        });
        const e = etapaDe(r, 'validacao');
        expect(e.status).toBe('atencao');
        expect(e.resumos).toBe(1);
        expect(e.acao).toMatch(/ciência/i);
        expect(r.proximoPasso.id).toBe('validacao');
    });

    it('CTe completa NÃO é resumo — modelo 57 nunca tem itens', () => {
        expect(ehResumoSemCompleta({ chave: CHAVE_57, temItens: false, valorTotal: 500, schema: 'procCTe' })).toBe(false);
        expect(ehResumoSemCompleta({ chave: CHAVE_55, temItens: false, valorTotal: 500 })).toBe(true);
        expect(ehResumoSemCompleta({ chave: CHAVE_55, temItens: true, valorTotal: null })).toBe(true);
    });

    it('cancelada não é pendência de validação, mas aparece no resumo', () => {
        const r = completo({
            documentos: [doc({ direcao: 'saida' }), doc({ status: 'cancelado', valorTotal: null })],
        });
        const e = etapaDe(r, 'validacao');
        expect(e.status).toBe('concluida');
        expect(e.canceladas).toBe(1);
        expect(e.resumo).toMatch(/cancelada/);
    });
});

describe('3. apuração', () => {
    it('sem ficha da competência é pendente e manda abrir a ficha', () => {
        const r = completo({ apuracao: null });
        expect(etapaDe(r, 'apuracao').status).toBe('pendente');
        expect(r.proximoPasso.id).toBe('apuracao');
    });

    it('com ficha mostra o total apurado', () => {
        const e = etapaDe(completo(), 'apuracao');
        expect(e.status).toBe('concluida');
        expect(e.resumo).toMatch(/1\.234,56/);
    });
});

describe('3b. de onde vem a prova da apuração', () => {
    it('Lucro: a ficha do mês, com o total apurado', () => {
        const emp = { fichaFinanceira: [{ mesReferencia: '2026-07', totalImpostos: 900, faturamentoMesTotal: 50000 }] };
        expect(acharApuracaoDaCompetencia(emp, '2026-07')).toEqual({ fonte: 'lucro', totalImpostos: 900, receita: 50000 });
        expect(acharApuracaoDaCompetencia(emp, '2026-08')).toBeNull();
    });

    it('Simples: o faturamento lançado do mês (o histórico de cálculo não é gravado por tela nenhuma)', () => {
        const emp = { faturamentoManual: { '2026-07': 12000 } };
        expect(acharApuracaoDaCompetencia(emp, '2026-07')).toMatchObject({ fonte: 'simples', receita: 12000 });
        expect(acharApuracaoDaCompetencia(emp, '2026-06')).toBeNull();
    });

    it('Simples com faturamento ZERO conta como apurado e sem imposto a pagar', () => {
        const a = acharApuracaoDaCompetencia({ faturamentoManual: { '2026-07': 0 } }, '2026-07');
        expect(a.totalImpostos).toBe(0);
        // …e por isso a etapa da guia não vira pendência falsa.
        const r = completo({ apuracao: a, envios: [] });
        expect(etapaDe(r, 'guias').status).toBe('na');
    });

    it('Simples detalhado usa a chave MM-AAAA (formato legado da tela)', () => {
        const emp = { faturamentoMensalDetalhado: { '07-2026': { x: 1 } } };
        expect(acharApuracaoDaCompetencia(emp, '2026-07')).toMatchObject({ fonte: 'simples-detalhado' });
    });

    it('competência malformada não inventa apuração', () => {
        expect(acharApuracaoDaCompetencia({ faturamentoManual: { '2026-07': 1 } }, '07/2026')).toBeNull();
        expect(acharApuracaoDaCompetencia(null, '2026-07')).toBeNull();
    });
});

describe('4. obrigações', () => {
    it('ZERO tarefa NÃO é sucesso — é o cron mensal que não gerou', () => {
        // Regressão do julho/2026: tarefas-cron-mensal falhou e a competência
        // ficava "sem pendência", parecendo entregue.
        const r = completo({ tarefas: [] });
        const e = etapaDe(r, 'obrigacoes');
        expect(e.status).toBe('atencao');
        expect(e.acao).toMatch(/geração mensal/i);
        expect(r.farol).not.toBe('ok');
        expect(r.proximoPasso.id).toBe('obrigacoes');
    });

    it('obrigação em aberto lista NOMINALMENTE o que falta', () => {
        const e = etapaDe(completo({
            tarefas: [tarefa({ obrigacao: 'DCTFWEB', status: 'concluida' }), tarefa({ obrigacao: 'SPED_FISCAL' })],
        }), 'obrigacoes');
        expect(e.status).toBe('pendente');
        expect(e.acao).toMatch(/SPED_FISCAL/);
        expect(e.resumo).toMatch(/1\/2/);
    });

    it('compra de produtor rural aparece na etapa de obrigações (é lá que a DIPAM é entregue)', () => {
        const e = etapaDe(completo({ dipam: { produtores: 3, indefinidos: 0 } }), 'obrigacoes');
        expect(e.status).toBe('concluida');       // não rebaixa o que já fechou
        expect(e.resumo).toMatch(/DIPAM: 3 compra/);
    });

    it('fornecedor de produtor rural a confirmar NÃO deixa a etapa fechar', () => {
        const r = completo({ dipam: { produtores: 2, indefinidos: 1 } });
        const e = etapaDe(r, 'obrigacoes');
        expect(e.status).toBe('atencao');
        expect(e.acao).toMatch(/DIPAM/);
        expect(e.total).toBe(1);                  // conta das tarefas preservada
        expect(r.farol).not.toBe('ok');
        expect(r.proximoPasso.id).toBe('obrigacoes');
    });

    it('sem compra de produtor, nada muda na etapa', () => {
        expect(etapaDe(completo({ dipam: { produtores: 0, indefinidos: 0 } }), 'obrigacoes').resumo)
            .not.toMatch(/DIPAM/);
    });

    it('cancelada não conta como pendente nem como entregue', () => {
        const e = etapaDe(completo({
            tarefas: [tarefa({ status: 'concluida' }), tarefa({ obrigacao: 'EFD_REINF', status: 'cancelada' })],
        }), 'obrigacoes');
        expect(e.status).toBe('concluida');
        expect(e.concluidas).toBe(1);
    });
});

describe('5. guias (rito #293)', () => {
    it('nenhum envio é pendente', () => {
        const r = completo({ envios: [] });
        expect(etapaDe(r, 'guias').status).toBe('pendente');
        expect(r.proximoPasso.id).toBe('guias');
    });

    it('envio sem cópia no SharePoint ou sem baixa NÃO fecha a etapa', () => {
        const semSp = etapaDe(completo({ envios: [envio({ sharePoint: { status: 'sem-config' } })] }), 'guias');
        expect(semSp.status).toBe('atencao');
        const semBaixa = etapaDe(completo({ envios: [envio({ baixa: { status: 'sem-tarefa' } })] }), 'guias');
        expect(semBaixa.status).toBe('atencao');
        expect(semBaixa.acao).toMatch(/Envios \(rito\)/);
    });

    it('apuração zerada não cobra guia — mas só quando a apuração existe', () => {
        const naoSeAplica = completo({ envios: [], apuracao: { totalImpostos: 0 } });
        expect(etapaDe(naoSeAplica, 'guias').status).toBe('na');
        expect(naoSeAplica.proximoPasso).toBeNull();
        expect(naoSeAplica.farol).toBe('ok');
        // Sem apuração NENHUMA a guia continua pendente (não é "zerada", é "não apurada").
        expect(etapaDe(completo({ envios: [], apuracao: null }), 'guias').status).toBe('pendente');
    });
});

describe('funil da carteira', () => {
    const rotina = (nome: string, over: any) => completo({ empresa: { nome }, ...over });

    it('agrupa cada empresa pela etapa em que está parada', () => {
        const f = resumirFunil([
            rotina('A', { documentos: [] }),
            rotina('B', { documentos: [] }),
            rotina('C', { apuracao: null }),
            rotina('D', {}),
        ]);
        expect(f.total).toBe(4);
        expect(f.completos).toBe(1);
        const porId = Object.fromEntries(f.etapas.map((e: any) => [e.id, e.qtd]));
        expect(porId.captura).toBe(2);
        expect(porId.apuracao).toBe(1);
        expect(f.etapas.find((e: any) => e.id === 'captura').empresas).toEqual(['A', 'B']);
        expect(f.resumo).toMatch(/3 paradas/);
    });

    it('carteira vazia não vira "tudo certo"', () => {
        expect(resumirFunil([]).resumo).toMatch(/Nenhuma empresa/);
        expect(resumirFunil([]).completos).toBe(0);
    });
});

/**
 * A rotina nasceu CEGA pro ISS — e a onda 1 da migração são 157 empresas de
 * SERVIÇO PURO, justamente as que NÃO fecham o mês no DAS. Empresa de SP
 * capital devendo ISS aparecia com "✓ Mês fechado".
 *
 * O ISS entra em três etapas diferentes, cada uma pelo motivo dela: captura
 * (sem CCM a varredura nem roda), validação (nota com ISS zerado é conferência)
 * e guias (ISS próprio e ISS retido são DUAS guias, nenhuma delas é o DAS).
 */
describe('ISS de SP capital dentro da linha', () => {
    const iss = (over: any = {}) => ({
        aplicavel: true, situacao: 'a-recolher', notas: 4, aRecolher: 0,
        issForaDoTotal: 0, tomadoRetido: 0, tomadoNotas: 0, acao: null, ...over,
    });

    it('empresa fora de SP capital não muda em NADA (sem ISS, sem pendência inventada)', () => {
        const semIss = completo();
        const comNull = completo({ iss: null });
        expect(comNull.farol).toBe(semIss.farol);
        expect(comNull.proximoPasso).toBeNull();
        expect(comNull.iss).toBeNull();
    });

    it('ISS próprio a recolher IMPEDE o "mês fechado" — é guia do município, não o DAS', () => {
        const r = completo({ iss: iss({ aRecolher: 1520.33 }) });
        expect(r.proximoPasso?.id).toBe('guias');
        expect(etapaDe(r, 'guias').status).toBe('atencao');
        expect(etapaDe(r, 'guias').resumo).toMatch(/ISS próprio/);
        expect(etapaDe(r, 'guias').acao).toMatch(/portal da PMSP/);
        expect(r.iss.pendencias).toHaveLength(1);
    });

    it('ISS RETIDO como tomadora é OUTRA guia e aparece com o nome dela', () => {
        const r = completo({ iss: iss({ situacao: 'so-tomado', notas: 0, tomadoRetido: 800, tomadoNotas: 3 }) });
        expect(etapaDe(r, 'guias').resumo).toMatch(/ISS RETIDO de 3 prestador\(es\)/);
        expect(r.iss.pendencias).toHaveLength(1);
    });

    it('as duas guias fecham SEPARADAS — envio do próprio não quita o retido', () => {
        const r = completo({
            iss: iss({ aRecolher: 100, tomadoRetido: 800, tomadoNotas: 2 }),
            envios: [envio(), envio({ tipo: 'ISS' })],
        });
        expect(r.iss.proprioEnviado).toBe(true);
        expect(r.iss.retidoEnviado).toBe(false);
        expect(r.iss.pendencias).toEqual([expect.stringMatching(/ISS RETIDO/)]);
        expect(etapaDe(r, 'guias').status).toBe('atencao');
    });

    it('com as duas guias registradas pelo rito, o mês fecha', () => {
        const r = completo({
            iss: iss({ aRecolher: 100, tomadoRetido: 800, tomadoNotas: 2 }),
            envios: [envio(), envio({ tipo: 'ISS' }), envio({ tipo: 'ISS-RETIDO' })],
        });
        expect(r.iss.pendencias).toEqual([]);
        expect(r.proximoPasso).toBeNull();
    });

    it('apuração sem imposto a pagar NÃO libera a etapa quando há ISS — o "na" seria mentira', () => {
        const r = completo({
            apuracao: { fonte: 'simples', totalImpostos: 0 },
            envios: [],
            iss: iss({ aRecolher: 340 }),
        });
        expect(etapaDe(r, 'guias').status).not.toBe('na');
        expect(etapaDe(r, 'guias').resumo).toMatch(/ISS próprio/);
        expect(r.proximoPasso?.id).toBe('guias');
    });

    it('sem CCM a captura NÃO fica verde só porque a NFe entrou (#311)', () => {
        const r = completo({ iss: iss({ situacao: 'sem-ccm', notas: 0 }) });
        const e = etapaDe(r, 'captura');
        expect(e.status).toBe('atencao');
        expect(e.resumo).toMatch(/sem CCM/);
        expect(e.acao).toMatch(/Cadastre o CCM/);
        expect(r.proximoPasso?.id).toBe('captura');
    });

    it('captura de NFS-e incerta trava a etapa 1 com o motivo', () => {
        const r = completo({ iss: iss({ situacao: 'captura-incerta', notas: 0, acao: 'Rode a captura.' }) });
        expect(etapaDe(r, 'captura').status).toBe('atencao');
        expect(etapaDe(r, 'captura').acao).toMatch(/Rode a captura\./);
    });

    it('NFS-e com ISS zerado é conferência de VALIDAÇÃO, nunca silêncio', () => {
        const r = completo({ iss: iss({ situacao: 'iss-zerado', notas: 29 }) });
        expect(etapaDe(r, 'validacao').status).toBe('atencao');
        expect(etapaDe(r, 'validacao').resumo).toMatch(/29 NFS-e emitida\(s\) com o ISS ZERADO/);
    });

    it('etapa já vermelha não vira âmbar por causa do ISS', () => {
        const r = completo({ documentos: [], iss: iss({ situacao: 'sem-ccm' }) });
        expect(etapaDe(r, 'captura').status).toBe('pendente');
        expect(etapaDe(r, 'captura').resumo).toMatch(/sem CCM/);
    });

    it('optante do Simples: ISS dentro do DAS não vira pendência de guia', () => {
        // A régua de quem tem guia do município é do núcleo do ISS: aqui chega
        // com aRecolher zerado e o valor em `issForaDoTotal`.
        const r = completo({ iss: iss({ situacao: 'iss-no-das', aRecolher: 0, issForaDoTotal: 940 }) });
        expect(r.iss.pendencias).toEqual([]);
        expect(r.iss.foraDoTotal).toBe(940);
        expect(r.proximoPasso).toBeNull();
    });
});
