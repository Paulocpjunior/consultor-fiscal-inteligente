// @ts-expect-error — módulo .js puro (sem tipos)
import { auditarSaidaSped, resumoAuditoria, valorSped, campo } from '../sefaz-backend/sped-auditoria-saida';

/**
 * Paulo, 06/08: *"esses erros não podem acontecer"*.
 *
 * Três defeitos da MESMA FAMÍLIA passaram pelos testes unitários e só
 * apareceram na leitura humana do código: IPI em E200/E210 (04/08), E110 campo
 * 11 com saldo credor (02/08) e o inventário inteiro zerado (06/08). Nenhum
 * teste de unidade pega isso — cada função fazia exatamente o que o próprio
 * teste mandava. O que faltava era olhar o ARQUIVO QUE SAIU.
 *
 * Os casos abaixo REPRODUZEM os defeitos reais em forma de arquivo.
 */
const L = (...c: any[]) => `|${c.join('|')}|\r\n`;

describe('leitura posicional do arquivo', () => {
    it('o REG é o campo 1 (a linha começa com |)', () => {
        expect(campo(L('H010', 'P1', 'UN'), 1)).toBe('H010');
        expect(campo(L('H010', 'P1', 'UN'), 2)).toBe('P1');
    });

    it('valor vazio é AUSÊNCIA, não zero', () => {
        expect(valorSped('')).toBeNull();
        expect(valorSped('0,00')).toBe(0);
        expect(valorSped('1.234,56')).toBe(1234.56);
    });
});

describe('o inventário zerado (defeito real de 06/08) é pego pelo arquivo', () => {
    // Como saía antes: 3 itens, todos com QTD e VL_UNIT zero, porque o campo
    // nunca foi preenchido em lugar nenhum do app.
    const arquivoRuim = [
        L('H001', '0'),
        L('H005', '31122026', '0,00', '01'),
        L('H010', 'P1', 'UN', '0,000', '0,000000', '0,00', '0', '', '', '', ''),
        L('H010', 'P2', 'UN', '0,000', '0,000000', '0,00', '0', '', '', '', ''),
        L('H010', 'P3', 'UN', '0,000', '0,000000', '0,00', '0', '', '', '', ''),
        L('H990', '6'),
    ];

    it('acusa a coluna inteira zerada e explica as duas leituras possíveis', () => {
        const r = auditarSaidaSped(arquivoRuim);
        expect(r.ok).toBe(false);
        const qtd = r.suspeitas.find((s: any) => s.tipo === 'coluna-toda-zerada' && /QTD/.test(s.detalhe));
        expect(qtd).toBeTruthy();
        expect(qtd.gravidade).toBe('bloqueia');
        expect(qtd.detalhe).toMatch(/não foi informado|campo errado/);
    });

    it('inventário de verdade passa limpo', () => {
        const r = auditarSaidaSped([
            L('H001', '0'),
            L('H005', '31122026', '28,30', '01'),
            L('H010', 'P1', 'UN', '10,000', '2,500000', '25,00', '0', '', '', '', ''),
            L('H010', 'P2', 'UN', '3,000', '1,100000', '3,30', '0', '', '', '', ''),
            L('H990', '5'),
        ]);
        expect(r.ok).toBe(true);
        expect(resumoAuditoria(r)).toMatch(/nenhuma coluna de valor totalmente zerada/);
    });
});

describe('total no campo errado (o H005 que punha VL_AJ_PERDA no lugar do VL_INV)', () => {
    it('total zerado com detalhes somando é acusado com os dois números', () => {
        const r = auditarSaidaSped([
            L('H001', '0'),
            L('H005', '31122026', '0,00', '01'),          // VL_INV foi pro campo errado
            L('H010', 'P1', 'UN', '10,000', '2,500000', '25,00', '0', '', '', '', ''),
            L('H990', '4'),
        ]);
        const t = r.suspeitas.find((s: any) => s.tipo === 'total-nao-bate');
        expect(t).toBeTruthy();
        expect(t.detalhe).toMatch(/declara 0\.00/);
        expect(t.detalhe).toMatch(/é 25\.00/);
    });

    it('diferença de centavo não é divergência', () => {
        const r = auditarSaidaSped([
            L('H001', '0'),
            L('H005', '31122026', '25,00', '01'),
            L('H010', 'P1', 'UN', '10,000', '2,500000', '25,00', '0', '', '', '', ''),
            L('H990', '4'),
        ]);
        expect(r.suspeitas.filter((s: any) => s.tipo === 'total-nao-bate')).toHaveLength(0);
    });
});

describe('bloco que promete conteúdo e entrega vazio', () => {
    it('IND_MOV=0 sem nenhum registro de detalhe é acusado', () => {
        const r = auditarSaidaSped([L('H001', '0'), L('H990', '2')]);
        const s = r.suspeitas.find((x: any) => x.tipo === 'bloco-vazio-declarado-cheio');
        expect(s).toBeTruthy();
        expect(s.detalhe).toMatch(/Ou gera o conteúdo, ou declara IND_MOV=1/);
    });

    it('IND_MOV=1 (bloco sem dados) é legítimo e não acusa nada', () => {
        const r = auditarSaidaSped([L('H001', '1'), L('H990', '2')]);
        expect(r.ok).toBe(true);
    });
});

describe('campo obrigatório em branco', () => {
    it('coluna inteira VAZIA é diferente de zerada, e também trava', () => {
        const r = auditarSaidaSped([
            L('H001', '0'),
            L('H005', '31122026', '0,00', '01'),
            L('H010', 'P1', 'UN', '', '', '', '0', '', '', '', ''),
            L('H990', '4'),
        ]);
        const s = r.suspeitas.find((x: any) => x.tipo === 'coluna-vazia');
        expect(s).toBeTruthy();
        expect(s.detalhe).toMatch(/não passa no PVA/);
    });
});

describe('a frase nunca mente', () => {
    it('auditoria que não rodou NÃO vira "está tudo certo"', () => {
        expect(resumoAuditoria(null)).toMatch(/não dá pra dizer que está tudo certo/);
    });

    it('arquivo vazio não inventa problema', () => {
        expect(auditarSaidaSped([]).ok).toBe(true);
    });
});
