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
