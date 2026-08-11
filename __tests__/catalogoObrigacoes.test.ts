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
    it('prorroga vai pro próximo dia útil (segunda 22)', () => {
        const das = CATALOGO.SIMPLES.find((r: any) => r.obrigacao === 'DAS')!;
        const v = calcularVencimento('05/2026', das);
        expect(v.getDate()).toBe(22);
        expect(v.getMonth()).toBe(5); // junho
    });

    it('antecipa recua pro dia útil anterior (sexta 19)', () => {
        // Régua sintética: prova o MECANISMO sem afirmar prazo legal que ainda
        // não foi conferido com o Paulo/Alexandre.
        const regra = { diaVencimento: 20, mesesApos: 1, ajusteDiaNaoUtil: 'antecipa' as const };
        const v = calcularVencimento('05/2026', regra);
        expect(v.getDate()).toBe(19);
        expect(v.getMonth()).toBe(5);
    });

    it('a direção conflitante (FGTS) fica marcada pra conferência, não escondida', () => {
        const fgts = CATALOGO.SIMPLES.find((r: any) => r.obrigacao === 'FGTS')!;
        expect(fgts.revisar).toBe(true);
        expect(fgts.baseLegal).toMatch(/A CONFERIR/i);
        expect(pendenciasDeConfirmacao().map((p: any) => p.obrigacao)).toContain('FGTS');
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
        expect(cods).toContain('FGTS');                 // ativa, mas revisar (antecipa)
        expect(new Set(cods).size).toBe(cods.length);   // sem duplicata
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
