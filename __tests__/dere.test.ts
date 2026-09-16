// ============================================================================
// 🏦 DeRE — Declaração de Regimes Específicos (IBS/CBS/IS)
//
// Paulo, 02/09: *"crie uma nova função capaz de atender esta obrigação chamada
// DERE"* e, à tarde, *"vou te mandar o layout e os manuais aqui em pdf, onde
// podemos visualizar no CFI"*. O que estes testes travam: QUEM está (só o
// cadastro afirma; o CNAE sugere; o LEIAUTE decide quem cabe), QUANDO vence
// (dia 15 do mês seguinte, antecipado — a 1ª competência é 10/2026 e vence
// 13/11/2026 porque 15/11 é domingo e 14 é sábado), QUAIS eventos existem (os
// do leiaute 1.1.0 + os que a 1.2.0 INCLUIU, entre eles o D-1121), as réguas de FORMA do Anexo II (Id, recibo,
// protocolo) e que a obrigação entra no MÊS do cliente pelo catálogo — sem
// acender a carteira inteira e sem tocar em quem é do Simples.
// ============================================================================
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
    CATALOGO, mesDoCliente, obrigacoesAplicaveis, obrigacoesDoCliente,
    pendenciasDeConfirmacao, compararCompetencias, OBRIGACAO_DERE,
} from '../sefaz-backend/catalogo-obrigacoes';
import {
    REGIMES_ESPECIFICOS_IBS_CBS, ATIVIDADES_DERE, FONTES_DERE, decidirDereNoCadastro, sinalDeCnaeParaDere,
    validarRegimeEspecificoParaGravacao, raizDoCnpj,
} from '../sefaz-backend/dere-regimes';
import {
    VIGENCIA_DERE, EVENTOS_DERE, CRONOGRAMA_DERE, INTEGRACAO_DERE, DOCUMENTOS_DERE, DOCUMENTOS_DERE_FALTANDO,
    XSD_DERE, xsdFaltando,
    eventosDaCompetencia, prazoDere, situacaoDere, triarCarteiraDere,
    montarIdEventoDere, lerIdEventoDere, lerRecibo, lerProtocolo,
    arredondarDere, dvChaveDere, montarChaveDere, lerChaveDere,
} from '../sefaz-backend/dere';

const RAIZ = join(__dirname, '..');
const presumido = (extra: any = {}) => ({ colecao: 'lucro_empresas', regimePadrao: 'Presumido', ...extra });
const codigos = (rs: any[]) => rs.map((r) => r.obrigacao);

describe('o vocabulário — a LC 214/2025 lista os regimes; o LEIAUTE 1.1.0 diz quais cabem', () => {
    it('todo regime tem código, rótulo, base legal, dereConfirmada e codigoD1001 coerentes', () => {
        for (const r of REGIMES_ESPECIFICOS_IBS_CBS) {
            expect(r.codigo).toMatch(/^[A-Z_]+$/);
            expect(r.rotulo).toBeTruthy();
            expect(r.baseLegal).toBeTruthy();
            expect(typeof r.dereConfirmada).toBe('boolean');
            // "Confirmada" É "tem código no D-1001" — as duas colunas não podem discordar.
            expect(r.dereConfirmada).toBe(r.codigoD1001 != null);
        }
    });

    it('D-1001 {regTribPrinc}: 1 serviços financeiros · 2 planos de saúde · 3 concursos de prognósticos — e mais nenhum', () => {
        const porCodigo = Object.fromEntries(REGIMES_ESPECIFICOS_IBS_CBS.map((r) => [r.codigo, r.codigoD1001]));
        expect(porCodigo.SERVICOS_FINANCEIROS).toBe(1);
        expect(porCodigo.PLANOS_SAUDE).toBe(2);
        expect(porCodigo.CONCURSOS_PROGNOSTICOS).toBe(3);
        const conf = REGIMES_ESPECIFICOS_IBS_CBS.filter((r) => r.dereConfirmada).map((r) => r.codigo).sort();
        expect(conf).toEqual(['CONCURSOS_PROGNOSTICOS', 'PLANOS_SAUDE', 'SERVICOS_FINANCEIROS']);
        // Só regime com código carrega sinal de CNAE — senão a fila encheria de
        // posto de gasolina e imobiliária por um regime que a DeRE não recebe.
        for (const r of REGIMES_ESPECIFICOS_IBS_CBS) {
            if (!r.dereConfirmada) expect(r.cnaes).toHaveLength(0);
        }
    });

    it('as Tabelas 21/31/41 (atividades do D-1001) existem por regime com código, em máscara NNC', () => {
        expect(Object.keys(ATIVIDADES_DERE).sort()).toEqual(['CONCURSOS_PROGNOSTICOS', 'PLANOS_SAUDE', 'SERVICOS_FINANCEIROS']);
        for (const lista of Object.values(ATIVIDADES_DERE)) {
            expect(lista.length).toBeGreaterThan(0);
            for (const [cod, desc] of lista) { expect(cod).toMatch(/^\d{2}[A-Z]$/); expect(desc).toBeTruthy(); }
            expect(new Set(lista.map(([c]) => c)).size).toBe(lista.length);
        }
        // A 1.1.0 desdobrou o leasing (06A/06B) e os arranjos de pagamento (09F/09Z).
        const fin = ATIVIDADES_DERE.SERVICOS_FINANCEIROS.map(([c]) => c);
        expect(fin).toEqual(expect.arrayContaining(['06A', '06B', '09F', '09Z', '17A']));
    });

    it('as fontes dizem o que foi LIDO e o que continua por resumo', () => {
        expect(FONTES_DERE.LEIAUTES_1_1_0).toMatch(/LIDOS/);
        // A 1.2.0 (16/09) veio pela METADE, e a fonte diz qual metade: histórico + Anexo II + XSD
        // lidos; leiaute campo a campo (02) e Anexo I (03) NÃO recebidos.
        expect(FONTES_DERE.LEIAUTES_1_2_0).toMatch(/05\/09\/2026/);
        expect(FONTES_DERE.LEIAUTES_1_2_0).toMatch(/LIDOS/);
        expect(FONTES_DERE.LEIAUTES_1_2_0).toMatch(/NÃO foram recebidos/);
        expect(FONTES_DERE.MANUAL_DEV_1_0_2).toMatch(/LIDO/);
        expect(FONTES_DERE.ATO_CONJUNTO_4).toMatch(/resumo de terceiros/);
        expect(FONTES_DERE.MOD_1_0_1).toMatch(/NÃO RECEBIDO/);
    });

    it('gravação: fora do vocabulário é RECUSA com a lista; vazio limpa; NENHUM grava', () => {
        expect(validarRegimeEspecificoParaGravacao('')).toEqual({ ok: true, codigo: null });
        expect(validarRegimeEspecificoParaGravacao(null)).toEqual({ ok: true, codigo: null });
        expect(validarRegimeEspecificoParaGravacao('nenhum')).toEqual({ ok: true, codigo: 'NENHUM' });
        expect(validarRegimeEspecificoParaGravacao('servicos_financeiros').codigo).toBe('SERVICOS_FINANCEIROS');
        const r = validarRegimeEspecificoParaGravacao('BANCO');
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/SERVICOS_FINANCEIROS/);
    });

    it('CNAE: banco (6422) e plano de saúde (6550) sugerem; corretora de seguros (6622) e comércio NÃO', () => {
        expect(sinalDeCnaeParaDere('6422-1/00')?.regime).toBe('SERVICOS_FINANCEIROS');
        expect(sinalDeCnaeParaDere('6550-2/00')?.regime).toBe('PLANOS_SAUDE');
        expect(sinalDeCnaeParaDere('9200-3/01')?.regime).toBe('CONCURSOS_PROGNOSTICOS');
        expect(sinalDeCnaeParaDere('6622-3/00')).toBeNull();
        expect(sinalDeCnaeParaDere('4712-1/00')).toBeNull();
        expect(sinalDeCnaeParaDere('')).toBeNull();
    });

    it('a declaração é por RAIZ: {nrInsc} tem 8 posições', () => {
        expect(raizDoCnpj('11.222.333/0001-81')).toBe('11222333');
        expect(raizDoCnpj('11222333000262')).toBe('11222333');
        expect(raizDoCnpj('123')).toBeNull();
        expect(raizDoCnpj(null)).toBeNull();
        // O XSD define {nrInsc} como [0-9A-Z]{8}: CNPJ alfanumérico (desde 07/2026) conta as letras, em MAIÚSCULAS.
        expect(raizDoCnpj('12.ABC.345/0001-99')).toBe('12ABC345');
        expect(raizDoCnpj('12abc345000199')).toBe('12ABC345');
    });
});

describe('decidirDereNoCadastro — o cadastro decide, o CNAE sugere, o silêncio não acusa', () => {
    it('Simples fica FORA mesmo com regime marcado', () => {
        const v = decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, { regimeCatalogo: 'SIMPLES' });
        expect(v.decisao).toBe('dispensada-simples');
    });

    it('regime com código no D-1001 ⇒ obrigada, e o código viaja (lê as DUAS formas)', () => {
        const a = decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'PLANOS_SAUDE' }, { regimeCatalogo: 'LUCRO_REAL' });
        expect(a.decisao).toBe('obrigada');
        expect(a.codigoD1001).toBe(2);
        expect(decidirDereNoCadastro({ dadosFiscais: { regimeEspecificoIbsCbs: 'PLANOS_SAUDE' } }, { regimeCatalogo: 'LUCRO_REAL' }).decisao).toBe('obrigada');
    });

    it('NENHUM ⇒ não se aplica; regime sem grupo no D-1001 ⇒ fora do leiaute, DITO, sem mandar ao manual', () => {
        expect(decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'NENHUM' }, { regimeCatalogo: 'LUCRO_PRESUMIDO' }).decisao).toBe('nao-se-aplica');
        const v = decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'BENS_IMOVEIS' }, { regimeCatalogo: 'LUCRO_PRESUMIDO' });
        expect(v.decisao).toBe('regime-fora-do-leiaute');
        expect(v.codigoD1001).toBeNull();
        expect(v.motivo).toMatch(/regTribPrinc/);
        expect(v.acao).toMatch(/Nada a entregar/);
        // "Não confirmado" era a frase de manhã, antes de ler a fonte — o leiaute
        // fechou a pergunta, e a frase não pode voltar a afirmar dúvida.
        expect(v.motivo).not.toMatch(/não confirmado/i);
    });

    it('sem cadastro: CNAE de banco vira CANDIDATA; CNAE de comércio vira sem-sinal (nunca alarme)', () => {
        const cand = decidirDereNoCadastro({ cnae: '6422-1/00' }, { regimeCatalogo: 'LUCRO_REAL' });
        expect(cand.decisao).toBe('candidata');
        expect(cand.motivo).toMatch(/SUGESTÃO/);
        expect(cand.acao).toMatch(/Dados Fiscais/);
        const nada = decidirDereNoCadastro({ cnae: '4712-1/00' }, { regimeCatalogo: 'LUCRO_REAL' });
        expect(nada.decisao).toBe('sem-sinal');
        // Ausência não é prova — a frase diz que o app não afirma que está fora.
        expect(nada.motivo).toMatch(/NÃO afirma/);
    });
});

describe('o catálogo — a DeRE entra no mês pelo cadastro, com vencimento, a partir de 10/2026', () => {
    it('está no Lucro (Presumido e Real), na imune/isenta e no INDEFINIDO — nunca no Simples', () => {
        expect(codigos(CATALOGO.LUCRO_PRESUMIDO)).toContain('DERE');
        expect(codigos(CATALOGO.LUCRO_REAL)).toContain('DERE');
        expect(codigos(CATALOGO.IMUNE)).toContain('DERE');
        expect(codigos(CATALOGO.INDEFINIDO)).toContain('DERE');
        expect(codigos(CATALOGO.SIMPLES)).not.toContain('DERE');
    });

    it('nasce PROPOSTA, federal, mensal, dia 15 do mês seguinte, antecipa, com vigência 10/2026', () => {
        expect(OBRIGACAO_DERE.status).toBe('proposta');
        expect(OBRIGACAO_DERE.esfera).toBe('federal');
        expect(OBRIGACAO_DERE.diaVencimento).toBe(15);
        expect(OBRIGACAO_DERE.mesesApos).toBe(1);
        expect(OBRIGACAO_DERE.ajusteDiaNaoUtil).toBe('antecipa');
        expect(OBRIGACAO_DERE.vigenciaDesde).toBe('10/2026');
        expect(OBRIGACAO_DERE.baseLegal).toMatch(/LC 214\/2025/);
        expect(OBRIGACAO_DERE.baseLegal).toMatch(/Ato Conjunto RFB\/CGIBS/);
    });

    it('antes da vigência a entrada NÃO nasce — nem como proposta', () => {
        expect(compararCompetencias('09/2026', '10/2026')).toBeLessThan(0);
        expect(codigos(obrigacoesAplicaveis('LUCRO_REAL', '09/2026', { incluirPropostas: true }))).not.toContain('DERE');
        expect(codigos(obrigacoesAplicaveis('LUCRO_REAL', '10/2026', { incluirPropostas: true }))).toContain('DERE');
        expect(codigos(obrigacoesAplicaveis('LUCRO_REAL', '10/2026'))).not.toContain('DERE'); // proposta: o cron não cria
        // O mês de 06/2026 do Presumido não muda em NADA por causa da DeRE.
        expect(mesDoCliente(presumido(), '06/2026').dere).toBeNull();
    });

    it('cadastro afirma regime obrigado ⇒ vira obrigação ATIVA com vencimento 13/11/2026 para 10/2026', () => {
        const m = mesDoCliente(presumido({ regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }), '10/2026');
        const dere = m.obrigacoes.find((o: any) => o.obrigacao === 'DERE') as any;
        expect(dere).toBeTruthy();
        expect(dere.status).toBe('ativa');
        expect(dere.regimeEspecifico).toBe('SERVICOS_FINANCEIROS');
        // 15/11/2026 é DOMINGO (e feriado); 14 é sábado ⇒ antecipa para sexta 13.
        expect(dere.vencimento.getFullYear()).toBe(2026);
        expect(dere.vencimento.getMonth()).toBe(10);
        expect(dere.vencimento.getDate()).toBe(13);
        expect(codigos(m.propostas)).not.toContain('DERE');
        expect(m.dere?.decisao).toBe('obrigada');
        expect(m.dere?.codigoD1001).toBe(1);
    });

    it('cadastro diz NENHUM ⇒ sai das pendências e NÃO piora a cobertura por causa dela', () => {
        const com = mesDoCliente(presumido({ regimeEspecificoIbsCbs: 'NENHUM' }), '10/2026');
        expect(codigos(com.obrigacoes)).not.toContain('DERE');
        expect(codigos(com.propostas)).not.toContain('DERE');
        expect(com.dere?.decisao).toBe('nao-se-aplica');
    });

    it('🚨 regime FORA do leiaute NÃO é pendência — não há o que entregar, e cobrar seria alarme sem saída', () => {
        const m = mesDoCliente(presumido({ regimeEspecificoIbsCbs: 'BENS_IMOVEIS' }), '10/2026');
        expect(codigos(m.obrigacoes)).not.toContain('DERE');
        expect(codigos(m.propostas)).not.toContain('DERE');
        expect(m.dere?.decisao).toBe('regime-fora-do-leiaute');
        const alerta = m.alertas.find((a: any) => a.tipo === 'obrigacoes-a-confirmar');
        expect(alerta?.texto || '').not.toMatch(/DeRE/);
    });

    it('🚨 sem cadastro e sem sinal de CNAE NÃO vira pendência — a carteira não acende', () => {
        const m = mesDoCliente(presumido({ cnae: '4712-1/00' }), '10/2026');
        expect(codigos(m.propostas)).not.toContain('DERE');
        expect(m.dere?.decisao).toBe('sem-sinal');
        // O texto do alerta de "a confirmar" não cita a DeRE para quem não tem sinal.
        const alerta = m.alertas.find((a: any) => a.tipo === 'obrigacoes-a-confirmar');
        expect(alerta?.texto || '').not.toMatch(/DeRE/);
    });

    it('CNAE de banco sem cadastro ⇒ pendência NOMEADA com o motivo específico (não o genérico)', () => {
        const m = mesDoCliente(presumido({ cnae: '6422-1/00' }), '10/2026');
        const p = m.propostas.find((r: any) => r.obrigacao === 'DERE') as any;
        expect(p).toBeTruthy();
        expect(p.dependeDe).toMatch(/CNAE 64221/);
        expect(m.coberturaIncompleta).toBe(true);
        const alerta = m.alertas.find((a: any) => a.tipo === 'obrigacoes-a-confirmar')!;
        expect(alerta.texto).toMatch(/DeRE/);
    });

    it('Simples nunca recebe a DeRE, mesmo com o regime marcado', () => {
        const m = mesDoCliente({ colecao: 'simples_empresas', regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, '10/2026');
        expect(codigos(m.obrigacoes)).not.toContain('DERE');
        expect(codigos(m.propostas)).not.toContain('DERE');
    });

    it('obrigacoesDoCliente leva o cadastro e o CNAE até o mês (o auto-gerar da tela de Tarefas)', () => {
        const m = obrigacoesDoCliente('LUCRO_REAL_SERVICOS', '10/2026', { regimeEspecificoIbsCbs: 'PLANOS_SAUDE' });
        expect(codigos(m.obrigacoes)).toContain('DERE');
    });

    it('a DeRE aparece no checklist de confirmação, com a fonte', () => {
        const p = pendenciasDeConfirmacao().find((x: any) => x.obrigacao === 'DERE')!;
        expect(p).toBeTruthy();
        expect(p.regimes).toContain('LUCRO_REAL');
        expect(p.baseLegal).toMatch(/Ato Conjunto/);
    });
});

describe('dere.js — os eventos do LEIAUTE 1.1.0, cronograma, prazo e a situação de um cliente', () => {
    it('vigência e cronograma batem com o Ato Conjunto 4/2026', () => {
        expect(VIGENCIA_DERE).toBe('10/2026');
        expect(CRONOGRAMA_DERE.map((m) => m.dataIso)).toEqual(['2026-10-01', '2026-11-15', '2027-01-01']);
    });

    it('eventos: os do sumário da 1.1.0 continuam TODOS, e os que a 1.2.0 INCLUIU estão na seção 3.1 do histórico dela', () => {
        expect(EVENTOS_DERE.filter((e) => e.grupo === 'tabela').map((e) => e.codigo)).toEqual(['D-1001', 'D-1011']);
        expect(EVENTOS_DERE.filter((e) => e.grupo === 'mensal').map((e) => e.codigo).sort())
            .toEqual(['D-1101', 'D-1106', 'D-1121', 'D-1198', 'D-1199', 'D-2101']);
        expect(EVENTOS_DERE.filter((e) => e.grupo === 'transacional').map((e) => e.codigo))
            .toEqual(['D-2201', 'D-2202', 'D-2211', 'D-2221', 'D-2231', 'D-2241', 'D-2242', 'D-2251', 'D-3201', 'D-4201']);
        expect(EVENTOS_DERE.filter((e) => e.grupo === 'retorno').map((e) => e.codigo).sort())
            .toEqual(['D-9001', 'D-9101', 'D-9106', 'D-9112', 'D-9121', 'D-9198', 'D-9199', 'D-9209']);
        // 02/09 este teste exigia "D-1121 NÃO existe" — verdade para a 1.1.0. A
        // 1.2.0 (05/09) o INCLUIU; a asserção mudou porque a FONTE mudou, e é a
        // fonte que prova: todo evento ou está no sumário da 1.1.0 ou na lista de
        // inclusões da 1.2.0 (seção 3.1 do histórico). Nenhum entra por memória.
        const sumario110 = readFileSync(join(RAIZ, 'docs/dere/02-leiautes-eventos-v1.1.0.txt'), 'utf8').toUpperCase();
        const hist120 = readFileSync(join(RAIZ, 'docs/dere/05-historico-de-versoes-v1.2.0.txt'), 'utf8');
        const inclusoes120 = hist120.slice(hist120.indexOf('3.1 Inclusão de Novos Eventos', hist120.indexOf('===== PÁGINA 6')), hist120.indexOf('3.2 Evento D-1011', hist120.indexOf('===== PÁGINA 6')));
        for (const e of EVENTOS_DERE) {
            const na110 = sumario110.includes(`EVENTO ${e.codigo}`);
            const na120 = new RegExp(`${e.codigo} – .*\\n?.*INCLUSÃO`).test(inclusoes120) || inclusoes120.includes(`${e.codigo} – `);
            expect({ codigo: e.codigo, naFonte: na110 || na120 }).toEqual({ codigo: e.codigo, naFonte: true });
            // E o que a 1.1.0 NÃO tinha está marcado como inclusão da 1.2.0 — não o contrário.
            if (!na110) expect({ codigo: e.codigo, incluidoNa120: na120 }).toEqual({ codigo: e.codigo, incluidoNa120: true });
        }
        // Os transacionais são PRELIMINARES (Histórico 2.1.a) e o app não os cobra.
        for (const e of EVENTOS_DERE.filter((k) => k.grupo === 'transacional')) expect(e.preliminar).toBe(true);
        const ev = eventosDaCompetencia('10/2026');
        expect(ev.mensais.map((e) => e.codigo)).not.toContain('D-1198');
        expect(ev.eventuais.map((e) => e.codigo)).toEqual(['D-1198']);
        expect(ev.transacionais).toHaveLength(10);
        expect(eventosDaCompetencia('09/2026').mensais).toHaveLength(0);
    });

    it('D-1106, D-2101 e D-1121 são CONDICIONAIS ao codTrib do PGCC — com os códigos LIDOS do Anexo II 1.2.0', () => {
        const porCodigo = Object.fromEntries(EVENTOS_DERE.map((e) => [e.codigo, e]));
        expect(porCodigo['D-1106'].condicional?.codTribs).toEqual(['120130001', '120230001', '120330001', '111112701']);
        expect(porCodigo['D-2101'].condicional?.codTribs).toEqual(['110113001', '110113002']);
        // Os 34 códigos do D-1121 saem da RN do Anexo II 1.2.0 — a tabela do módulo
        // é provada contra o TEXTO da fonte, nunca digitada de memória.
        const anexo = readFileSync(join(RAIZ, 'docs/dere/04-anexo-ii-regras-de-validacao-v1.2.0.txt'), 'utf8');
        const bloco = anexo.slice(anexo.indexOf('Evento D-1121: \n['), anexo.indexOf('Evento D-2101: \n['));
        const daFonte = bloco.match(/\d{9}/g) ?? [];
        expect(daFonte).toHaveLength(34);
        expect([...(porCodigo['D-1121'].condicional?.codTribs ?? [])].sort()).toEqual([...daFonte].sort());
        expect(porCodigo['D-1121'].condicional?.texto).toMatch(/indInexistDedu/);
        expect(porCodigo['D-1198'].eventual).toBe(true);
        expect(porCodigo['D-1101'].condicional).toBeUndefined();
        expect(porCodigo['D-1199'].nota).toMatch(/INCLUSÃO/);
        expect(porCodigo['D-1199'].nota).toMatch(/REABERTURA/);
        expect(porCodigo['D-1199'].nota).toMatch(/D-1198/);
    });

    it('prazoDere: null antes da vigência; 13/11/2026 para 10/2026; 15/12/2026 (terça) para 11/2026', () => {
        expect(prazoDere('09/2026')).toBeNull();
        expect(prazoDere('10/2026')?.getDate()).toBe(13);
        const dez = prazoDere('11/2026')!;
        expect(dez.getMonth()).toBe(11);
        expect(dez.getDate()).toBe(15);
    });

    it('situacaoDere: obrigada antes da vigência sai como ainda-nao-vigente, traz a RAIZ e DIZ que o app não entrega', () => {
        const s = situacaoDere({ cnpj: '11222333000181', regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, '09/2026', { regimeCatalogo: 'LUCRO_REAL' });
        expect(s.situacao).toBe('ainda-nao-vigente');
        expect(s.prazo).toBeNull();
        expect(s.raiz).toBe('11222333');
        const t = situacaoDere({ regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, '10/2026', { regimeCatalogo: 'LUCRO_REAL' });
        expect(t.situacao).toBe('obrigada');
        expect(t.prazoTexto).toBe('13/11/2026');
        expect(t.entregaPeloApp).toBe(false);
        expect(t.ressalvaEntrega).toMatch(/NÃO gera nem transmite/);
        expect(t.ressalvaEntrega).toMatch(/XSD/);
    });

    it('triarCarteiraDere separa as filas, agrupa as obrigadas por RAIZ e CONTA o que ficou de fora', () => {
        const r = triarCarteiraDere([
            { id: 'a', cnpj: '11222333000181', nome: 'BANCO X', regimeTributario: 'LUCRO_REAL', cnae: '6422100', regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' },
            { id: 'a2', cnpj: '11222333000262', nome: 'BANCO X FILIAL', regimeTributario: 'LUCRO_REAL', cnae: '6422100', regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' },
            { id: 'b', cnpj: '22333444000199', nome: 'PLANO Y', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '6550200', regimeEspecificoIbsCbs: null },
            { id: 'c', cnpj: '33444555000188', nome: 'IMOBILIARIA Z', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '6810201', regimeEspecificoIbsCbs: 'BENS_IMOVEIS' },
            { id: 'd', cnpj: '44555666000177', nome: 'PADARIA', regimeTributario: 'SIMPLES', cnae: '4721102', regimeEspecificoIbsCbs: null },
            { id: 'e', cnpj: '55666777000166', nome: 'COMERCIO', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '4712100', regimeEspecificoIbsCbs: 'NENHUM' },
            { id: 'f', cnpj: '66777888000155', nome: 'SERVICO', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '6201500', regimeEspecificoIbsCbs: null },
        ], '10/2026');
        expect(r.obrigadas.map((l) => l.nome)).toEqual(['BANCO X', 'BANCO X FILIAL']);
        expect(r.obrigadas[0].prazoTexto).toBe('13/11/2026');
        expect(r.obrigadas[0].codigoD1001).toBe(1);
        // Duas linhas, UMA declaração: matriz e filial são a mesma raiz.
        expect(r.declaracoes).toHaveLength(1);
        expect(r.declaracoes[0].raiz).toBe('11222333');
        expect(r.declaracoes[0].estabelecimentos.map((e) => e.nome)).toEqual(['BANCO X', 'BANCO X FILIAL']);
        expect(r.declaracoes[0].regimesDivergem).toBe(false);
        expect(r.candidatas.map((l) => l.nome)).toEqual(['PLANO Y']);
        expect(r.foraDoLeiaute.map((l) => l.nome)).toEqual(['IMOBILIARIA Z']);
        expect(r.naoSeAplica.map((l) => l.nome)).toEqual(['COMERCIO']);
        expect(r.resumo).toEqual({
            total: 7, obrigadas: 2, declaracoes: 1, obrigadasSemRaiz: 0, candidatas: 1, foraDoLeiaute: 1,
            naoSeAplica: 1, dispensadasSimples: 1, semSinal: 1,
        });
        expect(r.ressalvas.join(' ')).toMatch(/NÃO gera nem transmite/);
        expect(r.ressalvas.join(' ')).toMatch(/CNPJ RAIZ/);
        expect(r.documentos).toBe(DOCUMENTOS_DERE);
        expect(r.integracao).toBe(INTEGRACAO_DERE);
    });

    it('raiz com regimes específicos DIFERENTES entre estabelecimentos ACENDE — o app não escolhe', () => {
        const r = triarCarteiraDere([
            { id: 'a', cnpj: '11222333000181', nome: 'M', regimeTributario: 'LUCRO_REAL', regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' },
            { id: 'b', cnpj: '11222333000262', nome: 'F', regimeTributario: 'LUCRO_REAL', regimeEspecificoIbsCbs: 'PLANOS_SAUDE' },
            { id: 'c', cnpj: 'xx', nome: 'TORTA', regimeTributario: 'LUCRO_REAL', regimeEspecificoIbsCbs: 'PLANOS_SAUDE' },
        ], '10/2026');
        expect(r.declaracoes).toHaveLength(1);
        expect(r.declaracoes[0].regimesDivergem).toBe(true);
        expect(r.obrigadasSemRaiz.map((l) => l.nome)).toEqual(['TORTA']);
        expect(r.resumo.obrigadas).toBe(3);
        expect(r.resumo.declaracoes).toBe(1);
        expect(r.resumo.obrigadasSemRaiz).toBe(1);
    });
});

describe('Anexo II — as réguas de FORMA (Id, recibo, protocolo): o app confere, não inventa', () => {
    it('Id do evento: 42 caracteres, DeRE+NNNN+1+CNPJ(14)+AAAAMMDD+HHMMSS(Brasília)+QQQQQ', () => {
        // 2026-11-10 02:30:00 UTC = 09/11/2026 23:30:00 em Brasília — se alguém ler
        // o dia em UTC, o Id nasce com a data errada e a unicidade some.
        const r = montarIdEventoDere({ codigoEvento: 'D-1101', cnpj: '11.222.333/0001-81', data: new Date('2026-11-10T02:30:00Z'), sequencial: 7 });
        expect(r.ok).toBe(true);
        expect(r.id).toBe('DeRE11011112223330001812026110923300000007');
        expect(r.id).toHaveLength(42);
        const lido = lerIdEventoDere(r.id) as any;
        expect(lido.ok).toBe(true);
        expect(lido.evento).toBe('D-1101');
        expect(lido.cnpj).toBe('11222333000181');
        expect(lido.geradoEm).toBe('2026-11-09T23:30:00-03:00');
        expect(lido.sequencial).toBe(7);
    });

    it('Id: evento inexistente, CNPJ torto, data ilegível e sequencial fora da faixa são RECUSAS nomeadas', () => {
        const d = new Date('2026-11-10T12:00:00Z');
        // 1121 existe desde a 1.2.0 — quem NÃO existe é o 1122.
        expect(montarIdEventoDere({ codigoEvento: 'D-1121', cnpj: '11222333000181', data: d }).ok).toBe(true);
        expect(montarIdEventoDere({ codigoEvento: 'D-1122', cnpj: '11222333000181', data: d }).motivo).toMatch(/não existe no leiaute 1\.2\.0/);
        expect(montarIdEventoDere({ codigoEvento: 'D-1101', cnpj: '', data: d }).motivo).toMatch(/CNPJ/);
        expect(montarIdEventoDere({ codigoEvento: 'D-1101', cnpj: '11222333000181', data: new Date('x') }).motivo).toMatch(/Data/);
        expect(montarIdEventoDere({ codigoEvento: 'D-1101', cnpj: '11222333000181', data: d, sequencial: 0 }).motivo).toMatch(/Sequencial/);
        expect((lerIdEventoDere('DeRE11211112223330001812026110923300000007') as any).evento).toBe('D-1121');
        expect((lerIdEventoDere('DeRE11221112223330001812026110923300000007') as any).ok).toBe(false);
        expect((lerIdEventoDere('dere1101111222333000181202611092330000000007') as any).ok).toBe(false);
    });

    it('recibo 0000-AAAAMM-id e protocolo T.AAAAMM.N — e protocolo NÃO é recibo', () => {
        const rec = lerRecibo('1101-202610-123456') as any;
        expect(rec.ok).toBe(true);
        expect(rec.evento).toBe('D-1101');
        expect(rec.periodo).toBe('10/2026');
        expect(rec.idInterno).toBe('123456');
        expect((lerRecibo('1121-202610-1') as any).evento).toBe('D-1121');
        expect((lerRecibo('1122-202610-1') as any).ok).toBe(false);
        expect((lerRecibo('1101-202613-1') as any).ok).toBe(false);
        expect((lerRecibo('1.202610.1') as any).ok).toBe(false);

        const prot = lerProtocolo('2.202610.987654321') as any;
        expect(prot.ok).toBe(true);
        expect(prot.ambiente).toBe('pre-producao');
        expect(prot.recebidoEm).toBe('10/2026');
        expect(prot.ressalva).toMatch(/PROTOCOLO/);
        expect((lerProtocolo('1.202610.1') as any).ambiente).toBe('producao');
        expect((lerProtocolo('3.202610.1') as any).ok).toBe(false);
        expect((lerProtocolo('1101-202610-1') as any).ok).toBe(false);
    });

    it('1.2.0 — a CHAVE da DeRE (53) reproduz o EXEMPLO da RN, e chave torta é recusa nomeada', () => {
        // Anexo II 1.2.0, "RN - Formação da Chave da DeRE", exemplo literal:
        // 1C345G7Z BR 1 0000001G01J3A5000191 1020 2026050105 0001 2 000
        const r = montarChaveDere({ raiz: '1C345G7Z', pais: 'BR', tpInscAdq: 1, nrInscAdq: '0000001G01J3A5000191', codBC: '1020', ano: 2026, mes: 5, diaIni: 1, diaFim: 5, serie: 1, seq: 0 });
        expect(r.ok).toBe(true);
        expect(r.chave).toBe('1C345G7ZBR10000001G01J3A50001911020202605010500012000');
        expect(r.chave).toHaveLength(53);
        expect(dvChaveDere(r.chave!.slice(0, 49))).toBe(2);
        const lida = lerChaveDere(r.chave) as any;
        expect(lida).toMatchObject({ ok: true, raiz: '1C345G7Z', pais: 'BR', tpInscAdq: '1', tpInscAdqRotulo: 'CNPJ', codBC: '1020', periodo: '05/2026', diaIni: 1, diaFim: 5, serie: 1, dv: 2, seq: 0, chaveMae: true });
        // Chave-filha troca só os 3 últimos; DV trocado é RECUSA que diz qual seria.
        expect((lerChaveDere(r.chave!.slice(0, 50) + '007') as any)).toMatchObject({ ok: true, seq: 7, chaveMae: false });
        expect((lerChaveDere(r.chave!.slice(0, 49) + '5000') as any).motivo).toMatch(/DV 5 não confere.*seria 2/);
        expect((lerChaveDere(r.chave!.toLowerCase()) as any).ok).toBe(false);
        // O que a RN veda, o app recusa NOMEANDO: agrupar competências distintas, país fora da forma, CPF de 20+ sem truncar.
        expect(montarChaveDere({ raiz: '1C345G7Z', tpInscAdq: 2, nrInscAdq: '12345678901', codBC: '1020', ano: 2026, mes: 5, diaIni: 28, diaFim: 32 }).motivo).toMatch(/1-31/);
        expect(montarChaveDere({ raiz: '1C345G7Z', pais: 'BRA', tpInscAdq: 1, nrInscAdq: '1', codBC: '1020', ano: 2026, mes: 5, diaIni: 1, diaFim: 5 }).motivo).toMatch(/alfa-2/);
        expect(montarChaveDere({ raiz: '1C345G7Z', tpInscAdq: 1, nrInscAdq: 'A'.repeat(21), codBC: '1020', ano: 2026, mes: 5, diaIni: 1, diaFim: 5 }).motivo).toMatch(/NIF \(3\) e Outro \(9\)/);
        // NIF longo fica com os 20 ÚLTIMOS (regra de truncamento da RN).
        const nif = montarChaveDere({ raiz: '1C345G7Z', pais: 'PT', tpInscAdq: 3, nrInscAdq: 'X'.repeat(5) + 'Y'.repeat(20), codBC: '1020', ano: 2026, mes: 2, diaIni: 1, diaFim: 28 });
        expect(nif.chave!.slice(11, 31)).toBe('Y'.repeat(20));
        expect(montarChaveDere({ raiz: '1C345G7Z', tpInscAdq: 7, nrInscAdq: '1', codBC: '1020', ano: 2026, mes: 5, diaIni: 1, diaFim: 5 }).motivo).toMatch(/tpInscAdq/);
        expect(montarChaveDere({ raiz: '1C345G7', tpInscAdq: 1, nrInscAdq: '1', codBC: '1020', ano: 2026, mes: 5, diaIni: 1, diaFim: 5 }).motivo).toMatch(/8 posições/);
    });

    it('1.2.0 — arredondamento pela NBR 5891: os CINCO exemplos da RN, e o empate vai para o PAR', () => {
        // Exemplos literais da RN (arredondamento na 2ª casa).
        expect(arredondarDere(18.234).valor).toBe(18.23);
        expect(arredondarDere(18.237).valor).toBe(18.24);
        expect(arredondarDere(18.2351).valor).toBe(18.24);
        expect(arredondarDere(18.245).valor).toBe(18.24); // 4 é par → fica
        expect(arredondarDere(18.235).valor).toBe(18.24); // 3 é ímpar → sobe
        // Math.round/toFixed errariam o empate — é por isso que a régua existe.
        expect(Math.round(18.245 * 100) / 100).not.toBe(arredondarDere(18.245).valor);
        expect(arredondarDere(-18.235).valor).toBe(-18.24);
        expect(arredondarDere(2.5, 0).valor).toBe(2);
        expect(arredondarDere(3.5, 0).valor).toBe(4);
        expect(arredondarDere(9.995).valor).toBe(10);
        // Memória intermediária a 8 casas (D-9199).
        expect(arredondarDere(0.123456785, 8).valor).toBe(0.12345678);
        expect(arredondarDere('12,50').ok).toBe(false);
        expect(arredondarDere(1, 9).ok).toBe(false);
    });

    it('a integração é REFERÊNCIA do Manual 1.0.2 — token, endpoints, assinatura, pré-requisitos, protocolo ≠ recibo', () => {
        expect(INTEGRACAO_DERE.autenticacao.tokenUrl).toBe('https://api.receitafederal.gov.br/token');
        expect(INTEGRACAO_DERE.autenticacao.validadeMin).toBe(60);
        expect(INTEGRACAO_DERE.urlBase).toBe('https://api.receitafederal.gov.br/prr-dere');
        expect(INTEGRACAO_DERE.endpoints.map((e) => `${e.metodo} ${e.caminho}`)).toEqual([
            'POST /v1/recepcao/lotes', 'GET /v1/consulta/lotes/{protocolo}', 'DELETE /v1/recepcao/limpezaDadosContribuinte/{cnpj8}',
        ]);
        expect(INTEGRACAO_DERE.assinatura.padrao).toMatch(/RSA-SHA256/);
        expect(INTEGRACAO_DERE.preRequisitos).toHaveLength(3);
        expect(INTEGRACAO_DERE.preRequisitos.join(' ')).toMatch(/piloto-cbs\.tributos\.gov\.br/);
        expect(INTEGRACAO_DERE.protocoloNaoEhRecibo).toMatch(/assíncrono/);
    });
});

// ═══ AS LIGAÇÕES — régua sem leitor é régua sem efeito ═════════════════════
describe('🚨 o campo chega a quem monta o mês, ao cadastro e à tela', () => {
    const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

    it('whitelist do cadastro + validação (campo fora dela é descartado calado — lição do #382)', () => {
        const src = ler('sefaz-backend/empresa-status-routes.js');
        expect(src).toMatch(/'regimeEspecificoIbsCbs'/);
        expect(src).toMatch(/validarRegimeEspecificoParaGravacao\(/);
    });

    it('o modal oferece o campo e as opções vêm do DONO (não são copiadas) — e diz "fora do leiaute", não "não confirmado"', () => {
        const src = ler('components/EmpresaDadosFiscaisModal.tsx');
        expect(src).toMatch(/regimeEspecificoIbsCbs/);
        expect(src).toMatch(/REGIMES_ESPECIFICOS_IBS_CBS\.map/);
        expect(src).not.toMatch(/'SERVICOS_FINANCEIROS'/);
        expect(src).toMatch(/fora do leiaute/);
        expect(src).not.toMatch(/alcance da DeRE não confirmado/);
    });

    it('os três caminhos que montam o mês passam o cadastro e o CNAE', () => {
        for (const p of ['sefaz-backend/rotina-empresa-insumo.js', 'sefaz-backend/rotina-fiscal-routes.js', 'sefaz-backend/tarefas-orchestrator.js']) {
            expect({ p, ok: /regimeEspecificoIbsCbs/.test(ler(p)) }).toEqual({ p, ok: true });
        }
    });

    it('o cadastro central entrega o campo ao túnel, e a fila tem rota E botão', () => {
        expect(ler('sefaz-backend/cadastro-central.js')).toMatch(/regimeEspecificoIbsCbs: texto\(df\.regimeEspecificoIbsCbs\)/);
        expect(ler('sefaz-backend/cadastro-central-routes.js')).toMatch(/'\/dere-carteira'/);
        expect(ler('components/DerePanel.tsx')).toMatch(/dere-carteira/);
        expect(ler('components/ConfigAdminModal.tsx')).toMatch(/<DerePanel/);
    });

    it('a tela lê os grupos NOVOS da triagem (fora do leiaute, declarações por raiz, documentos, integração)', () => {
        const src = ler('components/DerePanel.tsx');
        expect(src).toMatch(/r\.foraDoLeiaute/);
        expect(src).toMatch(/r\.resumo\.declaracoes/);
        expect(src).toMatch(/r\.documentos\.map/);
        expect(src).toMatch(/r\.integracao\./);
        expect(src).not.toMatch(/regimeNaoConfirmado/);
    });

    it('📚 a documentação oficial está no repo (texto) E servida pelo app (PDF), e o que falta está DITO', () => {
        for (const d of DOCUMENTOS_DERE) {
            expect({ pdf: d.pdf, existe: existsSync(join(RAIZ, 'public', d.pdf)) }).toEqual({ pdf: d.pdf, existe: true });
            expect({ txt: d.texto, existe: existsSync(join(RAIZ, d.texto)) }).toEqual({ txt: d.texto, existe: true });
        }
        expect(existsSync(join(RAIZ, 'docs/dere/README.md'))).toBe(true);
        expect(DOCUMENTOS_DERE_FALTANDO.join(' ')).toMatch(/MOD/);
        // As Mensagens de Erro SAÍRAM da lista de faltantes: a 1.2.0 as integrou ao Anexo II (Histórico 2.1.h.5).
        expect(DOCUMENTOS_DERE_FALTANDO.join(' ')).not.toMatch(/Mensagens de Erro/);
        expect(readFileSync(join(RAIZ, 'docs/dere/04-anexo-ii-regras-de-validacao-v1.2.0.txt'), 'utf8')).toMatch(/2 MENSAGENS DE ERRO DO SISTEMA/);
        // O que da 1.2.0 NÃO veio está DITO — leiaute dos eventos (02) e Anexo I (03).
        expect(DOCUMENTOS_DERE_FALTANDO.join(' ')).toMatch(/Eventos v1\.2\.0/);
        expect(DOCUMENTOS_DERE_FALTANDO.join(' ')).toMatch(/Anexo I — Tabelas v1\.2\.0/);
        expect(DOCUMENTOS_DERE.filter((d) => d.versao === '1.2.0').map((d) => d.pdf).sort())
            .toEqual(['/docs/dere/04-anexo-ii-regras-de-validacao-v1.2.0.pdf', '/docs/dere/05-historico-de-versoes-v1.2.0.pdf']);
    });

    it('📐 os XSD estão no repo (texto) E servidos pelo app, ligados ao evento certo pelo elemento-raiz e pelo namespace', () => {
        expect(XSD_DERE.length).toBe(28);
        // O pacote 1.2.0 tem exatamente 28 arquivos — e o repo serve exatamente eles
        // (versão antiga de Balancete/PGCC SAIU: namespace antigo é MS0009).
        const noRepo = readdirSync(join(RAIZ, 'docs/dere/xsd')).filter((f) => f.endsWith('.xsd')).sort();
        expect(noRepo).toEqual(XSD_DERE.map((x) => x.arquivo).slice().sort());
        expect(readdirSync(join(RAIZ, 'public/docs/dere/xsd')).filter((f) => f.endsWith('.xsd')).sort()).toEqual(noRepo);
        expect(noRepo).not.toContain('evtBalancete-v1_0_0.xsd');
        expect(noRepo).not.toContain('evtPGCC-v1_0_2.xsd');
        for (const x of XSD_DERE) {
            const txt = join(RAIZ, 'docs/dere/xsd', x.arquivo);
            expect({ arquivo: x.arquivo, existe: existsSync(txt) && existsSync(join(RAIZ, 'public/docs/dere/xsd', x.arquivo)) })
                .toEqual({ arquivo: x.arquivo, existe: true });
            const src = readFileSync(txt, 'utf8');
            // O que a tabela AFIRMA sobre o arquivo tem de estar NO arquivo — tabela
            // digitada de memória é a segunda cópia que esta casa mais paga.
            expect(src).toContain(`targetNamespace="${x.namespace}"`);
            expect(src).toContain(`<xs:element name="${x.elemento}"`);
            expect(x.namespace.endsWith('/v' + x.versao.replace(/\./g, '_'))).toBe(true);
        }
        // Cada evento com `xsd` aponta um arquivo da tabela, e a tabela aponta de volta.
        for (const e of EVENTOS_DERE) {
            const x = XSD_DERE.find((k) => k.evento === e.codigo);
            expect({ codigo: e.codigo, xsd: e.xsd ?? null }).toEqual({ codigo: e.codigo, xsd: x ? x.arquivo : null });
        }
        // Com a 1.2.0 nenhum evento fica sem XSD — e o gerador de cada um continua
        // exigindo o arquivo NA MÃO (o D-1001 já lê o dele).
        expect(xsdFaltando()).toEqual([]);
        // O de-para XSD → evento é provado pela DOCUMENTAÇÃO do próprio arquivo quando ela nomeia o evento.
        const docPorEvento: Record<string, RegExp> = {
            'D-1121': /Relação de Deduções/, 'D-9112': /Relação de Deduções/, 'D-1198': /Reabertura/, 'D-9198': /Reabertura/,
            'D-1199': /Fechamento Mensal/, 'D-9199': /Fechamento Mensal/, 'D-2101': /títulos de dívida com oferta pública/i,
            'D-9121': /Títulos de Dívida com Oferta Pública/, 'D-9209': /eventos transacionais/, 'D-4201': /apostas e prêmios/,
            'D-3201': /planos de assistência à saúde/, 'D-2251': /seguros, previdência e capitalização/, 'D-2231': /arrendamento mercantil/,
            'D-2221': /antecipação de recebíveis/, 'D-2211': /operações de crédito e TVM/, 'D-2202': /detalhamento de tarifas/,
            'D-2201': /serviços remunerados por preço/, 'D-2241': /credenciados ou destinatários/, 'D-2242': /entre participantes/,
        };
        for (const [ev, re] of Object.entries(docPorEvento)) {
            const x = XSD_DERE.find((k) => k.evento === ev)!;
            expect({ ev, doc: re.test(readFileSync(join(RAIZ, 'docs/dere/xsd', x.arquivo), 'utf8')) }).toEqual({ ev, doc: true });
        }
        // Entre os pacotes, o D-1001 veio IDÊNTICO — o gerador não muda por causa do XSD.
        expect(XSD_DERE.find((k) => k.evento === 'D-1001')!.arquivo).toBe('evtInfoContrib-v1_0_1.xsd');
        // Balancete e PGCC subiram de versão só no teto de contas (Histórico 2.1.d).
        expect(readFileSync(join(RAIZ, 'docs/dere/xsd/evtBalancete-v1_0_1.xsd'), 'utf8')).toMatch(/name="infoConta" minOccurs="1" maxOccurs="90000"/);
        expect(readFileSync(join(RAIZ, 'docs/dere/xsd/evtPGCC-v1_0_3.xsd'), 'utf8')).toMatch(/name="infoConta" minOccurs="1" maxOccurs="150000"/);
        expect(ler('components/DerePanel.tsx')).toMatch(/r\.xsd\.map/);
        expect(ler('components/DerePanel.tsx')).toMatch(/r\.xsdFaltando/);
    });

    it('📐 o Id que o app monta passa no PADRÃO do próprio XSD, e a raiz passa em {nrInsc}', () => {
        const xsd = readFileSync(join(RAIZ, 'docs/dere/xsd/evtBalancete-v1_0_1.xsd'), 'utf8');
        const padraoId = /xs:pattern value="(DeRE[^"]+)"/.exec(xsd)![1];
        expect(padraoId).toBe('DeRE[0-9]{4}[1-2][A-Z0-9]{14}[0-9]{19}');
        const r = montarIdEventoDere({ codigoEvento: 'D-1101', cnpj: '11.222.333/0001-81', data: new Date('2026-11-10T02:30:00Z'), sequencial: 7 });
        expect(new RegExp(`^${padraoId}$`).test(r.id!)).toBe(true);
        // Id com sequencial e CNPJ alfanumérico também cabe no padrão do XSD.
        const alfa = montarIdEventoDere({ codigoEvento: 'D-1001', cnpj: '12abc345000199', data: new Date('2026-10-01T15:00:00Z'), sequencial: 99999 });
        expect(new RegExp(`^${padraoId}$`).test(alfa.id!)).toBe(true);
        const padraoInsc = /name="nrInsc"[\s\S]*?xs:pattern value="([^"]+)"/.exec(xsd)![1];
        expect(padraoInsc).toBe('[0-9A-Z]{8}');
        expect(new RegExp(`^${padraoInsc}$`).test(raizDoCnpj('12abc345000199')!)).toBe(true);
        // E os tetos do recibo (31) e do protocolo (28) que as réguas de forma assumem estão no XSD de retorno.
        expect(readFileSync(join(RAIZ, 'docs/dere/xsd/evtRetornoTabela-v1_0_1.xsd'), 'utf8')).toMatch(/name="nrRecibo"[\s\S]*?maxLength value="31"/);
        expect(readFileSync(join(RAIZ, 'docs/dere/xsd/retornoLoteDere-v1_0_1.xsd'), 'utf8')).toMatch(/name="protocolo"[\s\S]*?maxLength value="28"/);
    });

    it('o CFI monta a PRÉVIA do D-1001 e NÃO transmite — e a tela diz exatamente isso', () => {
        // 02/09 à noite, Paulo: "Fiscal, tudo roda no Fiscal". O gerador do
        // D-1001 nasceu (dere-evento-d1001.js) e a frase da tela mudou JUNTO —
        // nunca só um dos dois. Transmissão continua inexistente: sem credencial
        // do piloto e sem o XSD do fechamento, `entregaPeloApp` segue false.
        expect(ler('components/DerePanel.tsx')).toMatch(/PRÉVIA do D-1001 e não transmite/);
        expect(ler('sefaz-backend/dere.js')).toMatch(/entregaPeloApp: false/);
        expect(ler('sefaz-backend/dere-evento-d1001.js')).toMatch(/export function montarEventoD1001/);
    });
});
