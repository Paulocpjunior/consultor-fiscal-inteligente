// ============================================================================
// CALENDÁRIO MUNICIPAL — o buraco maior do mês do colaborador.
//
// Paulo, 11/08: a consulta de prazo é POR ESFERA. O federal está completo, o
// estadual tem só SP (e desde 15/08 o app denuncia quando entrega o prazo
// paulista a cliente de outra UF). O municipal era buraco inteiro: não existe
// "dia do ISS" nacional, e carimbar o de SP seria inventar prazo — são ~157
// empresas de serviço puro, as que NÃO fecham o mês no DAS.
//
// Este módulo NÃO inventa prazo: guarda o que alguém conferiu, com vigência.
// ============================================================================
import {
    validarPrazoMunicipal, vigenteNaCompetencia, resolverPrazoMunicipal,
    idPrazoMunicipal, municipiosSemCalendario, ehCodigoIbgeMunicipio,
} from '../sefaz-backend/prazos-municipais.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SP = '3550308';        // São Paulo capital
const JUNDIAI = '3525904';

const cad = (over: any = {}) => ({
    codMunIBGE: SP, municipioNome: 'São Paulo', obrigacao: 'ISS',
    diaVencimento: 10, mesesApos: 1, ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Lei Municipal 13.701/2003, art. 20',
    vigenciaInicio: '2020-01-01', vigenciaFim: '',
    cadastradoPorEmail: 'paulo@spassessoriacontabil.com.br',
    ...over,
});

describe('validação: prazo sem norma de origem não entra', () => {
    it('cadastro completo passa', () => {
        expect(validarPrazoMunicipal(cad()).ok).toBe(true);
    });

    it('🚨 SEM BASE LEGAL é recusado — mesma régua do IVA-ST sem Portaria', () => {
        // Prazo órfão não se confere depois, e daqui a três meses ninguém
        // lembra de onde veio aquele dia 15.
        const r = validarPrazoMunicipal(cad({ baseLegal: '' }));
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/base legal/i);
        expect(r.erros.join(' ')).toMatch(/não se confere depois/);
    });

    it('código IBGE tem 7 dígitos — é ele que casa com o cadastro do cliente', () => {
        expect(ehCodigoIbgeMunicipio('355030')).toBe(false);
        expect(validarPrazoMunicipal(cad({ codMunIBGE: '3550' })).erros.join(' ')).toMatch(/7 dígitos/);
    });

    it('dia fora de 1–31 e vigência invertida são recusados', () => {
        expect(validarPrazoMunicipal(cad({ diaVencimento: 0 })).ok).toBe(false);
        expect(validarPrazoMunicipal(cad({ diaVencimento: 32 })).ok).toBe(false);
        expect(validarPrazoMunicipal(cad({ vigenciaInicio: '2026-05-01', vigenciaFim: '2026-01-01' })).erros.join(' '))
            .toMatch(/anterior à inicial/);
    });
});

describe('🚨 vigência resolve pela COMPETÊNCIA, nunca "o mais recente"', () => {
    // A régua do IVA-ST, e pela mesma razão: competência antiga tem que sair
    // com a regra que valia NELA. O erro contrário só aparece na fiscalização.
    const antigo = cad({ diaVencimento: 10, vigenciaInicio: '2020-01-01', vigenciaFim: '2026-05-31' });
    const novo = cad({ diaVencimento: 20, vigenciaInicio: '2026-06-01', baseLegal: 'Lei Municipal 18.000/2026' });

    it('competência antiga usa a regra antiga', () => {
        const r = resolverPrazoMunicipal([antigo, novo], { codMunIBGE: SP, obrigacao: 'ISS', competencia: '2026-04' });
        expect(r.achou).toBe(true);
        expect(r.prazo!.diaVencimento).toBe(10);
    });

    it('competência nova usa a regra nova', () => {
        const r = resolverPrazoMunicipal([antigo, novo], { codMunIBGE: SP, obrigacao: 'ISS', competencia: '2026-07' });
        expect(r.prazo!.diaVencimento).toBe(20);
        expect(r.prazo!.baseLegal).toMatch(/18\.000\/2026/);
    });

    it('vigência publicada no meio do mês vale para a competência inteira', () => {
        // Quem paga não recolhe meio mês pela regra velha e meio pela nova.
        expect(vigenteNaCompetencia({ vigenciaInicio: '2026-06-17' }, '2026-06')).toBe(true);
    });

    it('nenhuma vigência cobre a competência ⇒ NÃO cai na mais próxima', () => {
        const r = resolverPrazoMunicipal([cad({ vigenciaInicio: '2027-01-01' })],
            { codMunIBGE: SP, obrigacao: 'ISS', competencia: '2026-07' });
        expect(r.achou).toBe(false);
        expect(r.situacao).toBe('fora-de-vigencia');
        expect(r.motivo).toMatch(/não usa a regra de outro período/);
    });
});

describe('🚨 município sem cadastro NÃO herda o de ninguém', () => {
    it('Jundiaí não recebe o calendário de São Paulo', () => {
        // Carimbar o prazo de SP é inventar prazo — e prazo errado entregue
        // com confiança é o erro mais caro deste app.
        const r = resolverPrazoMunicipal([cad()], { codMunIBGE: JUNDIAI, obrigacao: 'ISS', competencia: '2026-07' });
        expect(r.achou).toBe(false);
        expect(r.situacao).toBe('municipio-sem-cadastro');
        expect(r.motivo).toMatch(/cada prefeitura tem o seu/);
    });

    it('cliente SEM município tem outra causa e outra ação — é no cadastro dele', () => {
        const r = resolverPrazoMunicipal([cad()], { codMunIBGE: '', obrigacao: 'ISS', competencia: '2026-07' });
        expect(r.situacao).toBe('municipio-ausente');
        expect(r.motivo).toMatch(/Dados Fiscais/);
    });

    it('cadastro desativado não vale', () => {
        const r = resolverPrazoMunicipal([cad({ ativo: false })], { codMunIBGE: SP, obrigacao: 'ISS', competencia: '2026-07' });
        expect(r.achou).toBe(false);
    });
});

describe('a fila de cadastro é POR MUNICÍPIO — não 157 linhas de cliente', () => {
    const clientes = [
        { id: 'a', nome: 'A', cnpj: '1'.repeat(14), codMunIBGE: JUNDIAI, regime: 'lucro' },
        { id: 'b', nome: 'B', cnpj: '2'.repeat(14), codMunIBGE: JUNDIAI, regime: 'lucro' },
        { id: 'c', nome: 'C', cnpj: '3'.repeat(14), codMunIBGE: '3509502', regime: 'lucro' },
        { id: 'd', nome: 'D', cnpj: '4'.repeat(14), codMunIBGE: SP, regime: 'lucro' },
        { id: 'e', nome: 'E', cnpj: '5'.repeat(14), codMunIBGE: '', regime: 'lucro' },
    ];

    it('agrupa por cidade e põe quem rende mais na frente', () => {
        const r = municipiosSemCalendario(clientes, [cad()], { competencia: '2026-07' });
        expect(r.totalMunicipios).toBe(2);              // SP já tem calendário
        expect(r.municipios[0].codMunIBGE).toBe(JUNDIAI); // 2 clientes
        expect(r.municipios[0].total).toBe(2);
        expect(r.totalClientes).toBe(3);
    });

    it('cliente sem município é CONTADO à parte — a ação é outra', () => {
        const r = municipiosSemCalendario(clientes, [cad()], { competencia: '2026-07' });
        expect(r.clientesSemMunicipio).toBe(1);
        expect(r.municipios.some((m: any) => m.codMunIBGE === '')).toBe(false);
    });

    it('🚨 optante do SIMPLES fica de fora — ele não recolhe ISS próprio', () => {
        // LC 123 art. 13: já está no DAS. Cobrar calendário por causa dele
        // seria fila inflada com trabalho que não muda guia nenhuma.
        const r = municipiosSemCalendario(
            [{ id: 'x', nome: 'X', cnpj: '9'.repeat(14), codMunIBGE: JUNDIAI, regime: 'simples' }],
            [], { competencia: '2026-07' },
        );
        expect(r.totalMunicipios).toBe(0);
        expect(r.totalClientes).toBe(0);
    });
});

describe('id determinístico — recadastrar corrige, não duplica', () => {
    it('município × obrigação × início de vigência', () => {
        expect(idPrazoMunicipal(cad())).toBe('3550308_ISS_2020-01-01');
        // Vigência nova é OUTRO documento: a antiga continua valendo para as
        // competências dela.
        expect(idPrazoMunicipal(cad({ vigenciaInicio: '2026-06-01' }))).toBe('3550308_ISS_2026-06-01');
    });
});

// ═══ LIGADO NO CATÁLOGO: o ISS deixa de ser pendência PARA QUEM TEM ═════════
describe('o cadastro do município transforma pendência em obrigação com DATA', () => {
    const { mesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');
    const lucroEm = (codMunIBGE: string, prazosMunicipais: any[] = []) =>
        mesDoCliente({
            colecao: 'lucro_empresas', regimePadrao: 'presumido',
            uf: 'SP', codMunIBGE, prazosMunicipais,
        }, '06/2026');

    it('sem calendário, o ISS continua PENDÊNCIA nomeada (estado de hoje)', () => {
        const m = lucroEm(JUNDIAI);
        expect(m.propostas.some((r: any) => r.obrigacao === 'ISS')).toBe(true);
        expect(m.obrigacoes.some((r: any) => r.obrigacao === 'ISS')).toBe(false);
        expect(m.coberturaIncompleta).toBe(true);
    });

    it('🚨 com calendário cadastrado, o ISS vira obrigação COM VENCIMENTO', () => {
        const m = lucroEm(SP, [cad()]);
        const iss = m.obrigacoes.find((r: any) => r.obrigacao === 'ISS');
        expect(iss).toBeTruthy();
        expect(iss.vencimento).toBeInstanceOf(Date);
        // A base legal do MUNICÍPIO substitui o "a cadastrar" genérico.
        expect(iss.baseLegal).toMatch(/13\.701\/2003/);
        expect(iss.abrangencia).toBe(`IBGE:${SP}`);
        // E ele SAI da lista de pendências.
        expect(m.propostas.some((r: any) => r.obrigacao === 'ISS')).toBe(false);
    });

    it('o calendário de UM município não resolve o de outro', () => {
        // Cadastrar SP não pode fazer o cliente de Jundiaí ficar "coberto" —
        // seria o prazo errado entregue com confiança, de novo.
        const m = lucroEm(JUNDIAI, [cad()]);
        expect(m.obrigacoes.some((r: any) => r.obrigacao === 'ISS')).toBe(false);
        expect(m.propostas.some((r: any) => r.obrigacao === 'ISS')).toBe(true);
    });

    it('o INSS patronal continua pendente — ele depende da FOLHA, não do município', () => {
        // Resolver o ISS não pode dar o mês por coberto: as causas são
        // independentes e a folha mora no módulo de DP.
        const m = lucroEm(SP, [cad()]);
        expect(m.propostas.some((r: any) => r.dependeDe === 'folha')).toBe(true);
        expect(m.coberturaIncompleta).toBe(true);
    });
});

describe('🚨 o descasamento de formato de competência — que mordeu DUAS vezes hoje', () => {
    it('o catálogo converte MM/AAAA → AAAA-MM antes de resolver a vigência', () => {
        // Passar direto faz a vigência NUNCA casar, e o efeito é SILENCIOSO:
        // o ISS continua pendente como se ninguém tivesse cadastrado nada.
        // (Na Rotina o mesmo descasamento ao menos explodia.)
        const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/catalogo-obrigacoes.js'), 'utf8');
        expect(fonte).toMatch(/competenciaIso/);
        expect(fonte).toMatch(/competencia: competenciaIso/);
    });

    it('e a conversão funciona no limite do ano', () => {
        const { mesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');
        const m = mesDoCliente({
            colecao: 'lucro_empresas', regimePadrao: 'presumido', uf: 'SP',
            codMunIBGE: SP,
            prazosMunicipais: [cad({ vigenciaInicio: '2026-12-01', vigenciaFim: '2026-12-31' })],
        }, '12/2026');
        expect(m.obrigacoes.some((r: any) => r.obrigacao === 'ISS')).toBe(true);
    });
});

describe('a rota e a TELA existem — o erro que eu cometi 3× hoje não se repete', () => {
    const RAIZ = join(__dirname, '..');
    it('a rota está montada no server e só ADMIN grava', () => {
        expect(readFileSync(join(RAIZ, 'server.js'), 'utf8')).toMatch(/prazos-municipais/);
        const rota = readFileSync(join(RAIZ, 'sefaz-backend/prazos-municipais-routes.js'), 'utf8');
        expect(rota).toMatch(/router\.post\('\/', requireAdmin/);
        // Desativar NÃO apaga: o calendário antigo continua explicando as
        // competências que ele datou.
        expect(rota).toMatch(/ativo: false/);
        expect(rota).not.toMatch(/\.delete\(\)/);
    });

    it('a tela existe e está montada no Config Admin', () => {
        const cfg = readFileSync(join(RAIZ, 'components/ConfigAdminModal.tsx'), 'utf8');
        expect(cfg).toMatch(/<PrazosMunicipaisPanel/);
        const tela = readFileSync(join(RAIZ, 'components/PrazosMunicipaisPanel.tsx'), 'utf8');
        // A tela DIZ a régua da vigência — senão alguém edita a antiga e
        // reescreve o passado sem perceber.
        expect(tela).toMatch(/por vigência/);
        expect(tela).toMatch(/cadastre a vigência nova em vez de editar a/);
    });

    it('a Rotina carrega os calendários e falha NÃO derruba o painel', () => {
        const rota = readFileSync(join(RAIZ, 'sefaz-backend/rotina-fiscal-routes.js'), 'utf8');
        expect(rota).toMatch(/carregarPrazosMunicipais/);
        expect(rota).toMatch(/calendários municipais indisponíveis/);
    });
});

// ═══ 🚨 O DEFEITO QUE EU CRIEI HOJE, E QUE SÓ APARECERIA DEPOIS ═════════════
//
// Liguei o cadastro do calendário à COBERTURA da Rotina (o âmbar) e esqueci de
// ligá-lo a QUEM CRIA A TAREFA. O efeito seria perverso: ao cadastrar a cidade,
// o aviso "o ISS não vira tarefa automática" SUMIRIA e a tarefa continuaria não
// existindo. Trocar o alerta pelo silêncio é pior que não ter cadastrado — o
// mês fecharia sem o ISS e sem ninguém avisando.
describe('cadastrar o calendário TEM que gerar a tarefa', () => {
    const { mesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');
    const RAIZ = join(__dirname, '..');

    it('a obrigação municipal entra na lista que o cron percorre, COM vencimento', () => {
        const mes = mesDoCliente({
            colecao: 'lucro_empresas', regimePadrao: 'presumido', uf: 'SP',
            codMunIBGE: SP, prazosMunicipais: [cad()],
        }, '06/2026');
        const iss = mes.obrigacoes.find((r: any) => r.obrigacao === 'ISS');
        expect(iss).toBeTruthy();
        expect(iss.esfera).toBe('municipal');
        expect(iss.vencimento).toBeInstanceOf(Date);
    });

    it('o cron usa mesDoCliente — não a lista genérica do regime', () => {
        const cron = readFileSync(join(RAIZ, 'sefaz-backend/tarefas-orchestrator.js'), 'utf8');
        const semComentarios = cron.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(semComentarios).toMatch(/const mes = mesDoCliente\(/);
        expect(semComentarios).toMatch(/const regras = mes\.obrigacoes/);
        // A chamada genérica não pode voltar por "simplificação": ela não
        // conhece município nem UF.
        expect(semComentarios).not.toMatch(/const regras = obrigacoesAplicaveis\(/);
    });

    it('o cron carrega os calendários e falha NÃO derruba o mês', () => {
        const cron = readFileSync(join(RAIZ, 'sefaz-backend/tarefas-orchestrator.js'), 'utf8');
        expect(cron).toMatch(/carregarPrazosMunicipais/);
        expect(cron).toMatch(/Calendários municipais indisponíveis/);
        // E conta o que é novidade, senão ninguém sabe que passou a gerar.
        expect(cron).toMatch(/tarefasMunicipais/);
    });

    it('🚨 e o cron fala o MESMO formato de competência do catálogo', () => {
        // A terceira chance do descasamento MM/AAAA × AAAA-MM morder. Aqui os
        // dois falam MM/AAAA — conferido, não suposto.
        const cron = readFileSync(join(RAIZ, 'sefaz-backend/tarefas-orchestrator.js'), 'utf8');
        expect(cron).toMatch(/return `\$\{mes\}\/\$\{ano\}`/);
    });
});

// ═══ A TRAVA DA CLASSE — porque o defeito voltou em OUTRO caminho ═══════════
//
// Consertei o cron e algumas horas depois a varredura achou o MESMO defeito no
// auto-gerar da tela de Tarefas: ele chamava `obrigacoesAplicaveis`, a lista
// genérica, que não conhece município nem UF. Corrigir instância por instância
// não fecha a classe — a trava varre QUEM CRIA TAREFA.
describe('🚨 todo caminho que CRIA tarefa usa o núcleo por cliente', () => {
    const RAIZ = join(__dirname, '..');
    const semComentarios = (s: string) =>
        s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('nenhum criador de tarefa chama a lista genérica do regime', () => {
        const criadores = [
            'sefaz-backend/tarefas-orchestrator.js',   // cron do dia 1
            'services/tarefasAutoGerar.ts',            // auto-gerar da tela
        ];
        for (const f of criadores) {
            const fonte = semComentarios(readFileSync(join(RAIZ, f), 'utf8'));
            expect(fonte).toMatch(/mesDoCliente\(|obrigacoesDoCliente\(/);
            // A genérica não conhece município nem UF: usá-la aqui é o defeito.
            expect(fonte).not.toMatch(/=\s*obrigacoesAplicaveis\(/);
        }
    });

    it('🚨 os DOIS vocabulários de regime batem — LUCRO_REAL_* não some calado', () => {
        // `CATALOGO['LUCRO_REAL_INDUSTRIA']` é undefined e a lista saía VAZIA
        // em silêncio: o auto-gerar criava ZERO obrigação para todo cliente do
        // Lucro Real, e a estatística dizia "0 criadas" como se não houvesse
        // o que criar.
        const { normalizarRegimeCatalogo, obrigacoesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');
        expect(normalizarRegimeCatalogo('LUCRO_REAL_INDUSTRIA')).toEqual({ regime: 'LUCRO_REAL', reconhecido: true });
        expect(normalizarRegimeCatalogo('LUCRO_REAL_SERVICOS').regime).toBe('LUCRO_REAL');
        expect(normalizarRegimeCatalogo('SIMPLES').regime).toBe('SIMPLES');

        const mes = obrigacoesDoCliente('LUCRO_REAL_COMERCIO', '06/2026', { uf: 'SP' });
        expect(mes.obrigacoes.length).toBeGreaterThan(0);
        expect(mes.regimeReconhecido).toBe(true);
    });

    it('regime que o catálogo NÃO conhece vem nomeado, nunca lista vazia calada', () => {
        const { obrigacoesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');
        const mes = obrigacoesDoCliente('REGIME_QUE_NAO_EXISTE', '06/2026', {});
        expect(mes.regimeReconhecido).toBe(false);
        // E quem chama CONTA isso: "0 criadas" sem causa passa por "nada a fazer".
        const auto = readFileSync(join(RAIZ, 'services/tarefasAutoGerar.ts'), 'utf8');
        expect(auto).toMatch(/regimesNaoReconhecidos/);
    });

    it('o auto-gerar da tela carrega os calendários, igual ao cron', () => {
        const auto = readFileSync(join(RAIZ, 'services/tarefasAutoGerar.ts'), 'utf8');
        expect(auto).toMatch(/carregarCalendariosMunicipais/);
    });
});

describe('a fila diz ONDE PARAR, não só a ordem', () => {
    it('cobertura acumulada e quantas cidades bastam para 80%', () => {
        // Uma lista de 57 cidades ordenada por volume ainda não diz quantas
        // valem a pena: sem isto, ou se cadastra 57 (trabalho que não rende)
        // ou se cadastra 1 e acha que resolveu.
        const clientes = [
            ...Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, nome: `A${i}`, cnpj: '1', codMunIBGE: SP, regime: 'lucro' })),
            { id: 'b', nome: 'B', cnpj: '2', codMunIBGE: JUNDIAI, regime: 'lucro' },
            { id: 'c', nome: 'C', cnpj: '3', codMunIBGE: '3509502', regime: 'lucro' },
        ];
        const r = municipiosSemCalendario(clientes, [], { competencia: '2026-07' });
        expect(r.municipios[0].total).toBe(8);
        expect(r.municipios[0].coberturaAcumuladaPct).toBe(80);
        // Uma cidade só já resolve 80% — é isso que decide o esforço.
        expect(r.cidadesPara80).toBe(1);
    });

    it('a tela mostra o acumulado e onde parar', () => {
        const tela = readFileSync(join(__dirname, '..', 'components/PrazosMunicipaisPanel.tsx'), 'utf8');
        expect(tela).toMatch(/cidadesPara80/);
        expect(tela).toMatch(/coberturaAcumuladaPct/);
    });
});

// ═══ A ESFERA ESTADUAL — fechando o alarme que eu abri de manhã ═════════════
//
// De manhã o app passou a DENUNCIAR que o prazo do SPED (UF:SP) era entregue a
// cliente de qualquer estado. Denunciar sem dar saída é meia correção: quem era
// do Paraná via o alerta e não tinha onde cadastrar a data do Paraná.
describe('prazo ESTADUAL cadastrável — o alerta ganhou caminho', () => {
    const { mesDoCliente } = require('../sefaz-backend/catalogo-obrigacoes.js');
    const { resolverPrazoEstadual, escopoDoPrazo, idPrazoMunicipal: idPrazo,
            validarPrazoMunicipal: validar } = require('../sefaz-backend/prazos-municipais.js');

    const cadPR = (over: any = {}) => ({
        esfera: 'estadual', uf: 'PR', obrigacao: 'SPED',
        diaVencimento: 15, mesesApos: 1, baseLegal: 'NPF 001/2019 SEFA-PR',
        vigenciaInicio: '2020-01-01', ...over,
    });

    it('o escopo distingue município de estado', () => {
        expect(escopoDoPrazo({ codMunIBGE: SP })).toBe('IBGE:3550308');
        expect(escopoDoPrazo({ uf: 'pr' })).toBe('UF:PR');
        expect(escopoDoPrazo({})).toBe('');
    });

    it('cadastro estadual SEM UF é recusado dizendo o que falta', () => {
        expect(validar(cadPR({ uf: '' })).erros.join(' ')).toMatch(/Informe a UF/);
        // E a base legal continua obrigatória nas duas esferas.
        expect(validar(cadPR({ baseLegal: '' })).erros.join(' ')).toMatch(/base legal/i);
    });

    it('🚨 cliente do PR com prazo do PR cadastrado SAI do alerta e ganha a data certa', () => {
        const m = mesDoCliente({
            colecao: 'lucro_empresas', regimePadrao: 'presumido', uf: 'PR',
            prazosMunicipais: [cadPR()],
        }, '06/2026');
        const sped = m.obrigacoes.find((r: any) => r.obrigacao === 'SPED');
        expect(sped.abrangencia).toBe('UF:PR');
        expect(sped.baseLegal).toMatch(/SEFA-PR/);
        // Deixou de ser "prazo de outra UF".
        expect(m.prazoDeOutraUf.some((r: any) => r.obrigacao === 'SPED')).toBe(false);
        expect(m.estaduaisResolvidas.length).toBeGreaterThan(0);
    });

    it('sem o cadastro do estado dele, o alerta continua — e agora diz ONDE cadastrar', () => {
        const m = mesDoCliente({ colecao: 'lucro_empresas', regimePadrao: 'presumido', uf: 'PR' }, '06/2026');
        const alvo = m.prazoDeOutraUf.find((r: any) => r.obrigacao === 'SPED');
        expect(alvo).toBeTruthy();
        expect(alvo.motivoAbrangencia).toMatch(/esfera estadual, UF PR/);
    });

    it('o calendário de UM estado não vale para outro', () => {
        const m = mesDoCliente({
            colecao: 'lucro_empresas', regimePadrao: 'presumido', uf: 'SC',
            prazosMunicipais: [cadPR()],
        }, '06/2026');
        expect(m.prazoDeOutraUf.some((r: any) => r.obrigacao === 'SPED')).toBe(true);
        expect(resolverPrazoEstadual([cadPR()], { uf: 'SC', obrigacao: 'SPED', competencia: '2026-06' }).situacao)
            .toBe('uf-sem-cadastro');
    });

    it('vigência vale igual na esfera estadual', () => {
        const r = resolverPrazoEstadual(
            [cadPR({ vigenciaInicio: '2027-01-01' })],
            { uf: 'PR', obrigacao: 'SPED', competencia: '2026-06' });
        expect(r.achou).toBe(false);
        expect(r.situacao).toBe('fora-de-vigencia');
    });

    it('🚨 o id MUNICIPAL não mudou — mudar orfanaria o que já está cadastrado', () => {
        expect(idPrazo({ codMunIBGE: SP, obrigacao: 'ISS', vigenciaInicio: '2020-01-01' }))
            .toBe('3550308_ISS_2020-01-01');
        expect(idPrazo(cadPR())).toBe('UF:PR_SPED_2020-01-01');
    });

    it('a conversão de competência mora num lugar só', () => {
        const { competenciaIsoDe } = require('../sefaz-backend/catalogo-obrigacoes.js');
        expect(competenciaIsoDe('06/2026')).toBe('2026-06');
        expect(competenciaIsoDe('12/2026')).toBe('2026-12');
        const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/catalogo-obrigacoes.js'), 'utf8');
        // Uma definição, nenhuma cópia — o descasamento mordeu 3× hoje.
        expect((fonte.match(/String\(mes\)\.padStart\(2, '0'\)/g) || []).length).toBeLessThanOrEqual(1);
    });
});

describe('a esfera estadual tem TELA e ROTA — não repito o código morto', () => {
    const RAIZ = join(__dirname, '..');
    it('a tela oferece as duas esferas e pede UF na estadual', () => {
        const tela = readFileSync(join(RAIZ, 'components/PrazosMunicipaisPanel.tsx'), 'utf8');
        expect(tela).toMatch(/Estadual \(SPED\)/);
        expect(tela).toMatch(/form\.esfera === 'estadual'/);
        expect(tela).toMatch(/UF \(2 letras\)/);
    });
    it('a rota grava a esfera e a UF', () => {
        const rota = readFileSync(join(RAIZ, 'sefaz-backend/prazos-municipais-routes.js'), 'utf8');
        expect(rota).toMatch(/esfera: String\(p\.esfera/);
        expect(rota).toMatch(/uf: String\(p\.uf/);
    });
});
