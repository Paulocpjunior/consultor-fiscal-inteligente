import { normalizarModalidadeFrete, indicadorFrete } from '../sefaz-backend/nfe-frete.js';
// @ts-ignore backend ESM
import { completarFreteDasNotas, lerFreteXml } from '../sefaz-backend/nfe-frete-xml.js';

const chave = '35260912345678000190550010000000011000000010';
const xml = (mod: string, key = chave) => `<nfe:NFe xmlns:nfe="http://www.portalfiscal.inf.br/nfe"><nfe:infNFe Id="NFe${key}"><nfe:transp><nfe:modFrete>${mod}</nfe:modFrete></nfe:transp></nfe:infNFe></nfe:NFe>`;

test.each(['0', '1', '2', '3', '4', '9'])('preserva modalidade %s inclusive frete sem valor', codigo => {
    expect(normalizarModalidadeFrete(codigo)).toBe(codigo);
    expect(indicadorFrete({ modelo: '55', modFrete: codigo })).toBe(codigo);
    expect(lerFreteXml(xml(codigo), chave)).toBe(codigo);
});
test('zero numerico nao desaparece e ausencia nao vira nove', () => {
    expect(normalizarModalidadeFrete(0)).toBe('0');
    expect(indicadorFrete({ modelo: '55' })).toBe('');
    expect(indicadorFrete({ modelo: '65' })).toBe('9');
    expect(normalizarModalidadeFrete('7')).toBeNull();
});
test('recupera legado pelo XML sem modificar valores', async () => {
    const nota: any = { modelo: '55', chave, storagePath: 'xmls/empresa/nfe.xml', totais: { vFrete: 750 } };
    await completarFreteDasNotas([nota], async () => xml('1'));
    expect(nota.modFrete).toBe('1');
    expect(nota.totais.vFrete).toBe(750);
});
test('bloqueia XML de outra chave ou ausente, sem adivinhar', async () => {
    await expect(completarFreteDasNotas([{ modelo: '55', chave, storagePath: 'xmls/e/a.xml' }], async () => xml('0', 'outra'))).rejects.toThrow('diverge');
    await expect(completarFreteDasNotas([{ modelo: '55', chave }])).rejects.toThrow('Reimporte');
});
test('campo presente dispensa leitura; NFCe e cancelamento dispensam recuperacao', async () => {
    const baixar = jest.fn();
    await completarFreteDasNotas([{ modelo: '55', modFrete: '0' }, { modelo: '65' }, { modelo: '55', status: 'cancelada' }], baixar);
    expect(baixar).not.toHaveBeenCalled();
});
