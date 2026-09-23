// ============================================================================
// 🧭 DIFAL DE AQUISIÇÃO DENTRO DA APURAÇÃO — o art. 117 do RICMS/SP.
//
// Paulo, 14/09, fechando a HYPE CAFÉ (1385, Lucro Presumido): *"o diferencial
// de alíquota nas aquisições dela é dentro da apuração, precisamos criar um
// campo para fazermos um ajuste; no EFISCAL lançamos dentro da nota, depois
// fazemos esse ajuste para sair na apuração"*.
//
// A FIXTURE É O PRINT DELE — nota do MERCADO LIVRE (MG), CFOP escriturado 2556,
// valor 166,10, ICMS destacado 19,93 (12%), alíquota interna 18%:
//   e-Fiscal: base 178,26 · débito 32,09 (art. 117, II) · crédito 19,93 (I)
//   Registro de Apuração: 1.204,16 + 32,09 − 19,93 = 1.216,32
// O que vai ao arquivo são os DOIS lançamentos arredondados (32,09 e 19,93); a
// "diferença 12,15" do diálogo do e-Fiscal é conta sem arredondar — o RAICMS
// dele fecha em 12,16, e é o RAICMS que é o gabarito (1.216,32).
// ============================================================================
import {
    baseDifalPorDentro, calcularArt117, propostaDifalDaNota, aplicarInformado,
    validarCodigosArt117, consolidarDifalArt117,
} from '../sefaz-backend/difal-art117-apuracao.js';
import { classificarAjustes, aplicarAjustesApuracao } from '../sefaz-backend/sped-ajustes-apuracao.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const fonte = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

// Códigos FICTÍCIOS com a estrutura certa (UF + '0' próprio + tipo + 4 dígitos).
// O número real é da tabela 5.1.1 e vem do cadastro — nunca daqui.
const COD_DEB = 'SP000999';   // 4º = '0' → outros débitos
const COD_CRED = 'SP020999';  // 4º = '2' → outros créditos

const notaHype = (over: Record<string, unknown> = {}) => ({
    chave: '35260803007331001032550010001435245251000000',
    numero: '143524525', direcao: 'entrada', status: 'autorizado',
    ufEmit: 'MG', cnpjEmit: '03007331001032', xNomeEmit: 'MERCADO LIVRE BRASIL',
    itens: [{ nItem: '1', cfop: '6102', vProd: 166.10, vBC: 166.10, aliqIcms: 12, vICMS: 19.93 }],
    ...over,
});
// O CFOP ESCRITURADO: o Mercado Livre emite 6102 (para ele é venda); quem
// compra escritura 2556 (uso/consumo). É a régua do bloco C que responde.
const escriturado2556 = () => '2556';

describe('a base "por dentro" e os dois lançamentos do art. 117 — os números do print', () => {
    it('166,10 com 19,93 na origem e 18% interna dá base 178,26', () => {
        expect(baseDifalPorDentro(166.10, 19.93, 18)).toBe(178.26);
    });
    it('débito 32,09 (II) · crédito 19,93 (I)', () => {
        expect(calcularArt117({ base: 178.26, aliqInterna: 18, icmsDestacado: 19.93 }))
            .toEqual({ debito: 32.09, credito: 19.93, diferenca: 12.16 });
    });
    it('alíquota fora de (0,100) não tem base — dividir por zero não é conta', () => {
        expect(baseDifalPorDentro(100, 12, 0)).toBeNull();
        expect(baseDifalPorDentro(100, 12, 100)).toBeNull();
    });
    it('e o E110 recebe exatamente o que o RAICMS do e-Fiscal mostra', () => {
        const r = consolidarDifalArt117({
            notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556,
            codigoDebito: COD_DEB, codigoCredito: COD_CRED,
        });
        const cls = classificarAjustes(r.ajustes, 'SP');
        const ap = aplicarAjustesApuracao({ vlTotDebitos: 1204.16, vlTotCreditos: 0 }, cls);
        expect(ap.vlTotAjDebitos).toBe(32.09);
        expect(ap.vlTotAjCreditos).toBe(19.93);
        expect(ap.vlIcmsRecolher).toBe(1216.32);
    });
});

describe('a proposta lê o CFOP ESCRITURADO, nunca o cru do XML', () => {
    it('Mercado Livre emite 6102: pelo XML a nota nem seria candidata', () => {
        const cru = propostaDifalDaNota(notaHype(), { ufEmpresa: 'SP', aliqInterna: 18, cfopDoItem: (_n, i: any) => i.cfop });
        expect(cru).toBeNull();
        const esc = propostaDifalDaNota(notaHype(), { ufEmpresa: 'SP', aliqInterna: 18, cfopDoItem: escriturado2556 });
        expect(esc).not.toBeNull();
        expect(esc!.cfops).toEqual(['2556']);
        expect(esc!.base).toBe(178.26);
        expect(esc!.origem).toBe('proposta');
    });
    it('o resolvedor é OBRIGATÓRIO — esquecer não vira "lê o cru" em silêncio', () => {
        expect(() => propostaDifalDaNota(notaHype(), { ufEmpresa: 'SP', aliqInterna: 18 } as any)).toThrow(/cfopDoItem/);
    });
    it('só entra o item de uso/consumo/ativo — revenda na mesma nota fica de fora', () => {
        const mista = notaHype({ itens: [
            { nItem: '1', cfop: '6102', vBC: 166.10, vICMS: 19.93 },
            { nItem: '2', cfop: '6102', vBC: 500, vICMS: 60 },
        ] });
        const p = propostaDifalDaNota(mista, {
            ufEmpresa: 'SP', aliqInterna: 18,
            cfopDoItem: (_n, i: any) => (i.nItem === '1' ? '2556' : '2102'),
        });
        expect(p!.itens).toBe(1);
        expect(p!.valorOperacao).toBe(166.10);
    });
    it('entrada da MESMA UF, saída e cancelada não são candidatas', () => {
        const args = { ufEmpresa: 'SP', aliqInterna: 18, cfopDoItem: escriturado2556 };
        expect(propostaDifalDaNota(notaHype({ ufEmit: 'SP' }), args)).toBeNull();
        expect(propostaDifalDaNota(notaHype({ direcao: 'saida', tpNF: '1' }), args)).toBeNull();
        expect(propostaDifalDaNota(notaHype({ status: 'cancelado' }), args)).toBeNull();
    });
    it('ICMS destacado zero NÃO vira crédito derivado — fica zero e sai avisado', () => {
        const r = consolidarDifalArt117({
            notas: [notaHype({ itens: [{ nItem: '1', cfop: '6102', vBC: 166.10, vICMS: 0 }] })],
            ufEmpresa: 'SP', cfopDoItem: escriturado2556, codigoDebito: COD_DEB, codigoCredito: COD_CRED,
        });
        expect(r.porNota[0].credito).toBe(0);
        expect(r.porNota[0].icmsDestacadoZero).toBe(true);
        expect(r.avisos.some((a) => /sem ICMS destacado/.test(a))).toBe(true);
        // Só o débito vai ao arquivo; crédito zero não vira linha de E111.
        expect(r.ajustes.map((a) => a.codigo)).toEqual([COD_DEB]);
    });
});

describe('o informado VENCE a proposta — o "campo dentro da nota" do e-Fiscal', () => {
    const proposta = propostaDifalDaNota(notaHype(), { ufEmpresa: 'SP', aliqInterna: 18, cfopDoItem: escriturado2556 })!;
    it('base informada à mão vence, carimbada com quem e quando', () => {
        const r = aplicarInformado(proposta, { base: 200, por: 'ana@sp.com', em: '2026-09-14T10:00:00Z' })!;
        expect(r.base).toBe(200);
        expect(r.debito).toBe(36);
        expect(r.credito).toBe(19.93);
        expect(r.origem).toBe('informada');
        expect(r.informadoPor).toBe('ana@sp.com');
    });
    it('alíquota informada recalcula a base por dentro (a base não fica velha)', () => {
        const r = aplicarInformado(proposta, { aliqInterna: 12 })!;
        expect(r.base).toBe(baseDifalPorDentro(166.10, 19.93, 12));
        expect(r.origem).toBe('informada');
    });
    it('campo em branco mantém a proposta — vazio não é zero', () => {
        const r = aplicarInformado(proposta, { base: '', aliqInterna: null, icmsDestacado: undefined })!;
        expect(r.base).toBe(178.26);
        expect(r.origem).toBe('proposta');
    });
    it('"DIFAL não devido" tira a nota do ajuste e sai NOMEADA no aviso', () => {
        const chave = notaHype().chave;
        const r = consolidarDifalArt117({
            notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556,
            codigoDebito: COD_DEB, codigoCredito: COD_CRED,
            informadoPorChave: { [chave]: { naoDevido: true, motivo: 'CAT 26/2008 - 426-A ja recolhido' } },
        });
        expect(r.ajustes).toEqual([]);
        expect(r.totais.naoDevidas).toBe(1);
        expect(r.avisos.some((a) => /não devido/.test(a) && /143524525/.test(a) && /426-A/.test(a))).toBe(true);
    });
});

describe('os códigos não se inventam — e o par é tudo ou nada', () => {
    it('sem código: NADA entra no E110, e o aviso diz o total que ficou de fora e ONDE cadastrar', () => {
        const r = consolidarDifalArt117({ notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556 });
        expect(r.ajustes).toEqual([]);
        const aviso = r.avisos.find((a) => /NADA entrou no E110/.test(a))!;
        expect(aviso).toContain('32,09');
        expect(aviso).toContain('19,93');
        expect(aviso).toContain('Ajustes E111');
        expect(aviso).toMatch(/tudo ou nada/);
    });
    it('só o débito cadastrado: também não sai — recolheria 32,09 no lugar de 12,16', () => {
        const r = consolidarDifalArt117({
            notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556, codigoDebito: COD_DEB,
        });
        expect(r.ajustes).toEqual([]);
        expect(r.codigos.credito.ok).toBe(false);
    });
    it('código de ESTORNO no lugar do crédito é recusado pelo 4º caractere', () => {
        const v = validarCodigosArt117({ codigoDebito: COD_DEB, codigoCredito: 'SP030999', ufEmpresa: 'SP' });
        expect(v.credito.ok).toBe(false);
        expect(v.credito.erro).toMatch(/4º caractere '2'/);
    });
    it('código de OUTRA UF e código de ST são recusados (a tabela é estadual; o art. 117 é E111)', () => {
        const v = validarCodigosArt117({ codigoDebito: 'MG000999', codigoCredito: 'SP120999', ufEmpresa: 'SP' });
        expect(v.debito.ok).toBe(false);
        expect(v.debito.erro).toMatch(/UF MG/);
        expect(v.credito.ok).toBe(false);
        expect(v.credito.erro).toMatch(/apuração PRÓPRIA/);
    });
    it('C197 com 4º caractere que o Guia soma no E110 + par E111 = DIFAL duas vezes, DITO', () => {
        const r = consolidarDifalArt117({
            notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556,
            codigoDebito: COD_DEB, codigoCredito: COD_CRED, codigoC197: 'SP40090207',
        });
        expect(r.avisos.some((a) => /DUAS vezes/.test(a))).toBe(true);
        const info = consolidarDifalArt117({
            notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556,
            codigoDebito: COD_DEB, codigoCredito: COD_CRED, codigoC197: 'SP32000001',
        });
        expect(info.avisos.some((a) => /DUAS vezes/.test(a))).toBe(false);
    });
    it('empresa sem nota candidata: nenhum aviso (alarme sobre arquivo normal ensina a ignorar alarme)', () => {
        const r = consolidarDifalArt117({ notas: [notaHype({ ufEmit: 'SP' })], ufEmpresa: 'SP', cfopDoItem: escriturado2556 });
        expect(r.avisos).toEqual([]);
        expect(r.ajustes).toEqual([]);
    });
    it('a descrição do E111 cita o art. 117 só em SP — fora dela é o mecanismo, sem afirmar a norma paulista', () => {
        const sp = consolidarDifalArt117({ notas: [notaHype()], ufEmpresa: 'SP', cfopDoItem: escriturado2556, codigoDebito: COD_DEB, codigoCredito: COD_CRED });
        expect(sp.ajustes[0].descricao).toMatch(/art\. 117, II/);
        const pr = consolidarDifalArt117({ notas: [notaHype()], ufEmpresa: 'PR', cfopDoItem: escriturado2556, codigoDebito: 'PR000999', codigoCredito: 'PR020999' });
        expect(pr.ajustes[0].descricao).not.toMatch(/art\. 117/);
    });
});

// ═══ A LIGAÇÃO — dono sem consumidor é a "régua que só escreve" ══════════════

describe('o par E111 do art. 117 chega ao E110, à tela e à rota', () => {
    it('o orquestrador consolida e empurra os ajustes em `ajustesApuracao` (é por eles que o E110 soma)', () => {
        const orq = fonte('sefaz-backend/sped-fiscal-orchestrator.js');
        expect(orq).toMatch(/consolidarDifalArt117\(/);
        expect(orq).toMatch(/ajustesApuracao\.push\(\.\.\.difalArt117\.ajustes\)/);
        // E o CFOP que ele entrega ao dono é o ESCRITURADO (a régua do bloco C).
        expect(orq).toMatch(/cfopDoItem:[^\n]*convertCfopParaEntrada\(/);
    });
    it('a rota de leitura usa o MESMO dono, e a tela grava códigos e informado por nota', () => {
        expect(fonte('sefaz-backend/sped-fiscal-routes.js')).toMatch(/consolidarDifalArt117\(/);
        const tela = fonte('components/SpedFiscal/DifalArt117.tsx');
        expect(tela).toContain('/api/admin/sped-fiscal/difal-art117');
        expect(tela).toContain('salvarDifalArt117Codigos');
        expect(tela).toContain('salvarDifalArt117Nota');
        // A tela NÃO calcula: sem `baseDifalPorDentro`/`calcularArt117` nela.
        expect(tela).not.toMatch(/baseDifalPorDentro|calcularArt117/);
        const svc = fonte('services/spedAjustesService.ts');
        expect(svc).toContain('salvarDifalArt117Nota');
        expect(svc).toContain('difalArt117');
        // A tela mora na aba onde os códigos estaduais já moram.
        expect(fonte('components/SpedFiscal/AjustesE111.tsx')).toContain('DifalArt117');
    });
});
