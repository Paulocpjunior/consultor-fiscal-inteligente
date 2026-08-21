import { auditarSaidaSped, resumoAuditoria, valorSped, campo, linhasMalformadas } from '../sefaz-backend/sped-auditoria-saida';

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
        expect(qtd!.gravidade).toBe('bloqueia');
        expect(qtd!.detalhe).toMatch(/não foi informado|campo errado/);
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
        expect(t!.detalhe).toMatch(/declara 0\.00/);
        expect(t!.detalhe).toMatch(/é 25\.00/);
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
        expect(s!.detalhe).toMatch(/Ou gera o conteúdo, ou declara IND_MOV=1/);
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
        expect(s!.detalhe).toMatch(/não passa no PVA/);
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

/**
 * A regra do CLAUDE.md diz que a auditoria roda em TODO arquivo gerado — e até
 * 06/08 ela só estava ligada no SPED Fiscal. Escrever a regra e não ligar em
 * todo lugar é a folga que deixa o próximo defeito passar.
 */
describe('SPED Contribuições entra na mesma trava', () => {
    it('itens de serviço com VALOR zerado em todas as linhas é acusado', () => {
        const r = auditarSaidaSped([
            L('A001', '0'),
            L('A100', '0', '', 'F1', '', '00', '55', '1', '10', '01012026', '0,00'),
            L('A170', '1', 'S1', 'SERVICO', '0,00', '', '0', '01', '0,00', '0,6500', '0,00', '01', '0,00', '3,0000', '0,00', '', ''),
            L('A170', '2', 'S2', 'SERVICO', '0,00', '', '0', '01', '0,00', '0,6500', '0,00', '01', '0,00', '3,0000', '0,00', '', ''),
            L('A990', '5'),
        ]);
        const s = r.suspeitas.find((x: any) => x.registro === 'A170');
        expect(s).toBeTruthy();
        expect(s!.detalhe).toMatch(/VL_ITEM/);
    });

    it('base de PIS zerada NÃO é vigiada — é legítima em CST sem crédito', () => {
        // Se fosse, todo arquivo de empresa cumulativa acenderia alarme falso —
        // e alarme falso ensina a ignorar alarme.
        const r = auditarSaidaSped([
            L('A001', '0'),
            L('A170', '1', 'S1', 'SERVICO', '100,00', '', '0', '01', '0,00', '0,0000', '0,00', '01', '0,00', '0,0000', '0,00', '', ''),
            L('A990', '3'),
        ]);
        expect(r.ok).toBe(true);
    });
});

// ═══ A FORMA DA LINHA — a trava que faltava no EFD-Contribuições ════════════
//
// O bloco E de ST saiu com NOVE registros grudados numa linha (REALITY 0899 ·
// 07/2026, 21/08) e nada acusou: o 9900, a prevalidação e esta auditoria leem
// LINHA A LINHA, e a linha grudada é invisível para quem pergunta pelo
// registro. A R15 fechou a classe no ICMS/IPI — e o EFD-Contribuições, que usa
// o MESMO buildLine e a MESMA auditoria, ficaria descoberto.
describe('🚨 linha malformada — a régua roda nos DOIS arquivos', () => {
    // A linha REAL do arquivo da REALITY, encurtada.
    const grudada = 'E200|MG|01072026|31072026|E210|1|0,00|0,00|2,03|0,00|0,00'
        + '|E200|SP|01072026|31072026||E500|0|01072026|31072026|';

    it('acusa a linha grudada como BLOQUEIA, dizendo que é defeito de geração', () => {
        const { suspeitas } = auditarSaidaSped(['|E110|0,00|', grudada]);
        const s = suspeitas.filter((x: any) => x.tipo === 'linha-malformada');
        expect(s).toHaveLength(1);
        expect(s[0].gravidade).toBe('bloqueia');
        expect(s[0].detalhe).toMatch(/GERAÇÃO do app/);
    });

    it('vale para o arquivo do EFD-CONTRIBUIÇÕES — mesma auditoria, mesmo buildLine', () => {
        const contrib = [
            '|0000|006|0|||01072026|31072026|EMPRESA|17213641000127|SP|3550308||00|1|',
            'F550|21811,34|01|0,00|21811,34|F600|03|02052026|5200|',   // dois registros grudados
        ];
        const s = auditarSaidaSped(contrib).suspeitas.filter((x: any) => x.tipo === 'linha-malformada');
        expect(s).toHaveLength(1);
    });

    it('arquivo bem formado não acusa nada — linha vazia do fim não conta', () => {
        const ok = ['|0000|006|0|', '|E110|0,00|', '|9999|59|', ''];
        expect(auditarSaidaSped(ok).suspeitas.filter((x: any) => x.tipo === 'linha-malformada')).toEqual([]);
    });

    it('muitas linhas tortas: mostra 5 e CONTA o resto — lista infinita afoga a auditoria', () => {
        const muitas = Array.from({ length: 9 }, (_, i) => `E200|UF${i}|01072026|`);
        const s = linhasMalformadas(muitas);
        expect(s).toHaveLength(6);
        expect(s[5].detalhe).toMatch(/e mais 4 linha\(s\)/);
    });
});
