import {
    assertCompetencia,
    porEsfera,
    resolverRegime,
    obrigacoesAplicaveis,
    calcularVencimento,
    competenciaFechaTrimestre,
    competenciaFechaAno,
    mesDoCliente,
    pendenciasDeConfirmacao,
    CATALOGO,
} from '../sefaz-backend/catalogo-obrigacoes';

/**
 * O CATÁLOGO ÚNICO — a fonte de "o que este cliente deve neste mês".
 *
 * O defeito que ele corrige não era de cálculo: eram TRÊS listas que não
 * concordavam, e o cron que cria as tarefas do mês usava a mais pobre — nela
 * LUCRO PRESUMIDO não existia. Estes testes travam as duas coisas que não podem
 * voltar: Presumido existir, e ausência de regime NÃO virar um regime.
 */
const simples = { colecao: 'simples_empresas' };
const presumido = { colecao: 'lucro_empresas', regimePadrao: 'Presumido' };
const real = { colecao: 'lucro_empresas', regimePadrao: 'Real' };
const semRegime = { colecao: 'lucro_empresas' };

const codigos = (rs: any[]) => rs.map((r) => r.obrigacao).sort();

import { readFileSync } from 'fs';
import { join } from 'path';

describe('resolverRegime — regime nunca se adivinha', () => {
    it('a coleção do Simples JÁ é o regime', () => {
        expect(resolverRegime(simples)).toEqual({ regime: 'SIMPLES', motivo: null });
    });

    it('no Lucro, quem decide é o regimePadrao da ficha', () => {
        expect(resolverRegime(presumido).regime).toBe('LUCRO_PRESUMIDO');
        expect(resolverRegime(real).regime).toBe('LUCRO_REAL');
    });

    it('regimePadrao vazio NÃO vira Real nem Presumido — vira INDEFINIDO com motivo', () => {
        const r = resolverRegime(semRegime);
        expect(r.regime).toBe('INDEFINIDO');
        expect(r.motivo).toMatch(/Regime padrão/i);
    });

    it('aceita a grafia como a ficha grava (case-insensitive)', () => {
        expect(resolverRegime({ colecao: 'lucro_empresas', regimePadrao: 'presumido' }).regime)
            .toBe('LUCRO_PRESUMIDO');
    });
});

describe('o mês por regime', () => {
    // O defeito histórico: o cron mapeava lucro_empresas → LUCRO_REAL sempre.
    it('Presumido EXISTE e tem catálogo próprio', () => {
        expect(CATALOGO.LUCRO_PRESUMIDO.length).toBeGreaterThan(0);
        expect(codigos(CATALOGO.LUCRO_PRESUMIDO)).toContain('PIS_COFINS');
        expect(codigos(CATALOGO.LUCRO_PRESUMIDO)).toContain('EFD_CONTRIB');
        expect(codigos(CATALOGO.LUCRO_PRESUMIDO)).toContain('IRPJ_TRIM');
    });

    it('Simples não recebe obrigação do Lucro e vice-versa', () => {
        expect(codigos(CATALOGO.SIMPLES)).toContain('DAS');
        expect(codigos(CATALOGO.SIMPLES)).not.toContain('DCTFWEB');
        expect(codigos(CATALOGO.LUCRO_REAL)).not.toContain('DAS');
    });

    it('INDEFINIDO recebe só o que os dois regimes do Lucro têm em comum', () => {
        // Não fica vazio (apagaria o cliente do mês) nem recebe IRPJ/CSLL/ECF
        // (isso seria escolher um regime).
        expect(CATALOGO.INDEFINIDO.length).toBeGreaterThan(0);
        expect(codigos(CATALOGO.INDEFINIDO)).toContain('DCTFWEB');
        expect(codigos(CATALOGO.INDEFINIDO)).not.toContain('ECF');
    });
});

describe('frequência decide se a obrigação nasce no mês', () => {
    it('trimestral só em mar/jun/set/dez', () => {
        expect(competenciaFechaTrimestre('03/2026')).toBe(true);
        expect(competenciaFechaTrimestre('07/2026')).toBe(false);
        const jul = obrigacoesAplicaveis('LUCRO_PRESUMIDO', '07/2026', { incluirPropostas: true });
        const set = obrigacoesAplicaveis('LUCRO_PRESUMIDO', '09/2026', { incluirPropostas: true });
        expect(codigos(jul)).not.toContain('IRPJ_TRIM');
        expect(codigos(set)).toContain('IRPJ_TRIM');
    });

    it('anual só em dezembro', () => {
        expect(competenciaFechaAno('12/2026')).toBe(true);
        expect(codigos(obrigacoesAplicaveis('SIMPLES', '05/2026', { incluirPropostas: true })))
            .not.toContain('DEFIS');
        expect(codigos(obrigacoesAplicaveis('SIMPLES', '12/2026', { incluirPropostas: true })))
            .toContain('DEFIS');
    });

    it('competência inválida LANÇA — não devolve mês vazio em silêncio', () => {
        expect(() => obrigacoesAplicaveis('SIMPLES', '2026-05')).toThrow(/competencia invalida/i);
    });

    // Quem processa em LOTE (o cron do dia 1) valida UMA vez, na porta: sem
    // isso o erro se repetiria por cliente e viraria centenas de linhas de log,
    // com zero tarefa criada e nenhuma causa óbvia.
    it('assertCompetencia recusa na porta e diz o formato esperado', () => {
        expect(() => assertCompetencia('2026-05')).toThrow(/esperado MM\/AAAA/i);
        expect(() => assertCompetencia('13/2026')).toThrow(/competencia invalida/i);
        expect(assertCompetencia('07/2026')).toBe('07/2026');
    });
});

describe('prazo — a direção do ajuste é CAMPO da obrigação, não default do módulo', () => {
    // 20/06/2026 é SÁBADO. Os dois catálogos antigos ajustavam em direções
    // OPOSTAS (cron antecipava, tela prorrogava) e a mesma obrigação tinha duas
    // datas. Agora a direção é declarada por obrigação — e onde eles
    // discordavam ficou o que a TELA fazia, com a pendência nomeada.
    // POLÍTICA DECIDIDA PELO PAULO (11/08): "sempre antecipa". Segura por
    // construção — pagar no dia útil anterior nunca gera multa; o inverso, sim.
    it('dia não útil ANTECIPA pro dia útil anterior (sábado 20/06 → sexta 19)', () => {
        const das = CATALOGO.SIMPLES.find((r: any) => r.obrigacao === 'DAS')!;
        const v = calcularVencimento('05/2026', das);
        expect(v.getDate()).toBe(19);
        expect(v.getMonth()).toBe(5); // junho
    });

    it('a política vale para TODAS as obrigações — nenhuma ficou prorrogando', () => {
        for (const regime of Object.keys(CATALOGO)) {
            for (const r of (CATALOGO as any)[regime]) {
                expect(r.ajusteDiaNaoUtil).toBe('antecipa');
            }
        }
    });

    it('o mecanismo de prorrogar CONTINUA existindo (é campo, não constante)', () => {
        // Se um prazo específico exigir prorrogação, muda-se UMA linha — por
        // isso a direção segue sendo campo da obrigação e não default do módulo.
        const regra = { diaVencimento: 20, mesesApos: 1, ajusteDiaNaoUtil: 'prorroga' as const };
        expect(calcularVencimento('05/2026', regra).getDate()).toBe(22);
    });

    it('último dia útil RECUA (prorrogar cairia no mês seguinte = outro prazo)', () => {
        const irpj = CATALOGO.LUCRO_PRESUMIDO.find((r: any) => r.obrigacao === 'IRPJ_TRIM')!;
        // 1T/2026 (março) → último dia útil de abril. 30/04/2026 é quinta.
        const v = calcularVencimento('03/2026', irpj);
        expect(v.getMonth()).toBe(3); // abril — não maio
        expect(v.getDate()).toBe(30);
    });

    it('mesesApos atravessa o ano', () => {
        const sped = CATALOGO.LUCRO_REAL.find((r: any) => r.obrigacao === 'SPED')!;
        const v = calcularVencimento('11/2026', sped); // +2 meses = janeiro/2027
        expect(v.getFullYear()).toBe(2027);
        expect(v.getMonth()).toBe(0);
    });
});

describe('mesDoCliente — o farol do mês', () => {
    // O DEFEITO CENTRAL: o mês do Presumido nascia sem PIS/COFINS,
    // EFD-Contribuições e IRPJ/CSLL. A lista é da própria equipe, então ela GERA.
    it('o mês do Presumido nasce COMPLETO', () => {
        const geradas = codigos(mesDoCliente(presumido, '07/2026').obrigacoes);
        expect(geradas).toContain('DCTFWEB');
        expect(geradas).toContain('PIS_COFINS');
        expect(geradas).toContain('EFD_CONTRIB');
        expect(geradas).toContain('SPED');
    });

    it('obrigação que depende de condição não avaliável NÃO gera, mas é NOMEADA', () => {
        const m = mesDoCliente(presumido, '07/2026');
        // INSS patronal só existe com folha, e a folha mora no módulo de DP.
        expect(codigos(m.obrigacoes)).not.toContain('INSS_CPP');
        expect(codigos(m.propostas)).toContain('INSS_CPP');
        const alerta = m.alertas.find((a: any) => a.tipo === 'obrigacoes-a-confirmar')!;
        expect(alerta.texto).toMatch(/depende de folha/i);
    });

    it('cliente sem regime ACENDE e diz onde arrumar', () => {
        const m = mesDoCliente(semRegime, '07/2026');
        expect(m.regime).toBe('INDEFINIDO');
        const alerta = m.alertas.find((a: any) => a.tipo === 'regime-indefinido')!;
        expect(alerta).toBeTruthy();
        expect(alerta.acao).toMatch(/card Lucro/i);
    });

    it('cobertura incompleta trava o verde da etapa 4 (T1 do escopo)', () => {
        expect(mesDoCliente(semRegime, '07/2026').coberturaIncompleta).toBe(true);
        expect(mesDoCliente(presumido, '07/2026').coberturaIncompleta).toBe(true);
    });

    it('toda obrigação gerada sai COM vencimento calculado', () => {
        const m = mesDoCliente(simples, '07/2026');
        expect(m.obrigacoes.length).toBeGreaterThan(0);
        for (const o of m.obrigacoes) expect(o.vencimento instanceof Date).toBe(true);
    });
});

describe('pendenciasDeConfirmacao — o checklist que impede o "sync manual" de mentir', () => {
    it('lista as propostas e as que precisam de conferência de prazo, sem repetir', () => {
        const p = pendenciasDeConfirmacao();
        const cods = p.map((x: any) => x.obrigacao);
        expect(cods).toContain('INSS_CPP');             // proposta (depende de folha)
        expect(cods).toContain('ISS');                  // proposta (calendário municipal)
        // O FGTS do Lucro/Simples continua RESOLVIDO (direção decidida em
        // 11/08) e NÃO aparece. E ele também não entra pela IMUNE/ISENTA: Paulo,
        // 18/08, cortou essa entrada — "FGTS é um imposto gerado pelo
        // departamento pessoal, não faz base para impostos gerados pelo CFI".
        // Não existe hoje NENHUMA variante de FGTS pendente de confirmação.
        expect(cods).not.toContain('FGTS');
        // Sem duplicata: a chave é a REGRA (obrigação + status + condição +
        // frequência), senão variantes legítimas colapsariam numa linha só —
        // é o que passou a valer desde que imune/isenta ganharam lista própria.
        const chaves = p.map((x: any) => [x.obrigacao, x.status, x.dependeDe || '', x.frequencia].join('|'));
        expect(new Set(chaves).size).toBe(chaves.length);
        expect(cods).not.toContain('DAS');              // ativa e conferida
    });

    it('cada pendência diz em quais regimes cai e o que falta', () => {
        const p = pendenciasDeConfirmacao();
        for (const x of p as any[]) {
            expect(x.regimes.length).toBeGreaterThan(0);
            expect(typeof x.oQueFalta).toBe('string');
            expect(x.baseLegal).toBeTruthy();
        }
    });
});

describe('esfera — quem define o prazo é quem se consulta (Paulo, 11/08)', () => {
    it('toda obrigação declara esfera e até onde ela vale', () => {
        for (const regime of Object.keys(CATALOGO)) {
            for (const r of (CATALOGO as any)[regime]) {
                expect(['federal', 'estadual', 'municipal']).toContain(r.esfera);
                expect(r.abrangencia).toBeTruthy();
            }
        }
    });

    it('o SPED é ESTADUAL e o prazo cadastrado é o de SP — não finge valer no Brasil', () => {
        const sped = CATALOGO.LUCRO_REAL.find((r: any) => r.obrigacao === 'SPED')!;
        expect(sped.esfera).toBe('estadual');
        expect(sped.abrangencia).toBe('UF:SP');
    });

    it('o ISS é MUNICIPAL, não gera tarefa e aparece NOMEADO', () => {
        // Sem calendário do município não há prazo; carimbar o de SP seria
        // inventar. E optante do Simples não recolhe ISS próprio (está no DAS).
        const m = mesDoCliente(presumido, '07/2026');
        expect(codigos(m.obrigacoes)).not.toContain('ISS');
        expect(codigos(m.propostas)).toContain('ISS');
        const iss = CATALOGO.LUCRO_PRESUMIDO.find((r: any) => r.obrigacao === 'ISS')!;
        expect(iss.esfera).toBe('municipal');
        expect(iss.dependeDe).toMatch(/munic/i);
    });

    it('porEsfera separa como o órgão publica', () => {
        const e = porEsfera('LUCRO_PRESUMIDO', '07/2026', { incluirPropostas: true });
        expect(e.federal.map((r: any) => r.obrigacao)).toContain('DCTFWEB');
        expect(e.estadual.map((r: any) => r.obrigacao)).toContain('SPED');
        expect(e.municipal.map((r: any) => r.obrigacao)).toContain('ISS');
    });

    it('a pendência diz a esfera — é ela que aponta ONDE conferir', () => {
        const iss = pendenciasDeConfirmacao().find((p: any) => p.obrigacao === 'ISS')!;
        expect(iss.esfera).toBe('municipal');
    });
});

describe('toda entrada do catálogo é completa — campo fiscal não recebe default', () => {
    it('tem código, label, frequência, base legal e direção do ajuste', () => {
        for (const regime of Object.keys(CATALOGO)) {
            for (const r of (CATALOGO as any)[regime]) {
                expect(r.obrigacao).toBeTruthy();
                expect(r.label).toBeTruthy();
                expect(['mensal', 'trimestral', 'anual']).toContain(r.frequencia);
                expect(['prorroga', 'antecipa']).toContain(r.ajusteDiaNaoUtil);
                expect(r.baseLegal).toBeTruthy();
                expect(['ativa', 'proposta']).toContain(r.status);
            }
        }
    });
});

// ═══ A TRAVA T1 DO ESCOPO — escrita desde 11/08, aplicada só em 15/08 ═══════
//
// `mesDoCliente` devolve `coberturaIncompleta` com o comentário dizendo "a
// etapa 4 não pode dar verde nesse caso". A flag existia e NINGUÉM lia: regra
// escrita sem trava é regra que envelhece em silêncio — a mesma família do
// selo das Novidades apagado por onze dias.
describe('🚨 o catálogo admitir que não cobre o cliente TRAVA a etapa 4', () => {
    const { montarRotinaFiscal } = require('../sefaz-backend/rotina-fiscal.js');
    const { mesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');

    const rodar = (cobertura: any) => montarRotinaFiscal({
        empresa: { id: 'e1', nome: 'X', cnpj: '11222333000181' },
        competencia: '2026-06',
        documentos: [{ direcao: 'entrada' }, { direcao: 'saida' }],
        // Tudo entregue: sem a trava, esta etapa fecharia VERDE.
        tarefas: [{ obrigacao: 'DAS', status: 'concluida' }],
        cobertura,
    }).etapas.find((e: any) => e.id === 'obrigacoes');

    it('sem a flag, a etapa fecha normalmente', () => {
        expect(rodar(null).status).toBe('concluida');
    });

    it('o SIMPLES não é travado à toa — optante não recolhe ISS próprio', () => {
        // Alarme onde não há nada a fazer é o que ensina a ignorar o farol:
        // o ISS do optante já está dentro do DAS (LC 123 art. 13).
        const cob = mesDoCliente({ colecao: 'simples_empresas' }, '06/2026');
        expect(cob.coberturaIncompleta).toBe(false);
        expect(rodar(cob).status).toBe('concluida');
    });

    it('obrigação PROPOSTA impede o verde e DIZ de qual se trata', () => {
        // Lucro Presumido COM regime definido: isola a causa "proposta".
        // (O Simples NÃO entra aqui, e está certo: optante não recolhe ISS
        //  próprio — ele vai no DAS, LC 123 art. 13.)
        const cob = mesDoCliente({ colecao: 'lucro_empresas', regimePadrao: 'presumido' }, '06/2026');
        expect(cob.regime).toBe('LUCRO_PRESUMIDO');
        expect(cob.coberturaIncompleta).toBe(true); // ISS (município) e INSS patronal (folha)
        const e = rodar(cob);
        expect(e.status).toBe('atencao');
        expect(e.resumo).toMatch(/catálogo NÃO cobre/);
        expect(e.acao).toMatch(/NÃO viram tarefa automática/);
    });

    it('regime INDEFINIDO trava e manda ao lugar onde se resolve', () => {
        // Lucro sem `regimePadrao`: recebe só o comum aos dois regimes.
        const cob = mesDoCliente({ colecao: 'lucro_empresas' }, '06/2026');
        const e = rodar(cob);
        expect(e.status).toBe('atencao');
        expect(e.regimeIndefinido).toBe(true);
        // As DUAS causas aparecem, porque têm AÇÕES diferentes.
        expect(e.acao).toMatch(/Regime padrão/);
        expect(e.acao).toMatch(/NÃO viram tarefa automática/);
    });

    it('a rota entrega a cobertura e o checklist — função sem tela é código morto', () => {
        const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/rotina-fiscal-routes.js'), 'utf8');
        expect(rota).toMatch(/cobertura: coberturaDoCliente/);
        // 🚨 A Rotina fala 'AAAA-MM' e o catálogo fala 'MM/AAAA'. Passar direto
        // explodia — defeito meu, pego por este teste antes de subir. E a falha
        // não pode derrubar o painel da carteira inteira.
        expect(rota).toMatch(/\$\{mes\}\/\$\{ano\}/);
        expect(rota).toMatch(/catch \(err\)/);
        expect(rota).toMatch(/catalogoPendencias: pendenciasDeConfirmacao\(\)/);
        const tela = readFileSync(join(__dirname, '..', 'components/RotinaFiscalPainel.tsx'), 'utf8');
        expect(tela).toMatch(/catalogoPendencias/);
    });
});

// ═══ ABRANGÊNCIA: o campo existia e NUNCA era aplicado ══════════════════════
//
// O comentário no topo do catálogo já dizia *"o app prefere dizer 'não sei o
// prazo deste município' a carimbar o de SP"* — e era o contrário que
// acontecia: o prazo do SPED (UF:SP, CAT 147/2009) ia para TODO cliente do
// Lucro, morasse ele onde morasse. Prazo errado entregue com confiança é o erro
// mais caro deste app, porque quem lê não tem como desconfiar.
describe('🚨 prazo ESTADUAL só vale para a UF dele', () => {
    const { mesDoCliente, alcanceDaObrigacao } = require('../sefaz-backend/catalogo-obrigacoes.js');
    const lucro = (uf?: string) =>
        mesDoCliente({ colecao: 'lucro_empresas', regimePadrao: 'presumido', uf }, '06/2026');

    it('cliente de SP recebe o prazo de SP normalmente', () => {
        const m = lucro('SP');
        expect(m.prazoDeOutraUf).toHaveLength(0);
        expect(m.prazoSemUfDoCliente).toHaveLength(0);
    });

    it('cliente do PARANÁ é AVISADO de que a data na tela é a de SP', () => {
        const m = lucro('PR');
        expect(m.prazoDeOutraUf.length).toBeGreaterThan(0);
        expect(m.prazoDeOutraUf[0].abrangencia).toBe('UF:SP');
        expect(m.coberturaIncompleta).toBe(true);
        const a = m.alertas.find((x: any) => x.tipo === 'prazo-de-outra-uf');
        expect(a.texto).toMatch(/este cliente é de PR/i);
        expect(a.acao).toMatch(/SEFAZ do estado do cliente/);
    });

    it('🚨 sem UF cadastrada NÃO se afirma nada — nem "é de SP", nem "não é"', () => {
        // Assumir SP carimbaria o prazo paulista em quem talvez não seja;
        // assumir o contrário faria a obrigação sumir de quem tem ela.
        expect(alcanceDaObrigacao({ abrangencia: 'UF:SP' }, {})).toBe('uf-desconhecida');
        const m = lucro('');
        expect(m.prazoSemUfDoCliente.length).toBeGreaterThan(0);
        expect(m.coberturaIncompleta).toBe(true);
        expect(m.alertas.find((x: any) => x.tipo === 'uf-do-cliente-ausente').acao)
            .toMatch(/Preencha a UF/);
    });

    it('obrigação FEDERAL não é afetada por UF nenhuma', () => {
        expect(alcanceDaObrigacao({ abrangencia: 'BR' }, { uf: 'PR' })).toBe('aplica');
        expect(alcanceDaObrigacao({}, { uf: 'PR' })).toBe('aplica');
    });

    it('a Rotina põe o prazo de outra UF na FRENTE — é a causa mais perigosa', () => {
        // A data ESTÁ na tela e parece certa. As outras causas (regime
        // indefinido, obrigação proposta) o colaborador percebe; esta não.
        const { montarRotinaFiscal } = require('../sefaz-backend/rotina-fiscal.js');
        const e = montarRotinaFiscal({
            empresa: { id: 'e1', nome: 'X', cnpj: '11222333000181' },
            competencia: '2026-06',
            documentos: [{ direcao: 'entrada' }, { direcao: 'saida' }],
            tarefas: [{ obrigacao: 'DCTFWeb', status: 'concluida' }],
            cobertura: lucro('PR'),
        }).etapas.find((x: any) => x.id === 'obrigacoes');
        expect(e.status).toBe('atencao');
        expect(e.resumo).toMatch(/prazo cadastrado de OUTRA UF/);
        expect(e.acao).toMatch(/a de SP/);
        expect(e.prazoDeOutraUf.length).toBeGreaterThan(0);
    });

    // 🐛 ESTA TRAVA PRENDIA A FORMA, NÃO A INTENÇÃO — e reprovou a correção que
    // a régua mandava fazer (27/08). Ela exigia o texto
    // `uf: d.dadosFiscais?.uf || d.uf` DENTRO de `rotina-fiscal-routes.js`; a
    // leitura mudou de casa para o módulo PURO `rotina-empresa-insumo.js`
    // (rota não carrega no jest — régua dentro de rota é régua sem prova), e o
    // teste quebrou com o código CERTO. É a família do `IND_REG_CUM` e do
    // `cfopPorNota`: teste que trava a FONTE impede a correção.
    //
    // Agora ela pergunta pelo COMPORTAMENTO — o dono do insumo entrega a UF,
    // nas duas formas em que ela é gravada — e só o repasse à régua continua
    // sendo conferido no texto da rota.
    it('a UF do cliente chega à régua — sem ela o prazo estadual não vale', () => {
        const { empresaDaRotina } = require('../sefaz-backend/rotina-empresa-insumo.js');
        const base = { cnpj: '11222333000181' };
        expect(empresaDaRotina('e1', 'lucro_empresas', { ...base, dadosFiscais: { uf: 'PR' } }).uf).toBe('PR');
        expect(empresaDaRotina('e1', 'lucro_empresas', { ...base, uf: 'MG' }).uf).toBe('MG');
        // Sem UF cadastrada NÃO se inventa: é a `uf-desconhecida`, que acende.
        expect(empresaDaRotina('e1', 'lucro_empresas', base).uf).toBe('');

        const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/rotina-fiscal-routes.js'), 'utf8');
        expect(rota).toMatch(/uf: e\.uf/);
    });
});
