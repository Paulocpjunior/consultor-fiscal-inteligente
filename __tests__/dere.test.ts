// ============================================================================
// 🏦 DeRE — Declaração Eletrônica de Regimes Específicos (IBS/CBS/IS)
//
// Paulo, 02/09: *"crie uma nova função capaz de atender esta obrigação chamada
// DERE"*. O que estes testes travam: QUEM está (só o cadastro afirma; o CNAE
// sugere), QUANDO vence (dia 15 do mês seguinte, antecipado — a 1ª competência
// é 10/2026 e vence 13/11/2026 porque 15/11 é domingo e 14 é sábado), e que a
// obrigação entra no MÊS do cliente pelo catálogo — sem acender a carteira
// inteira e sem tocar em quem é do Simples.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    CATALOGO, mesDoCliente, obrigacoesAplicaveis, obrigacoesDoCliente,
    pendenciasDeConfirmacao, compararCompetencias, OBRIGACAO_DERE,
} from '../sefaz-backend/catalogo-obrigacoes';
import {
    REGIMES_ESPECIFICOS_IBS_CBS, decidirDereNoCadastro, sinalDeCnaeParaDere,
    validarRegimeEspecificoParaGravacao,
} from '../sefaz-backend/dere-regimes';
import {
    VIGENCIA_DERE, EVENTOS_DERE, CRONOGRAMA_DERE, eventosDaCompetencia, prazoDere,
    situacaoDere, triarCarteiraDere,
} from '../sefaz-backend/dere';

const RAIZ = join(__dirname, '..');
const presumido = (extra: any = {}) => ({ colecao: 'lucro_empresas', regimePadrao: 'Presumido', ...extra });
const codigos = (rs: any[]) => rs.map((r) => r.obrigacao);

describe('o vocabulário — a LC 214/2025 é a fonte, o alcance é marcado por regime', () => {
    it('todo regime tem código, rótulo, base legal e a coluna dereConfirmada', () => {
        for (const r of REGIMES_ESPECIFICOS_IBS_CBS) {
            expect(r.codigo).toMatch(/^[A-Z_]+$/);
            expect(r.rotulo).toBeTruthy();
            expect(r.baseLegal).toBeTruthy();
            expect(typeof r.dereConfirmada).toBe('boolean');
        }
    });

    it('os TRÊS públicos do manual estão confirmados; os demais NÃO afirmam', () => {
        const conf = REGIMES_ESPECIFICOS_IBS_CBS.filter((r) => r.dereConfirmada).map((r) => r.codigo).sort();
        expect(conf).toEqual(['CONCURSOS_PROGNOSTICOS', 'PLANOS_SAUDE', 'SERVICOS_FINANCEIROS']);
        // Só regime CONFIRMADO carrega sinal de CNAE — senão a fila encheria de
        // posto de gasolina e imobiliária por um alcance que ninguém confirmou.
        for (const r of REGIMES_ESPECIFICOS_IBS_CBS) {
            if (!r.dereConfirmada) expect(r.cnaes).toHaveLength(0);
        }
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
});

describe('decidirDereNoCadastro — o cadastro decide, o CNAE sugere, o silêncio não acusa', () => {
    it('Simples fica FORA mesmo com regime marcado', () => {
        const v = decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, { regimeCatalogo: 'SIMPLES' });
        expect(v.decisao).toBe('dispensada-simples');
    });

    it('regime confirmado no cadastro ⇒ obrigada (lê as DUAS formas)', () => {
        expect(decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'PLANOS_SAUDE' }, { regimeCatalogo: 'LUCRO_REAL' }).decisao).toBe('obrigada');
        expect(decidirDereNoCadastro({ dadosFiscais: { regimeEspecificoIbsCbs: 'PLANOS_SAUDE' } }, { regimeCatalogo: 'LUCRO_REAL' }).decisao).toBe('obrigada');
    });

    it('NENHUM ⇒ não se aplica; regime não confirmado ⇒ não afirma e manda ao manual', () => {
        expect(decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'NENHUM' }, { regimeCatalogo: 'LUCRO_PRESUMIDO' }).decisao).toBe('nao-se-aplica');
        const v = decidirDereNoCadastro({ regimeEspecificoIbsCbs: 'BENS_IMOVEIS' }, { regimeCatalogo: 'LUCRO_PRESUMIDO' });
        expect(v.decisao).toBe('regime-nao-confirmado');
        expect(v.acao).toMatch(/Manual/);
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
    });

    it('cadastro diz NENHUM ⇒ sai das pendências e NÃO piora a cobertura por causa dela', () => {
        const com = mesDoCliente(presumido({ regimeEspecificoIbsCbs: 'NENHUM' }), '10/2026');
        expect(codigos(com.obrigacoes)).not.toContain('DERE');
        expect(codigos(com.propostas)).not.toContain('DERE');
        expect(com.dere?.decisao).toBe('nao-se-aplica');
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

describe('dere.js — cronograma, eventos, prazo e a situação de um cliente', () => {
    it('vigência e cronograma batem com o Ato Conjunto 4/2026', () => {
        expect(VIGENCIA_DERE).toBe('10/2026');
        expect(CRONOGRAMA_DERE.map((m) => m.dataIso)).toEqual(['2026-10-01', '2026-11-15', '2027-01-01']);
    });

    it('eventos: os de tabela existem, os mensais só a partir de 10/2026, e os de retorno ninguém envia', () => {
        expect(EVENTOS_DERE.filter((e) => e.grupo === 'tabela').map((e) => e.codigo)).toEqual(['D-1001', 'D-1011']);
        const out = eventosDaCompetencia('10/2026');
        expect(out.mensais.map((e) => e.codigo)).toEqual(expect.arrayContaining(['D-1101', 'D-1106', 'D-1121', 'D-2101', 'D-1199']));
        expect(eventosDaCompetencia('09/2026').mensais).toHaveLength(0);
        for (const e of EVENTOS_DERE) expect(e.codigo).toMatch(/^D-\d{4}$/);
    });

    it('prazoDere: null antes da vigência; 13/11/2026 para 10/2026; 15/12/2026 (terça) para 11/2026', () => {
        expect(prazoDere('09/2026')).toBeNull();
        expect(prazoDere('10/2026')?.getDate()).toBe(13);
        const dez = prazoDere('11/2026')!;
        expect(dez.getMonth()).toBe(11);
        expect(dez.getDate()).toBe(15);
    });

    it('situacaoDere: obrigada antes da vigência sai como ainda-nao-vigente, e DIZ que o app não entrega', () => {
        const s = situacaoDere({ regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, '09/2026', { regimeCatalogo: 'LUCRO_REAL' });
        expect(s.situacao).toBe('ainda-nao-vigente');
        expect(s.prazo).toBeNull();
        const t = situacaoDere({ regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' }, '10/2026', { regimeCatalogo: 'LUCRO_REAL' });
        expect(t.situacao).toBe('obrigada');
        expect(t.prazoTexto).toBe('13/11/2026');
        expect(t.entregaPeloApp).toBe(false);
        expect(t.ressalvaEntrega).toMatch(/NÃO gera nem transmite/);
    });

    it('triarCarteiraDere separa as filas e CONTA o que ficou de fora', () => {
        const r = triarCarteiraDere([
            { id: 'a', cnpj: '11222333000181', nome: 'BANCO X', regimeTributario: 'LUCRO_REAL', cnae: '6422100', regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS' },
            { id: 'b', cnpj: '11222333000262', nome: 'PLANO Y', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '6550200', regimeEspecificoIbsCbs: null },
            { id: 'c', cnpj: '11222333000343', nome: 'IMOBILIARIA Z', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '6810201', regimeEspecificoIbsCbs: 'BENS_IMOVEIS' },
            { id: 'd', cnpj: '11222333000424', nome: 'PADARIA', regimeTributario: 'SIMPLES', cnae: '4721102', regimeEspecificoIbsCbs: null },
            { id: 'e', cnpj: '11222333000505', nome: 'COMERCIO', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '4712100', regimeEspecificoIbsCbs: 'NENHUM' },
            { id: 'f', cnpj: '11222333000696', nome: 'SERVICO', regimeTributario: 'LUCRO_PRESUMIDO', cnae: '6201500', regimeEspecificoIbsCbs: null },
        ], '10/2026');
        expect(r.obrigadas.map((l) => l.nome)).toEqual(['BANCO X']);
        expect(r.obrigadas[0].prazoTexto).toBe('13/11/2026');
        expect(r.candidatas.map((l) => l.nome)).toEqual(['PLANO Y']);
        expect(r.regimeNaoConfirmado.map((l) => l.nome)).toEqual(['IMOBILIARIA Z']);
        expect(r.naoSeAplica.map((l) => l.nome)).toEqual(['COMERCIO']);
        expect(r.resumo).toEqual({
            total: 6, obrigadas: 1, candidatas: 1, regimeNaoConfirmado: 1, naoSeAplica: 1, dispensadasSimples: 1, semSinal: 1,
        });
        expect(r.ressalvas.join(' ')).toMatch(/não gera nem transmite/);
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

    it('o modal oferece o campo e as opções vêm do DONO (não são copiadas)', () => {
        const src = ler('components/EmpresaDadosFiscaisModal.tsx');
        expect(src).toMatch(/regimeEspecificoIbsCbs/);
        expect(src).toMatch(/REGIMES_ESPECIFICOS_IBS_CBS\.map/);
        expect(src).not.toMatch(/'SERVICOS_FINANCEIROS'/);
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

    it('nenhum gerador de evento da DeRE existe — e a tela diz isso em vez de prometer', () => {
        // Inventar leiaute sem o XSD é o `1405` num arquivo que a Receita
        // processa. Se um dia o gerador nascer, este teste é trocado junto com
        // a frase da tela — nunca só um dos dois.
        expect(ler('components/DerePanel.tsx')).toMatch(/não gera nem transmite/);
        expect(ler('sefaz-backend/dere.js')).toMatch(/entregaPeloApp: false/);
    });
});
