/**
 * Trava de carteira nas rotas que a auditoria de segurança (10/08) achou
 * gravando/agindo em CNPJ arbitrário:
 *
 *  - agent-routes /upload-batch: gravava XML e SOBRESCREVIA o sefaz_state
 *    (ultNSU/maxNSU) de qualquer CNPJ do corpo — ultNSU alto faz o próximo
 *    DistDFe PULAR documentos (perda silenciosa de captura, o pecado capital).
 *  - conferencia-chaves-importar: carregava o A1 da empresa-alvo e disparava
 *    consulta à SEFAZ em nome dela, queimando a cota anti-656 de outra raiz.
 *
 * Teste estático (como o do gateway): garante que o check de carteira
 * (podeAcessarCnpj) está presente ANTES da operação sensível e não volta a
 * sumir num refactor.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ler = (rel: string) => readFileSync(join(__dirname, '..', 'sefaz-backend', rel), 'utf8');

test('upload-batch checa a carteira antes de gravar sefaz_state', () => {
    const src = ler('agent-routes.js');
    expect(src).toMatch(/import\s*\{[^}]*podeAcessarCnpj[^}]*\}\s*from\s*'\.\/carteira-auth\.js'/);
    const handler = src.slice(src.indexOf("router.post('/upload-batch'"), src.indexOf("router.post('/upload-batch'") + 1200);
    // o check aparece ANTES de qualquer escrita em sefaz_state
    const idxCheck = handler.indexOf('podeAcessarCnpj(req.user, empresaCnpj)');
    expect(idxCheck).toBeGreaterThan(-1);
    expect(handler).toMatch(/if\s*\(!acesso\.ok\)\s*return\s*res\.status\(acesso\.status\)/);
});

test('conferencia-chaves-importar checa a carteira antes de carregar o cert/consultar', () => {
    const src = ler('conferencia-chaves-routes.js');
    expect(src).toMatch(/import\s*\{[^}]*podeAcessarCnpj[^}]*\}\s*from\s*'\.\/carteira-auth\.js'/);
    const handler = src.slice(src.indexOf("'/conferencia-chaves-importar'"), src.indexOf('loadCertEmpresa('));
    const idxCheck = handler.indexOf('podeAcessarCnpj(req.user, cnpjDest)');
    expect(idxCheck).toBeGreaterThan(-1);
    // e o check vem ANTES de carregar o certificado (o handler cortou em loadCertEmpresa)
    expect(idxCheck).toBeLessThan(handler.length);
});
