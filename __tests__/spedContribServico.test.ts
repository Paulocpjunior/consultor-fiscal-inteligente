// ============================================================================
// 🚨 EFD-CONTRIBUIÇÕES DE PRESTAÇÃO DE SERVIÇO — o arquivo saía DECLARANDO ZERO.
//
// Paulo, 17/08, testando dois clientes: *"fui testar um EFD Contribuições de
// prestação de serviço e puxou zerado alguns blocos"*.
//
// ═══ O QUE OS ARQUIVOS REAIS MOSTRARAM ══════════════════════════════════════
//
// CLINICA MEDICA MANTOAN 07/2026 — 37 registros A100, e TODOS assim:
//   |A100|1|0|||||7870||16072026|16072026|0,00|||0,00|0,00|0,00|0,00||||
//          ↑ COD_PART vazio                ↑ VL_DOC 0,00
// Os documentos ESTAVAM no banco. O que faltou foi a LEITURA: a NFS-e do portal
// de SP entra ACHATADA (`cnpjDest`, `valorTotal`) e o gerador lia só a forma
// ANINHADA (`nota.destinatario`, `nota.valor`). É a armadilha de 11/08.
//
// RADIO E TV IBIRAPUERA 07/2026 — zero documento (cliente do DF, sem trilho de
// captura), `A001|1|` e M200/M600 zerados, com a ficha do CFI marcando
// R$ 2.000,00 de faturamento.
//
// E o `0110` dos DOIS dizia `IND_REG_CUM = 1` — regime de CAIXA consolidado no
// registro **F500**, que este gerador nunca produz. O arquivo mentia sobre si
// mesmo. O EFD do E-Fiscal ACEITO (06/2025, mesmo cliente) usa **9**:
// escrituração detalhada nos blocos A/C/D/F.
// ============================================================================
import { buildBlocoA, valorDoDocumentoServico } from '../sefaz-backend/sped-contrib-blocos.js';
import { DETALHES_VIGIADOS, auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';
import { validarNotaDigitada } from '../services/notaDigitada';
import { readFileSync } from 'fs';
import { join } from 'path';

const empresa = { cnpj: '13344638000191', nome: 'CLINICA MEDICA MANTOAN LTDA' };

/** NFS-e como o portal de SP grava: ACHATADA. */
const nfseAchatada = (over: any = {}) => ({
    tipo: 'NFSe',
    direcao: 'saida',
    numero: '7870',
    dataEmissao: '2026-07-16',
    cnpjEmit: '13344638000191',
    xNomeEmit: 'CLINICA MEDICA MANTOAN LTDA',
    cnpjDest: '00621930000162',
    xNomeDest: 'FED NACIONAL COM EVANG SARA NOSSA TERRA',
    valorTotal: 2000,
    totais: { vNF: 2000, vServ: 2000 },
    ...over,
});

/** NFS-e como o XML/abrasf grava: ANINHADA. */
const nfseAninhada = (over: any = {}) => ({
    tipo: 'NFSe',
    direcao: 'saida',
    numero: '0000029',
    dataEmissao: '2025-06-24',
    prestador: { cnpjCpf: '09010732000137', nome: 'RADIO E TV IBIRAPUERA LTDA' },
    tomador: { cnpjCpf: '00621930000162', nome: 'FED NACIONAL COMUNIDADE EVANGELICA' },
    valor: 2000,
    ...over,
});

const campos = (linha: string) => linha.split('|');
const a100De = (linhas: string[]) => linhas.filter((l) => l.startsWith('|A100|'));

describe('🚨 o documento chega em DUAS formas — e ler só uma zerava o arquivo', () => {
    it('ACHATADA (portal SP): participante e valor saem preenchidos', () => {
        const linhas = buildBlocoA({ empresa, notas: [nfseAchatada()], regimeApuracao: '2' });
        const [a100] = a100De(linhas);
        const c = campos(a100!);
        expect(c[4]).toBe('00621930000162');   // COD_PART — estava VAZIO
        expect(c[12]).toBe('2000,00');          // VL_DOC   — estava 0,00
    });

    it('ANINHADA (XML/abrasf): continua funcionando — a correção não troca um erro por outro', () => {
        const linhas = buildBlocoA({ empresa, notas: [nfseAninhada()], regimeApuracao: '2' });
        const [a100] = a100De(linhas);
        const c = campos(a100!);
        expect(c[4]).toBe('00621930000162');
        expect(c[12]).toBe('2000,00');
    });

    it('PIS e COFINS saem do valor lido — os números do arquivo aceito', () => {
        // No EFD do E-Fiscal (06/2025, aceito): base 2000,00 → PIS 13,00 e
        // COFINS 60,00 (cumulativo: 0,65% e 3%).
        const linhas = buildBlocoA({ empresa, notas: [nfseAchatada()], regimeApuracao: '2' });
        const c = campos(a100De(linhas)[0]!);
        expect(c[15]).toBe('2000,00');   // VL_BC_PIS
        expect(c[16]).toBe('13,00');     // VL_PIS
        expect(c[17]).toBe('2000,00');   // VL_BC_COFINS
        expect(c[18]).toBe('60,00');     // VL_COFINS
    });
});

describe('o valor do documento nas formas em que ele chega', () => {
    it('lê valorTotal, valor, valorServicos e o espelho em totais', () => {
        expect(valorDoDocumentoServico({ valorTotal: 2000 })).toBe(2000);
        expect(valorDoDocumentoServico({ valor: 1500 })).toBe(1500);
        expect(valorDoDocumentoServico({ valorServicos: 300 })).toBe(300);
        expect(valorDoDocumentoServico({ totais: { vNF: 42 } })).toBe(42);
        expect(valorDoDocumentoServico({ valores: { valorServicos: 7 } })).toBe(7);
    });

    it('🚨 sem NENHUMA forma devolve NaN, não zero', () => {
        // Zero silencioso aqui foi exatamente o defeito: 37 documentos de
        // R$ 0,00 num arquivo entregue à Receita. "Não achei o valor" e
        // "documento de R$ 0,00" são coisas diferentes.
        expect(Number.isNaN(valorDoDocumentoServico({}))).toBe(true);
        expect(Number.isNaN(valorDoDocumentoServico(null as any))).toBe(true);
    });

    it('valor como string com vírgula é lido', () => {
        expect(valorDoDocumentoServico({ valorTotal: '2000,50' })).toBeCloseTo(2000.5, 2);
    });
});

describe('🚨 a AUDITORIA DE SAÍDA tinha um buraco: o A100 não era vigiado', () => {
    it('A100 entrou em DETALHES_VIGIADOS, no campo do VALOR DO DOCUMENTO', () => {
        // Só o A170 estava vigiado — e o arquivo da MANTOAN não tinha NENHUM
        // A170, então a trava de "coluna zerada em 100% das linhas" não teve o
        // que olhar e o arquivo passou.
        expect((DETALHES_VIGIADOS as any).A100).toBeTruthy();
        expect((DETALHES_VIGIADOS as any).A100.campos[12]).toBe('VL_DOC');
    });

    it('🚨 e ela ACUSA o arquivo real de 17/08 — prova contra o defeito', () => {
        // Linhas do arquivo que o Paulo mandou, verbatim.
        const arquivoRuim = [
            '|A001|0|',
            '|A010|13344638000191|',
            '|A100|1|0|||||7870||16072026|16072026|0,00|||0,00|0,00|0,00|0,00||||',
            '|A100|1|0|||||7859||08072026|08072026|0,00|||0,00|0,00|0,00|0,00||||',
            '|A100|0|1|||||57265||28072026|28072026|0,00|||0,00|0,00|0,00|0,00||||',
            '|A990|5|',
        ];
        const r = auditarSaidaSped(arquivoRuim);
        const achado = r.suspeitas.some((s: any) => s.registro === 'A100');
        expect(achado).toBe(true);
        expect(r.ok).toBe(false);
    });

    it('arquivo com valor de verdade NÃO acusa nada', () => {
        const arquivoBom = [
            '|A001|0|',
            '|A010|13344638000191|',
            '|A100|1|0|00621930000162|00|||7870||16072026|16072026|2000,00|0|0,00|2000,00|13,00|2000,00|60,00|0,00|0,00|40,00|',
            '|A990|4|',
        ];
        const r = auditarSaidaSped(arquivoBom);
        expect(r.suspeitas.some((s: any) => s.registro === 'A100')).toBe(false);
    });
});

// @ts-expect-error módulo JS puro sem tipos
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

describe('🚨 o 0110 não pode mentir sobre o que o arquivo faz', () => {
    const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-contrib-bloco0.js'), 'utf8');

    // ⚠️ TESTE TROCADO EM 20/08, e o motivo é o de sempre: ele travava o valor
    // CRAVADO ('9') no TEXTO do arquivo, e o campo passou a ser DERIVADO do que
    // o gerador produziu — 2 quando a receita vem do F550 (AFFITTARE, aluguel),
    // 9 quando vem dos blocos A/C/D. O comentário do próprio código já previa
    // este dia. Travar a fonte impediria a correção; agora se prova pelo
    // COMPORTAMENTO, que é o que o arquivo carrega.
    it('IND_REG_CUM = 9 quando a escrituração é DETALHADA (A/C/D/F), nunca 1 (caixa/F500)', () => {
        // O gerador NUNCA produz F500, então declarar 1 era afirmar sobre si
        // mesmo uma coisa que não fazia. 9 é o que o arquivo ACEITO do E-Fiscal
        // usa para o mesmo cliente.
        const linhas = buildBloco0Contrib({
            empresa: { cnpj: '13344638000191', nome: 'X', dadosFiscais: {} },
            competencia: '2026-07', competenciaInicio: '2026-07', competenciaFim: '2026-07',
            regimeApuracao: '2', notas: [], itens: [], participantes: [], unidades: [], warnings: [],
        });
        expect(linhas.find((l: string) => l.startsWith('|0110|'))!.trim()).toBe('|0110|2||1|9|');
        const semComentarios = fonte
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(semComentarios).not.toMatch(/indRegCum\s*=\s*\([^)]*\)\s*\?\s*'1'/);
    });
});

describe('🚨 a nota digitada precisa do createdBy — sem ele o Firestore RECUSA', () => {
    const servico = readFileSync(join(__dirname, '..', 'services/notaDigitada.ts'), 'utf8');
    const form = readFileSync(join(__dirname, '..', 'components/xml/NotaDigitadaForm.tsx'), 'utf8');
    const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8');

    it('a regra do CREATE exige createdBy == auth.uid, e não abre exceção para admin', () => {
        // É o que produzia "Missing or insufficient permissions" no print de
        // 17/08 — a terceira porta nunca gravou nota NOVA, nem para o dono.
        const bloco = rules.slice(rules.indexOf('match /documentos_fiscais/'));
        expect(bloco).toMatch(/allow create: if isSignedIn\(\) && request\.resource\.data\.createdBy == request\.auth\.uid/);
    });

    /**
     * 📌 ASSERÇÃO TROCADA PELA INTENÇÃO (04/09).
     *
     * Ela cravava `toBe(2)` — mercadoria e serviço —, ou seja travava a FORMA
     * de um mundo com duas espécies. Ao nascer a terceira (CT-e / CT-e OS, o
     * caso J.P. PISSATO) o número virou 3 e o teste caiu sobre código CERTO.
     *
     * O que ela protege continua de pé, e agora sem envelhecer: **TODA
     * montagem de documento leva o `createdBy`**. Sem ele o Firestore recusa o
     * CREATE com "Missing or insufficient permissions" — a mensagem que manda
     * procurar problema de permissão que não existe, e que fez a terceira porta
     * não gravar nota nenhuma até 17/08. Espécie nova sem o campo quebra aqui.
     */
    it('TODA montagem de documento leva createdBy — nenhuma espécie fica de fora', () => {
        const montagens = (servico.match(/\} as unknown as DocumentoFiscal;/g) || []).length;
        const comCreatedBy = (servico.match(/createdBy: i\.createdByUid \|\| null/g) || []).length;
        expect(montagens).toBeGreaterThanOrEqual(3);
        expect(comCreatedBy).toBe(montagens);
    });

    it('e o formulário passa o UID de quem está logado', () => {
        expect(form).toMatch(/createdByUid: getAuth\(\)\.currentUser\?\.uid/);
    });

    it('🚨 sem UID a recusa DIZ a causa e a saída — não deixa o banco responder', () => {
        // "Missing or insufficient permissions" manda a pessoa procurar problema
        // de permissão que não existe. A validação para ANTES, com a ação.
        const erros = validarNotaDigitada({
            empresaId: 'emp1',
            empresaCnpj: '13.344.638/0001-91',
            empresaNome: 'CLINICA MEDICA MANTOAN LTDA',
            direcao: 'saida',
            numero: '7870',
            dhEmi: '2026-07-16',
            participanteNome: 'FED NACIONAL COM EVANG SARA NOSSA TERRA',
            valorTotal: 2000,
            itens: [{ cfop: '5933', vProd: 2000 }],
            digitadaPorEmail: 'colab@spassessoriacontabil.com.br',
            createdByUid: '',
        } as any);
        expect(erros.some((e) => /saia e entre de novo/i.test(e))).toBe(true);
    });
});
