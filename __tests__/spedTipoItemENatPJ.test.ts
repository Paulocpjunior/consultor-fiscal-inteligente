// ============================================================================
// 🚨 DOIS CAMPOS DO BLOCO 0 QUE SAÍAM COM DEFAULT — e default de campo fiscal
// é invenção com outro nome (varredura dos leitores de documento, 21/08).
//
// (1) **TIPO_ITEM '00'** — "Mercadoria para Revenda" — em TODO item do 0200,
//     inclusive no item SINTÉTICO que representa a NFS-e sem discriminação, que
//     existe justamente porque o documento é de SERVIÇO. O Guia Prático 3.2.3 é
//     literal: o serviço de competência municipal *"deverá ser criado o
//     correspondente item no registro 0200, cujo conteúdo do campo TIPO_ITEM
//     será igual '09' (Serviços)"*. E o campo 08 do mesmo registro: *"Não
//     existe COD-NCM para serviços"* — o gerador escrevia '00000000', que é NCM
//     FABRICADO, a mesma família do 'PARTSEM'.
//
// (2) **IND_NAT_PJ '00'** — "sociedade empresária em geral" — no campo 13 do
//     0000. Aqui o defeito é pior que um default: o gerador LIA
//     `dadosFiscais.indNatPJ`, e esse campo **não existia em tela nenhuma nem na
//     whitelist do backend**. Ou seja, caía no '00' SEMPRE. É a "rota sem
//     botão" (13/08) na versão CAMPO — e o arquivo declarava à Receita que a
//     COMUNIDADE EVANGÉLICA do caso de 18/08 é sociedade empresária.
//     ⚠️ O app NÃO escolhe o código (Tabela 3.1.3, oficial, fora deste repo):
//     o que muda é o SILÊNCIO.
// ============================================================================
// Este módulo TEM .d.ts (convenção do projeto) — por isso o import é direto.
import {
    tipoItemDoDocumento, ehItemDeServico, TIPO_ITEM_SERVICO, serieDoDocumento,
} from '../sefaz-backend/sped-selecao-documentos.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBloco0 } from '../sefaz-backend/sped-fiscal-bloco0.js';

const campos = (linha: string) => linha.replace(/\r?\n$/, '').split('|');
const linhaDe = (linhas: string[], reg: string) => linhas.find((l) => l.startsWith(`|${reg}|`))!;

const fonte = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
};

const dadosContrib = (over: any = {}) => ({
    empresa: { cnpj: '13344638000191', nome: 'CLINICA MEDICA MANTOAN LTDA', dadosFiscais: { uf: 'SP' } },
    competencia: '2026-07',
    competenciaInicio: '2026-07',
    competenciaFim: '2026-07',
    regimeApuracao: '2',
    notas: [], itens: [], participantes: [], unidades: [],
    warnings: [] as string[],
    ...over,
});

// ═══ (1) TIPO_ITEM ══════════════════════════════════════════════════════════

describe('🚨 TIPO_ITEM — serviço é 09, e o app declarava "mercadoria para revenda"', () => {
    it('a régua lê pelo DOCUMENTO: NFS-e é 09, NF-e é 00', () => {
        // NFS-e do portal de SP: entra por CSV/TXT e grava prestador/tomador.
        expect(tipoItemDoDocumento({ prestador: { cnpj: '1' }, tomador: { cnpj: '2' } })).toBe('09');
        // A do ADN grava o rótulo.
        expect(tipoItemDoDocumento({ tipoDoc: 'NFSe' })).toBe('09');
        // Mercadoria continua 00 — a destinação real não está no XML.
        expect(tipoItemDoDocumento({ tipo: 'NFe', modelo: '55' })).toBe('00');
    });

    it('o item de SERVIÇO sai com TIPO_ITEM 09 e NCM VAZIO — serviço não tem NCM', () => {
        const linhas: string[] = buildBloco0Contrib(dadosContrib({
            itens: [{
                codItem: 'SERV-GENERICO', descricao: 'Prestação de serviços',
                unidade: 'UN', tipo: TIPO_ITEM_SERVICO, ncm: '',
            }],
        }));
        const c = campos(linhaDe(linhas, '0200'));
        expect(c[7]).toBe('09');   // TIPO_ITEM
        expect(c[8]).toBe('');     // COD_NCM — nunca o '00000000' fabricado
        expect(c[8]).not.toBe('00000000');
    });

    it('mercadoria não muda: 00 e o NCM que veio da nota', () => {
        const linhas: string[] = buildBloco0Contrib(dadosContrib({
            itens: [{ codItem: 'P1', descricao: 'CAIXA', unidade: 'UN', tipo: '00', ncm: '48131000' }],
        }));
        const c = campos(linhaDe(linhas, '0200'));
        expect(c[7]).toBe('00');
        expect(c[8]).toBe('48131000');
    });

    it('o bloco 0 do EFD ICMS/IPI lê a MESMA régua — dois arquivos do mesmo mês não podem discordar', () => {
        const linhas: string[] = buildBloco0({
            empresa: { cnpj: '13344638000191', nome: 'X', dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            participantes: [], unidades: [], warnings: [],
            itens: [{ codItem: 'S1', descricao: 'SERVICO', unidade: 'UN', tipo: '09', ncm: '' }],
        });
        const c = campos(linhaDe(linhas, '0200'));
        expect(c[7]).toBe('09');
        expect(c[8]).toBe('');
    });

    it('ehItemDeServico responde sobre o item já classificado', () => {
        expect(ehItemDeServico({ tipo: '09' })).toBe(true);
        expect(ehItemDeServico({ tipo: '00' })).toBe(false);
        expect(ehItemDeServico({})).toBe(false);
    });

    // 🚨 A TRAVA QUE FECHA A CLASSE: corrigir a linha conserta a instância;
    // o que impede a volta do default é ninguém CRAVAR o tipo na coleta.
    it('nenhum orquestrador crava tipo: \'00\' na montagem do item', () => {
        for (const arq of ['sefaz-backend/sped-contrib-orchestrator.js', 'sefaz-backend/sped-fiscal-orchestrator.js']) {
            const src = fonte(arq);
            expect(src).not.toMatch(/tipo:\s*'00'/);
            expect(src).toMatch(/tipoItemDoDocumento\(nota\)/);
        }
    });
});

// ═══ (1b) SER — a mesma classe, um campo adiante ════════════════════════════
//
// O bloco D escrevia `nota.serie || '1'`: série INVENTADA. E o C100 caía em
// '000' mesmo quando a chave dizia outra coisa — e o PVA confere a série
// CONTRA a chave (recusa de 20/08, PWR).
describe('🚨 SER — a série sai da chave quando o campo não foi gravado', () => {
    const chave = '35260731947349000169570010000000031705547508';  // série 001

    it('campo gravado vence, com as três posições', () => {
        expect(serieDoDocumento({ serie: '3', chave })).toBe('003');
        expect(serieDoDocumento({ serie: 12 })).toBe('012');
    });

    it('sem o campo, a CHAVE responde — posições 23-25', () => {
        expect(serieDoDocumento({ chave })).toBe('001');
        expect(serieDoDocumento({ chave })).not.toBe('1');
    });

    it('sem campo e sem chave é 000 — o Guia manda 000 quando não há série', () => {
        expect(serieDoDocumento({})).toBe('000');
        expect(serieDoDocumento(null)).toBe('000');
    });

    it('e nenhum gerador volta a cravar a série', () => {
        for (const arq of [
            'sefaz-backend/sped-fiscal-blocoC.js',
            'sefaz-backend/sped-fiscal-blocoD.js',
            'sefaz-backend/sped-contrib-blocos.js',
        ]) {
            expect(fonte(arq)).not.toMatch(/nota\.serie \|\| '1'/);
        }
    });
});

// ═══ (2) IND_NAT_PJ ═════════════════════════════════════════════════════════

describe('🚨 IND_NAT_PJ — o campo era lido de um cadastro que não existia', () => {
    const igreja = (df: any = {}) => ({
        cnpj: '13344638000191', nome: 'COMUNIDADE EVANGELICA SARA NOSSA TERRA',
        dadosFiscais: { uf: 'SP', regimeTributario: 'IMUNE', ...df },
    });

    it('entidade IMUNE sem o cadastro: o 00 sai DITO, com o lugar de preencher', () => {
        const d = dadosContrib({ empresa: igreja() });
        buildBloco0Contrib(d);
        const aviso = d.warnings.find((w: string) => w.includes('IND_NAT_PJ'));
        expect(aviso).toBeDefined();
        expect(aviso).toContain('00');
        expect(aviso).toContain('Dados Fiscais');
    });

    it('sem fins lucrativos é OUTRO eixo e acende igual', () => {
        const d = dadosContrib({
            empresa: {
                cnpj: '13344638000191', nome: 'ASSOCIACAO X',
                dadosFiscais: { uf: 'SP', regimeTributario: 'LUCRO_PRESUMIDO', semFinsLucrativos: true },
            },
        });
        buildBloco0Contrib(d);
        expect(d.warnings.some((w: string) => w.includes('IND_NAT_PJ'))).toBe(true);
    });

    it('cadastrado, o código do cadastro VAI ao arquivo e o aviso some', () => {
        const d = dadosContrib({ empresa: igreja({ indNatPJ: '02' }) });
        const linhas: string[] = buildBloco0Contrib(d);
        expect(campos(linhaDe(linhas, '0000'))[13]).toBe('02');
        expect(d.warnings.some((w: string) => w.includes('IND_NAT_PJ'))).toBe(false);
    });

    it('empresa comum NÃO ganha aviso — alarme sem ação é o que ensina a ignorar alarme', () => {
        const d = dadosContrib({
            empresa: {
                cnpj: '13344638000191', nome: 'PWR LTDA',
                dadosFiscais: { uf: 'SP', regimeTributario: 'LUCRO_PRESUMIDO' },
            },
        });
        buildBloco0Contrib(d);
        expect(d.warnings.some((w: string) => w.includes('IND_NAT_PJ'))).toBe(false);
        expect(campos(linhaDe(buildBloco0Contrib(d), '0000'))[13]).toBe('00');
    });

    // Regra do #382: campo novo do modal ENTRA na whitelist no MESMO PR —
    // fora dela o modal diz "salvo" e nada persiste.
    it('o campo tem onde ser preenchido E onde ser gravado', () => {
        expect(fonte('sefaz-backend/empresa-status-routes.js')).toContain("'indNatPJ'");
        expect(fonte('components/EmpresaDadosFiscaisModal.tsx')).toContain("handleField('indNatPJ'");
    });
});
