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
        expect(acharApuracaoDaCompetencia(emp, '2026-07'))
            .toEqual({ fonte: 'lucro', totalImpostos: 900, receita: 50000, receitaDeLocacao: 0 });
        expect(acharApuracaoDaCompetencia(emp, '2026-08')).toBeNull();
    });

    // 🏠 A LOCAÇÃO viaja junto porque a Rotina não tinha como saber que a
    // empresa é de aluguel puro — ela só via `faturamentoMesTotal`, e a
    // receita sem documento é indistinguível de "não capturou" nele.
    it('Lucro: a receita de LOCAÇÃO viaja junto, lida pelo dono do F550', () => {
        const emp = { fichaFinanceira: [{
            mesReferencia: '2026-07', totalImpostos: 1500,
            faturamentoMesTotal: 21811.34, faturamentoMesLocacao: 21811.34,
        }] };
        expect(acharApuracaoDaCompetencia(emp, '2026-07').receitaDeLocacao).toBe(21811.34);
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

    // ⚠️ CAUSA JUNTO DO NÚMERO: "veja em Envios (rito) o que ficou sem cópia ou
    // sem baixa" é "vá procurar" — e quem lê a Rotina está justamente tentando
    // saber o que falta.
    it('a ação NOMEIA a causa, não manda procurar', () => {
        const e = etapaDe(completo({ envios: [envio({ sharePoint: { status: 'sem-config' } })] }), 'guias');
        expect(e.acao).toMatch(/Empresa sem pasta do SharePoint/);
        expect(e.causas).toEqual(['Empresa sem pasta do SharePoint']);
    });

    it('envio sem registro das etapas sai DITO como tal, não como pendência inventada', () => {
        const e = etapaDe(completo({ envios: [{ tipo: 'DAS', competencia: '2026-07' }] }), 'guias');
        expect(e.status).toBe('atencao');
        expect(e.acao).toMatch(/sem registro das etapas do rito/);
    });

    // 🚨 27/08, VINCENZO GUERRA BANANAS · 07/2026 — Paulo, com o print da lista
    // de DAS ao lado (guia PAGA e ✉ ENVIADA em 12/08): *"ESSE FOI ENVIADO PELO
    // SISTEMA, ELE TEM QUE ENTENDER"*. A Rotina dizia `3 envio(s), 1
    // completo(s)`: os outros dois são o MESMO DAS indo de novo, e na segunda
    // vez a baixa não acha tarefa PENDENTE (a primeira já concluiu).
    it('REENVIO da mesma guia não trava a etapa — a baixa é da OBRIGAÇÃO', () => {
        const e = etapaDe(completo({
            envios: [
                envio(),
                envio({ baixa: { status: 'sem-tarefa' } }),
                envio({ baixa: { status: 'sem-tarefa' } }),
            ],
        }), 'guias');
        expect(e.status).toBe('concluida');
        // E o reenvio vai DITO: sem isso, quem contou 3 envios não entende por
        // que a linha fala de uma guia só.
        expect(e.resumo).toMatch(/2 reenvio\(s\) da mesma guia/);
        expect(e.reenvios).toBe(2);
    });

    it('⚠️ mas o ARQUIVO é de cada envio — reenvio sem cópia no SharePoint continua travando', () => {
        const e = etapaDe(completo({
            envios: [envio(), envio({ baixa: { status: 'sem-tarefa' }, sharePoint: { status: 'sem-config' } })],
        }), 'guias');
        expect(e.status).toBe('atencao');
        expect(e.acao).toMatch(/Empresa sem pasta do SharePoint/);
        // E a causa que NÃO existe mais não aparece na frase.
        expect(e.acao).not.toMatch(/Sem obrigação correspondente/);
    });

    it('guias DIFERENTES no mesmo mês continuam contando separado', () => {
        const e = etapaDe(completo({
            envios: [envio(), envio({ tipo: 'DARF', baixa: { status: 'sem-tarefa' } })],
        }), 'guias');
        expect(e.status).toBe('atencao');
        expect(e.acao).toMatch(/Sem obrigação correspondente/);
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
        expect(f.resumo).toMatch(/3 parada\(s\)/);
        // Nenhuma tem carimbo: a que não tem próximo passo está PRONTA, não
        // fechada. Os dois números existem porque as ações são opostas.
        expect(f.fechados).toBe(0);
        expect(f.prontos).toBe(1);
    });

    // 🚨 ESTE CONTADOR ERA DEDUÇÃO — leitura minha deixada para trás quando o
    // card parou de deduzir "mês fechado" em 26/08. Uma tela, duas leituras do
    // mesmo fato: exatamente o defeito que esta casa mais paga.
    it('"mês FECHADO" sai do CARIMBO, nunca de "não tem próximo passo"', () => {
        const f = resumirFunil([
            rotina('A', { fechamento: { estado: 'fechada' } }),
            rotina('B', {}),                                        // pronta, sem carimbo
            rotina('C', { fechamento: { estado: 'reaberta' } }),     // reaberta NÃO é fechada
            rotina('D', { documentos: [] }),                         // parada na captura
        ]);
        expect(f.fechados).toBe(1);
        expect(f.prontos).toBe(2);
        expect(f.completos).toBe(3);
        expect(f.resumo).toMatch(/1 de 4 empresa\(s\) com o mês FECHADO/);
        expect(f.resumo).toMatch(/2 pronta\(s\) para dar fim de mês/);
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

/**
 * A CARTA DE CORREÇÃO era capturada e NENHUM ponto da escrituração olhava pra
 * ela. Pelo Ajuste SINIEF 07/05 a CC-e corrige natureza da operação e CFOP — e
 * o CFOP manda no livro, no C190, no DIFAL e na DIPAM. O livro é gerado do XML
 * ORIGINAL: se o cliente corrigiu o CFOP, sai errado.
 */
describe('carta de correção na etapa de validação', () => {
    const cce = (xCorrecao: string) => ({ tipo: 'cce', tpEvento: '110110', xCorrecao });
    const comCce = (texto: string, over: any = {}) => completo({
        documentos: [
            doc({ numero: '77', eventos: [cce(texto)] }),
            doc({ direcao: 'saida', chave: CHAVE_55.replace(/1$/, '2') }),
        ],
        ...over,
    });

    it('CC-e de CFOP não deixa a validação fechar', () => {
        const r = comCce('CORRIGIR O CFOP DE 5102 PARA 5405');
        expect(etapaDe(r, 'validacao').status).toBe('atencao');
        expect(etapaDe(r, 'validacao').resumo).toMatch(/1 carta\(s\) de correção a conferir/);
        expect(etapaDe(r, 'validacao').acao).toMatch(/XML ORIGINAL/);
        expect(r.proximoPasso?.id).toBe('validacao');
    });

    it('CC-e que menciona VALOR é nomeada — ela não podia corrigir isso', () => {
        const r = comCce('Corrigir o valor total da nota');
        expect(etapaDe(r, 'validacao').resumo).toMatch(/1 mencionam algo que a CC-e não pode corrigir/);
    });

    it('CC-e de transportador NÃO trava — não mexe no livro', () => {
        const r = comCce('Incluir dados do transportador TRANSPORTES XYZ');
        expect(etapaDe(r, 'validacao').status).toBe('concluida');
        expect(r.proximoPasso).toBeNull();
    });

    it('o contador de CC-e vem no extra da etapa, mesmo quando não trava', () => {
        const r = comCce('Incluir dados do transportador');
        expect(etapaDe(r, 'validacao').cce.cces).toBe(1);
        expect(etapaDe(r, 'validacao').cce.exigemConferencia).toBe(0);
    });

    it('sem CC-e nenhuma, nada muda no comportamento antigo', () => {
        const r = completo();
        expect(etapaDe(r, 'validacao').status).toBe('concluida');
        expect(etapaDe(r, 'validacao').cce.cces).toBe(0);
    });
});

// ============================================================================
// 🔒 PÁGINA VIRADA — o carimbo do fim de mês VENCE as etapas
//
// Paulo, 27/08, com o print da AC MASON: *"empresa fechada, imposto enviado,
// página virada! Não pode ficar em vermelho"*.
//
// As cinco etapas são a PRÉ-CONDIÇÃO do ato (a decisão de BLOQUEAR, 26/08),
// mas elas continuam sendo RECALCULADAS a cada abertura da tela — e qualquer
// coisa que mude depois (tarefa reaberta, nota que chegou atrasada) devolvia a
// empresa ao vermelho num mês que a pessoa já entregou.
//
// Carimbo é FATO; etapa recalculada é DEDUÇÃO. Fato vence dedução.
// ============================================================================
describe('🔒 mês fechado não volta a cobrar', () => {
    it('com o carimbo, não há próximo passo e o farol é FECHADO', () => {
        const r = completo({ fechamento: { estado: 'fechada', fechadoPor: 'ana@x' } });
        expect(r.farol).toBe('fechado');
        expect(r.proximoPasso).toBeNull();
        // O carimbo volta na rotina — é dele que o bloco "Dar fim de mês" vive
        // (buscá-lo por card foi o HTTP 429 de 27/08).
        expect(r.fechamento).toEqual({ estado: 'fechada', fechadoPor: 'ana@x' });
    });

    it('etapa que reabriu DEPOIS do fechamento não devolve a empresa ao vermelho', () => {
        const r = completo({
            fechamento: { estado: 'fechada' },
            tarefas: [tarefa({ status: 'a_fazer', vencimento: '2026-07-20' })],
            envios: [],
        });
        // As etapas continuam DIZENDO o que mudou — o mês fechado não apaga o
        // fato, ele só para de COBRAR.
        expect(etapaDe(r, 'obrigacoes').status).toBe('pendente');
        expect(r.farol).toBe('fechado');
        expect(r.proximoPasso).toBeNull();
    });

    it('REABERTA não conta como fechada — a reabertura existe para permitir a edição', () => {
        const r = completo({ fechamento: { estado: 'reaberta' }, documentos: [] });
        expect(r.farol).toBe('pendente');
        expect(r.proximoPasso?.id).toBe('captura');
    });

    it('sem carimbo, as cinco etapas fechadas dão "pronto para fechar" (ok), não "fechado"', () => {
        expect(completo().farol).toBe('ok');
    });
});

// ============================================================================
// 🏠 ALUGUEL NÃO GERA NOTA — a cobrança impossível de resolver
//
// AC MASON (27/08): empresa de LOCAÇÃO pura aparecia com "nenhuma nota de
// SAÍDA" e "apuração sem lastro" TODO mês, sobre números certos. É a receita
// que o **F550** existe para declarar justamente porque não tem documento.
//
// É a família do `tipoTributacao` (26/08): alarme que a pessoa não consegue
// apagar ensina a equipe a ignorar o farol inteiro.
// ============================================================================
describe('🏠 receita de locação — sem documento por natureza', () => {
    const locacao = (over: any = {}) => completo({
        documentos: [],
        apuracao: { fonte: 'lucro', totalImpostos: 1500, receita: 21811.34, receitaDeLocacao: 21811.34 },
        ...over,
    });

    it('não cobra nota de saída de quem só tem aluguel', () => {
        const r = locacao();
        const cap = etapaDe(r, 'captura');
        expect(cap.status).toBe('na');
        expect(cap.resumo).toMatch(/LOCAÇÃO/);
        expect(cap.resumo).toMatch(/F550/);
        expect(cap.acao).toBeNull();
    });

    it('a validação não pede para validar nota que não existe', () => {
        expect(etapaDe(locacao(), 'validacao').status).toBe('na');
    });

    it('o lastro do imposto é a própria ficha — nem "sem lastro", nem "conferido"', () => {
        const lastro = etapaDe(locacao(), 'apuracao').lastro;
        expect(lastro.situacao).toBe('lastro-sem-documento');
        expect(lastro.cor).toBe('neutro');
        expect(etapaDe(locacao(), 'apuracao').status).toBe('concluida');
    });

    it('com aluguel E entrada capturada, a captura fecha dizendo as duas coisas', () => {
        const r = locacao({ documentos: [doc()] });
        const cap = etapaDe(r, 'captura');
        expect(cap.status).toBe('concluida');
        expect(cap.resumo).toMatch(/1 entrada\(s\)/);
        expect(cap.resumo).toMatch(/LOCAÇÃO/);
    });

    // ⚠️ A TRAVA: empresa que aluga E VENDE tem documento a capturar, e
    // exemplá-la silenciaria livro a menor — o erro caro.
    it('quem tem OUTRA receita além do aluguel continua sendo cobrado pela saída', () => {
        const r = completo({
            documentos: [doc()],
            apuracao: { fonte: 'lucro', totalImpostos: 1500, receita: 50000, receitaDeLocacao: 21811.34 },
        });
        expect(etapaDe(r, 'captura').status).toBe('atencao');
        expect(etapaDe(r, 'captura').resumo).toMatch(/nenhuma nota de SAÍDA/);
    });

    // ⚠️ Receita ILEGÍVEL não exime: ausência não é prova, e a dúvida cai para
    // o lado de continuar acendendo.
    it('receita ilegível NÃO exime — ausência não é prova', () => {
        const r = completo({
            documentos: [],
            apuracao: { fonte: 'lucro', totalImpostos: 1500, receita: null, receitaDeLocacao: 21811.34 },
        });
        expect(etapaDe(r, 'captura').status).toBe('pendente');
    });

    it('sem locação nenhuma, nada muda no comportamento antigo', () => {
        expect(etapaDe(completo({ documentos: [] }), 'captura').status).toBe('pendente');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📋 A PORTA DO ENVIO DECLARADO — ela resolve ESTE bloqueio?
//
// A saída nasce onde a trava aparece; mas onde o app JÁ enviou a guia e o que
// falta é o RITO, declarar outro envio não fecha nada e convida a declarar o
// que o app fez (Paulo, 27/08, VINCENZO).
// ════════════════════════════════════════════════════════════════════════════
describe('podeDeclararEnvio', () => {
    it('nenhuma guia enviada → declarar é a saída legítima', () => {
        expect(etapaDe(completo({ envios: [] }), 'guias').podeDeclararEnvio).toBe(true);
    });

    it('app enviou e o rito ficou pela metade → declarar NÃO resolve', () => {
        const e = etapaDe(completo({ envios: [envio({ sharePoint: { status: 'sem-config' } })] }), 'guias');
        expect(e.status).toBe('atencao');
        expect(e.podeDeclararEnvio).toBe(false);
    });

    it('ISS do município pendente → declarar volta a valer (o app não emite guia da PMSP)', () => {
        const e = etapaDe(completo({
            envios: [envio()],
            iss: { aplicavel: true, situacao: 'ok', aRecolher: 500, notas: 3 },
        }), 'guias');
        expect(e.status).toBe('atencao');
        expect(e.podeDeclararEnvio).toBe(true);
    });
});
