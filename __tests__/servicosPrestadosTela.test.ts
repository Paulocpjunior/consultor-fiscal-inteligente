// ============================================================================
// A TELA DO R-2020 — e a régua que ela NÃO pode reimplementar.
//
// Paulo, 08/09: *"preciso gerar a REINF de INSS de serviços prestados e não
// está habilitado, pode liberar"*, com o `evtServPrest` aceito em produção.
//
// Rota nova nasce com o botão que a chama NO MESMO PR (mata-burro de 13/08) —
// e a tela mostra; ela não decide.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizarServicoPrestado } from '../sefaz-backend/reinf-servicos-prestados.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const painel = ler('components/EfdReinf/ServicosPrestadosPanel.tsx');
const servico = ler('services/reinfServicosPrestadosService.ts');
const hub = ler('components/DCTFWeb/DctfwebHub.tsx');

describe('a tela existe, está montada e não tem régua própria', () => {
    it('está no hub, com caminho para o colaborador', () => {
        expect(hub).toMatch(/ServicosPrestadosPanel/);
        expect(hub).toMatch(/R-2020 serviços prestados/);
        expect(hub).toMatch(/sub === 'servicos-prestados' && <ServicosPrestadosPanel/);
    });

    it('lê do backend e NÃO recalcula alíquota, base nem retenção', () => {
        expect(servico).toMatch(/\/api\/admin\/reinf\/servicos-prestados/);
        expect(painel).not.toMatch(/\b11\s*\/\s*100|0\.11\b/);
        expect(painel).not.toMatch(/vlrBruto\s*\*/);
        expect(painel).not.toMatch(/aliquotaAparente\s*=/);
    });

    it('base NÃO PROVADA aparece como texto, nunca como número', () => {
        expect(painel).toMatch(/vlrTotalBaseRet === null/);
        expect(painel).toMatch(/não provada/);
    });

    it('o INSS informado à mão sai CARIMBADO com quem informou', () => {
        expect(painel).toMatch(/inssOrigem === 'ajuste-declarado'/);
        expect(painel).toMatch(/n\.ajuste\?\.autor/);
    });

    it('as ressalvas vêm do backend', () => {
        expect(painel).toMatch(/dados\.ressalvas/);
        expect(painel).not.toMatch(/tpServico.*tabela 06/s);
    });

    it('o que ficou de FORA aparece: sem retenção, tomador PF e tomador ilegível', () => {
        expect(painel).toMatch(/semRetencaoPrevidenciaria/);
        expect(painel).toMatch(/tomadorPessoaFisica/);
        expect(painel).toMatch(/semTomadorLegivel/);
    });

    it('lista vazia não é prova de ausência de retenção', () => {
        expect(painel).toMatch(/não prova/);
    });

    it('a tela pede o CNPJ do PRESTADOR — é ele quem declara', () => {
        expect(painel).toMatch(/CNPJ do PRESTADOR/);
        expect(painel).not.toMatch(/CNPJ do TOMADOR \(14/);
    });
});

// ═══ O TIPO É CONTRATO COM O APP IRMÃO ══════════════════════════════════════
// Tipo que descreve campo inexistente não falha na hora: ele espera alguém
// mandar `undefined` para dentro de uma declaração. Varredura, não lista.
describe('a interface declara só campos que o payload REALMENTE tem', () => {
    const nota = normalizarServicoPrestado({ numero: '1', valorServicos: 1000, valorInss: 110 });

    const declarados = (() => {
        const bloco = servico.match(/export interface NotaR2020 \{([\s\S]*?)\n\}/);
        if (!bloco) throw new Error('interface NotaR2020 não encontrada');
        return [...bloco[1].matchAll(/^\s{4}(\w+)\??:/gm)].map((m) => m[1]);
    })();

    it('a varredura acha os campos', () => {
        expect(declarados.length).toBeGreaterThan(8);
        expect(declarados).toContain('dtEmissao');
        expect(declarados).toContain('inssOrigem');
        expect(declarados).not.toContain('indCPRB');
    });

    it('todo campo declarado existe no payload — nenhum sobra descrevendo nada', () => {
        const chaves = new Set(Object.keys(nota));
        expect(declarados.filter((c) => !chaves.has(c))).toEqual([]);
    });

    it('e o payload não tem campo que o tipo esconde', () => {
        const escondidos = Object.keys(nota).filter((c) => !declarados.includes(c));
        expect(escondidos).toEqual([]);
    });
});
