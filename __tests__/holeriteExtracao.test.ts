/**
 * Leitura dos holerites do IOB pelo Gemini para o Consultor DP (Paulo,
 * 04/10/2026: "pode seguir com a conferência dos holerites pelo Gemini").
 *
 * O que os testes trancam:
 * 1. O PDF é conferido antes de gastar uma chamada (assinatura, tamanho).
 * 2. O pedido ao Gemini é de TRANSCRIÇÃO: o prompt proíbe calcular.
 * 3. A resposta vira centavos; leitura que não fecha volta com aviso e sem
 *    "correção"; JSON truncado é erro legível.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { validarPdf, montarPromptHolerites, lerRespostaHolerites, SCHEMA_HOLERITES, MAX_PDF_BYTES } from '../sefaz-backend/holerite-extracao.js';

const pdf = (corpo = 'conteudo') => Buffer.from(`%PDF-1.7\n${corpo}`).toString('base64');

describe('holerites do IOB pelo Gemini', () => {
    it('confere o PDF antes de chamar a IA', () => {
        expect(validarPdf(pdf())).toMatchObject({ ok: true, bytes: 17 });
        expect(validarPdf(`data:application/pdf;base64,${pdf()}`).ok).toBe(true);
        expect(validarPdf('')).toEqual({ ok: false, erro: 'Envie o PDF dos holerites.' });
        expect(validarPdf(Buffer.from('PK\x03\x04zip').toString('base64'))).toEqual({ ok: false, erro: 'O arquivo não é um PDF.' });
        expect(validarPdf('@@@')).toEqual({ ok: false, erro: 'Arquivo em formato inválido.' });
        const grande = Buffer.alloc(MAX_PDF_BYTES + 1, 32); grande.write('%PDF-');
        expect(validarPdf(grande.toString('base64')).erro).toContain('Divida o arquivo');
    });

    it('pede transcrição, não cálculo, e o schema exige nome e verbas', () => {
        const p = montarPromptHolerites({ competencia: '2026-09' });
        expect(p).toContain('não calcule nada');
        expect(p).toContain('2026-09');
        expect(SCHEMA_HOLERITES.properties.holerites.items.required).toEqual(['nome', 'verbas']);
    });

    it('converte em centavos e avisa quando a leitura não fecha', () => {
        const resposta = JSON.stringify({
            holerites: [
                { pagina: 1, nome: ' ANA   PAULA ', cpf: '529.982.247-25', codigo: '17', competencia: '2026-09', salarioBase: 2200,
                    verbas: [
                        { codigo: '001', descricao: 'SALARIO', referencia: '30,00', provento: 2200, desconto: null },
                        { codigo: '050', descricao: 'HORAS EXTRAS 50%', referencia: '10,00', provento: 150, desconto: null },
                        { codigo: '901', descricao: 'INSS', referencia: '8,04', provento: null, desconto: 191.43 },
                        { codigo: '', descricao: 'LINHA VAZIA', referencia: '', provento: 0, desconto: 0 },
                    ],
                    totalProventos: 2350, totalDescontos: 191.43, liquido: 2158.57, baseInss: 2350, baseFgts: 2350, fgtsMes: 188, baseIrrf: 1742.8 },
                { nome: 'BRUNO', cpf: '123', competencia: '2026-08', verbas: [{ descricao: 'SALARIO', provento: 3000 }], totalProventos: 3100, totalDescontos: 0, liquido: 2900 },
            ],
            observacoes: ['Página 3 ilegível.'],
        });
        const r = lerRespostaHolerites(resposta, { competencia: '2026-09' });
        expect(r.avisos).toEqual(['Página 3 ilegível.']);
        expect(r.holerites[0]).toMatchObject({ nome: 'ANA PAULA', cpf: '52998224725', codigo: '17', competencia: '2026-09', salarioBase: 220000, liquido: 215857, fgtsMes: 18800, baseIrrf: 174280, avisos: [] });
        expect(r.holerites[0].verbas).toHaveLength(3);
        expect(r.holerites[0].verbas[2]).toEqual({ codigo: '901', descricao: 'INSS', referencia: '8,04', provento: 0, desconto: 19143 });
        expect(r.holerites[1].cpf).toBe('');
        expect(r.holerites[1].avisos).toEqual([
            'Soma dos proventos lidos (3000,00) difere do total impresso (3100,00): confira a leitura.',
            'Líquido impresso não fecha com proventos − descontos: confira a leitura.',
            'Holerite de 2026-08, diferente da competência conferida (2026-09).',
        ]);
    });

    it('resposta truncada é erro; PDF sem holerite vira aviso', () => {
        expect(() => lerRespostaHolerites('{"holerites":[{"nome":"ANA","verbas":[')).toThrow('Divida o arquivo em partes menores');
        expect(lerRespostaHolerites('```json\n{"holerites":[]}\n```')).toEqual({ holerites: [], avisos: ['Nenhum holerite encontrado no PDF.'] });
    });
});
