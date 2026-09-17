// ============================================================================
// 🚨 "O SPED DA 1137 - EDUARDO GUERRA DEU ESSE ERRO DE ESTRUTURA DESSE BLOCO"
//
// 17/09, Paulo — EFD ICMS/IPI 08/2026, com o Relatório de Erros de Importação
// do PVA: **Total de Erros: 1**, linha 5363, campo `2 - IND_MOV`, registro
// `D001`, conteúdo do registro **`|D001|0|`**:
//
//   *"Registro de abertura do bloco informa que o bloco tem movimento, no
//   entanto nenhum registro foi informado no bloco."*
//
// ═══ A CAUSA É DE ORDEM, NÃO DE LEITURA ═════════════════════════════════════
//
// O `IND_MOV` era decidido pela SELEÇÃO (`notas.length > 0`) e o conteúdo,
// pelo LAÇO — dois passos do gerador respondendo o MESMO fato. Quando o laço
// descarta tudo, a abertura já foi escrita prometendo movimento.
//
// Na EDUARDO GUERRA (tomadora de frete) o que descarta é a régua de 21/08:
// **CT-e sem CFOP legível NÃO ENTRA**, porque cravar o CFOP declararia a
// NATUREZA da operação de transporte no escuro (foi o `5352` em 100% dos
// conhecimentos). Essa régua está CERTA e continua de pé: quem muda é a
// ABERTURA, que passa a falar do que o gerador EMITIU.
//
// ⚠️ O BLOCO C ENTRA JUNTO. Ele tinha a MESMA forma e hoje não descarta nada
// no laço — mas meia trava protege o cliente que já quebrou e deixa o próximo
// descoberto (22/08), e um `continue` futuro no bloco C reintroduziria o
// defeito em silêncio.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import * as fmt from '../sefaz-backend/sped-fiscal-format.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
import { auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';

const CNPJ = '11222333000181';
const EMPRESA = {
    cnpj: CNPJ, razaoSocial: 'EMPRESA TESTE LTDA',
    dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
};

/** CT-e como a captura ANTERIOR a 21/08 gravava: sem CFOP em forma nenhuma. */
const CTE_SEM_CFOP = {
    id: 'c1', chave: '35260844555666000177570010000000011234567890',
    tipo: 'CTe', tipoDoc: 'CTe', status: 'autorizado', direcao: 'entrada',
    numero: '123', serie: '1', competencia: '2026-08',
    dataEmissao: '2026-08-10', dhEmi: '2026-08-10', valorTotal: 500,
    emitente: { cnpjCpf: '44555666000177', nome: 'TRANSPORTADORA TESTE LTDA' },
    totais: { vBC: 500, vICMS: 60 }, aliqIcms: 12,
};
const CTE_COM_CFOP = { ...CTE_SEM_CFOP, id: 'c2', numero: '124', cfop: '5352', cstIcms: '00' };

const NFE = {
    id: 'n1', chave: '35260811222333000181550010000000011234567890',
    tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado', direcao: 'saida',
    numero: '16', serie: '1', competencia: '2026-08',
    dataEmissao: '2026-08-27', dhEmi: '2026-08-27',
    destinatario: { cnpjCpf: '44555666000177', nome: 'CLIENTE TESTE LTDA' },
    totais: { vNF: 1000, vProd: 1000, vBC: 1000, vICMS: 180 },
    itens: [{
        nItem: 1, cProd: '9', xProd: 'TELHA', cfop: '5101', uCom: 'MT', qCom: 1,
        vProd: 1000, vBC: 1000, aliqIcms: 18, vICMS: 180, cst: '00',
    }],
};

const dados = (notas: any[]) => ({
    empresa: EMPRESA, notas, warnings: [] as string[],
    competenciaInicio: '2026-08', competenciaFim: '2026-08',
});
const abertura = (linhas: string[], reg: string) =>
    String(linhas.find((l: string) => l.startsWith(`|${reg}|`)) || '').split('|')[2];
const conteudo = (linhas: string[], bloco: string) =>
    linhas.filter((l: string) => {
        const r = l.split('|')[1] || '';
        return r[0] === bloco && !/^(001|990)$/.test(r.slice(1));
    });
const total990 = (linhas: string[], reg: string) =>
    Number(String(linhas.find((l: string) => l.startsWith(`|${reg}|`)) || '').split('|')[2]);

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 D001 — o caso EDUARDO GUERRA: bloco que promete movimento e não entrega', () => {
    it('CT-e selecionado mas DESCARTADO no laço ⇒ D001 sai 1 (bloco SEM dados)', () => {
        const linhas = buildBlocoD(dados([CTE_SEM_CFOP]));
        expect(conteudo(linhas, 'D')).toHaveLength(0);
        expect(abertura(linhas, 'D001')).toBe('1');
    });

    it('é exatamente a linha que o PVA recusou — |D001|0| sem conteúdo não sai mais', () => {
        const linhas = buildBlocoD(dados([CTE_SEM_CFOP]));
        expect(linhas.join('')).not.toContain('|D001|0|');
        expect(linhas.map((l: string) => l.trim())).toEqual(['|D001|1|', '|D990|2|']);
    });

    it('CT-e que ENTRA mantém o D001 em 0, com D100 e D190', () => {
        const linhas = buildBlocoD(dados([CTE_COM_CFOP]));
        expect(abertura(linhas, 'D001')).toBe('0');
        expect(linhas.filter((l: string) => l.startsWith('|D100|'))).toHaveLength(1);
        expect(linhas.filter((l: string) => l.startsWith('|D190|'))).toHaveLength(1);
    });

    it('um entra e outro cai: o bloco tem movimento, e o D990 conta certo', () => {
        const linhas = buildBlocoD(dados([CTE_COM_CFOP, CTE_SEM_CFOP]));
        expect(abertura(linhas, 'D001')).toBe('0');
        // D001 + D100 + D190 + D990
        expect(total990(linhas, 'D990')).toBe(4);
        expect(total990(linhas, 'D990')).toBe(linhas.length);
    });

    it('sem CT-e nenhum continua 1, e SEM aviso (não há o que dizer)', () => {
        const d = dados([NFE]);
        const linhas = buildBlocoD(d);
        expect(abertura(linhas, 'D001')).toBe('1');
        expect(total990(linhas, 'D990')).toBe(2);
        expect(d.warnings).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o que ficou de fora sai DITO — com a consequência, não só a contagem', () => {
    const aviso = (notas: any[]) => {
        const d = dados(notas);
        buildBlocoD(d);
        return d.warnings.find((w) => w.includes('Bloco D')) || '';
    };

    it('nomeia o CT-e e a razão (o CFOP não foi capturado)', () => {
        const w = aviso([CTE_SEM_CFOP]);
        expect(w).toContain('123');
        expect(w).toMatch(/CFOP não foi capturado/);
    });

    // ⚠️ Sem esta frase, quem abrir o arquivo vê um bloco D vazio e conclui que
    // a empresa não teve frete no mês — quando o frete existe e ficou de fora.
    it('quando TODOS caem, diz que o bloco sai sem dados e que o ICMS fica fora', () => {
        const w = aviso([CTE_SEM_CFOP]);
        expect(w).toMatch(/bloco D sai SEM DADOS/i);
        expect(w).toMatch(/NENHUM frete foi escriturado/i);
        expect(w).toMatch(/ICMS desses conhecimentos fica fora do livro/i);
    });

    it('quando só PARTE cai, não afirma que o bloco ficou vazio', () => {
        const w = aviso([CTE_COM_CFOP, CTE_SEM_CFOP]);
        expect(w).not.toMatch(/bloco D sai SEM DADOS/i);
        expect(w).toMatch(/ICMS deles fica fora do livro/i);
    });

    it('manda reler os XMLs guardados e regerar — a ação que resolve', () => {
        const w = aviso([CTE_SEM_CFOP]);
        expect(w).toContain('♻️');
        expect(w).toMatch(/regere o arquivo/i);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o bloco C entra no MESMO eixo — meia trava não fecha a classe', () => {
    it('com nota, C001 sai 0 e o C990 conta a abertura e a si mesmo', () => {
        const linhas = buildBlocoC(dados([NFE]));
        expect(abertura(linhas, 'C001')).toBe('0');
        expect(total990(linhas, 'C990')).toBe(linhas.length);
        expect(conteudo(linhas, 'C').length).toBeGreaterThan(0);
    });

    it('sem nota do bloco C, C001 sai 1 (o CT-e é do bloco D, não conta aqui)', () => {
        const linhas = buildBlocoC(dados([CTE_COM_CFOP]));
        expect(abertura(linhas, 'C001')).toBe('1');
        expect(conteudo(linhas, 'C')).toHaveLength(0);
        expect(total990(linhas, 'C990')).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ O QUE RODA EM PRODUÇÃO É A COMPOSIÇÃO (26/08): cada módulo passa fazendo o
// que o próprio teste manda, e quem trava a transmissão é a auditoria lendo o
// arquivo GERADO. Foi ela que acusou o caso dele na tela — em 3 minutos, no
// lugar de uma volta de PVA.
describe('🚨 gerador → auditoria: a trava que pegou o caso nasce MUDA no corrigido', () => {
    const auditar = (notas: any[]) => auditarSaidaSped(buildBlocoD(dados(notas)));
    const blocoVazio = (r: any) =>
        (r?.suspeitas || []).filter((s: any) => s.tipo === 'bloco-vazio-declarado-cheio');

    it('bloco D com todos os CT-e descartados NÃO acende mais', () => {
        expect(blocoVazio(auditar([CTE_SEM_CFOP]))).toHaveLength(0);
    });

    it('bloco D com movimento também fica mudo', () => {
        expect(blocoVazio(auditar([CTE_COM_CFOP]))).toHaveLength(0);
    });

    // A prova de que a trava continua viva: o arquivo do dia 17/09, byte a byte.
    it('e ela GRITA sobre a linha exata que o PVA recusou (|D001|0| sem conteúdo)', () => {
        const r = auditarSaidaSped(['|D001|0|\r\n', '|D990|2|\r\n']);
        const s = blocoVazio(r);
        expect(s).toHaveLength(1);
        expect(s[0].gravidade).toBe('bloqueia');
        expect(s[0].detalhe).toMatch(/não tem nenhum registro de conteúdo/i);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 abrirBloco — o dono do IND_MOV', () => {
    it('conteúdo vazio ⇒ 1 (bloco SEM dados)', () => {
        expect(fmt.abrirBloco('D001', []).trim()).toBe('|D001|1|');
    });

    it('conteúdo presente ⇒ 0 (bloco COM dados)', () => {
        expect(fmt.abrirBloco('C001', ['|C100|…|']).trim()).toBe('|C001|0|');
    });

    // Argumento que não chegou não pode virar "tem movimento": o campo vazio o
    // PVA acusa, o IND_MOV mentindo ele também — mas o segundo manda procurar
    // conteúdo que não existe.
    it('argumento ausente NÃO vira promessa de movimento', () => {
        expect((fmt.abrirBloco as any)('D001').trim()).toBe('|D001|1|');
        expect((fmt.abrirBloco as any)('D001', null).trim()).toBe('|D001|1|');
    });
});
