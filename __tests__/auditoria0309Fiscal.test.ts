/**
 * 🧾 Auditoria de 03/09 — travas das correções do NÚCLEO FISCAL.
 *
 * Cada bloco aqui prova UMA correção, e o jeito de provar é o de sempre:
 * chamar a régua com o insumo que produzia o número errado. Trocar a régua
 * de volta derruba o bloco correspondente.
 */
import * as fs from 'fs';
import * as path from 'path';
// @ts-expect-error módulo JS sem .d.ts para esta assinatura
import { aliqInterestadualDoItem as donoAliq } from '../sefaz-backend/difal-itens.js';
// @ts-expect-error idem
import { aliqInterestadualDoItem as reexportado } from '../sefaz-backend/difal-aquisicao.js';
// @ts-expect-error idem
import { aliqInterestadual as doC197 } from '../sefaz-backend/sped-difal-c197.js';
// @ts-expect-error idem
import { acharApuracaoDaCompetencia } from '../sefaz-backend/rotina-fiscal.js';
// @ts-expect-error idem
import { documentoDaNfseNacional, lacunasDaNfseNacional } from '../sefaz-backend/nfse-nacional-gravacao.js';
// @ts-expect-error idem
import { planejarBlocoH } from '../sefaz-backend/sped-bloco-h.js';
// @ts-expect-error idem
import { coletarRetencoesF600 } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error idem
import { calcularVencimento } from '../sefaz-backend/catalogo-obrigacoes.js';
// @ts-expect-error idem
import { ajustarDiaUtil } from '../sefaz-backend/calendario-obrigacoes.js';
// @ts-expect-error idem
import { conferirDebitosJaEnviados } from '../sefaz-backend/debito-ja-enviado.js';
// @ts-expect-error idem
import { ALIQ_LEGAL } from '../sefaz-backend/retencao-pj-ajuste.js';
// @ts-expect-error idem
import { ALIQ } from '../sefaz-backend/retencao-federal-coerencia.js';

const BACKEND = path.join(__dirname, '..', 'sefaz-backend');
const fonte = (f: string) => fs.readFileSync(path.join(BACKEND, f), 'utf8');
const semComentario = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('DIFAL: a alíquota interestadual do item tem DONO ÚNICO', () => {
    it('o painel do Simples e o C197 do Lucro respondem o MESMO para o mesmo item', () => {
        for (const [item, uf] of [
            [{ aliqIcms: 12 }, 'MG'], [{ orig: '1' }, 'MG'], [{ orig: '0' }, 'BA'], [{ orig: '0' }, 'PR'], [{}, ''],
        ] as const) {
            expect(reexportado(item, uf)).toEqual(donoAliq(item, uf));
            expect(doC197(item, uf)).toEqual(donoAliq(item, uf));
        }
    });
    it('destacada vence; sem ela deriva por origem (4%) e por UF (12/7) — carimbada', () => {
        expect(donoAliq({ aliqIcms: 7 }, 'MG')).toEqual({ aliq: 7, derivada: false });
        expect(donoAliq({ orig: '8' }, 'MG')).toEqual({ aliq: 4, derivada: true });
        expect(donoAliq({ orig: '0' }, 'rj')).toEqual({ aliq: 12, derivada: true });
        expect(donoAliq({ orig: '0' }, 'PE')).toEqual({ aliq: 7, derivada: true });
    });
    it('varredura: a tabela de UFs/origem não volta a ser copiada como literal fora do dono', () => {
        const acusados: string[] = [];
        for (const f of fs.readdirSync(BACKEND).filter((n) => n.endsWith('.js') && n !== 'difal-itens.js')) {
            const src = semComentario(fonte(f));
            if (/'SP',\s*'RJ',\s*'MG',\s*'RS',\s*'SC',\s*'PR'/.test(src)) acusados.push(`${f}: UF_INTER_12 copiada`);
            if (/\[\s*'1',\s*'2',\s*'3',\s*'8'\s*\]/.test(src)) acusados.push(`${f}: ORIG_4PCT copiada`);
        }
        expect(acusados).toEqual([]);
    });
});

describe('Rotina do Mês: ficha com imposto NÃO lançado não vira "apuração de R$ 0,00"', () => {
    const empresa = { fichaFinanceira: [{ mesReferencia: '2026-07', totalImpostos: null, faturamentoMesTotal: null }] };
    it('`Number(null)` é 0 — sem o `== null` primeiro o zero passava por apurado', () => {
        const ap = acharApuracaoDaCompetencia(empresa, '2026-07');
        expect(ap).not.toBeNull();
        expect(ap.totalImpostos).toBeNull();
        expect(ap.receita).toBeNull();
    });
    it('número de verdade continua passando (inclusive zero digitado)', () => {
        const ap = acharApuracaoDaCompetencia({ fichaFinanceira: [{ mesReferencia: '2026-07', totalImpostos: 0, faturamentoMesTotal: 1500 }] }, '2026-07');
        expect(ap.totalImpostos).toBe(0);
        expect(ap.receita).toBe(1500);
    });
});

describe('NFS-e Nacional (ADN): valor que o parser NÃO leu não entra como R$ 0,00', () => {
    it('meta sem valorServico ⇒ nem valorTotal nem valorServicos gravados, e a lacuna sai NOMEADA', () => {
        const meta = { chave: 'X', valorServico: null, prestadorCnpj: '11111111000191', tomadorCnpj: '22222222000191', dataEmissao: '2026-07-10' };
        const doc = documentoDaNfseNacional(meta, '11111111000191');
        expect(doc).not.toHaveProperty('valorTotal');
        expect(doc).not.toHaveProperty('valorServicos');
        expect(lacunasDaNfseNacional(meta, '11111111000191')).toEqual(expect.arrayContaining([expect.stringMatching(/valor do serviço/)]));
    });
    it('valor lido (inclusive zero de verdade) continua gravando', () => {
        const doc = documentoDaNfseNacional({ chave: 'X', valorServico: 0, prestadorCnpj: '11111111000191', dataEmissao: '2026-07-10' }, '11111111000191');
        expect(doc.valorTotal).toBe(0);
    });
});

describe('Bloco H: a unidade do inventário NÃO recebe default', () => {
    it('item sem unidade sai com unidade VAZIA (o PVA acusa; CX contado como UN ele não acusa)', () => {
        const res = planejarBlocoH({
            exigido: true, motInv: '01',
            itens: [{ codItem: 'X', descricao: 'item', qtdInventario: 5, vlUnitInventario: 2 }],
        });
        const linhas = JSON.stringify(res);
        expect(linhas).toContain('"codItem":"X"');
        expect(linhas).not.toMatch(/"unidade":"UN"/);
    });
});

describe('F600: a base lê o valor do documento pelo DONO (seis formas)', () => {
    const nota = {
        status: 'autorizado', direcao: 'saida', tipo: 'NFSe', numero: '10', dhEmi: '2026-07-10',
        valorPis: 6.5, valorCofins: 30,          // retenção ACHATADA (portal)
        totais: { vNF: 1000 },                   // valor SÓ nesta forma (import pelo navegador)
        cnpjDest: '11111111000191',
    };
    it('nota com o valor em `totais.vNF` NÃO cai em semBase', () => {
        const warnings: string[] = [];
        const r = coletarRetencoesF600([nota], warnings);
        expect(r.eventos.length).toBe(1);
        expect(r.eventos[0].base).toBe(1000);
        expect(warnings.join('\n')).not.toMatch(/SEM base/);
    });
});

describe('Catálogo: o ajuste de dia não útil é o do DONO (ajustarDiaUtil)', () => {
    it('sábado com "antecipa" recua para sexta — o mesmo dia que o DARF calcula', () => {
        const d = calcularVencimento('05/2026', { diaVencimento: 20, mesesApos: 1, ajusteDiaNaoUtil: 'antecipa' });
        const esperado = ajustarDiaUtil(2026, 6, 20, 'antecipar');
        expect(esperado).toBe('2026-06-19');
        expect(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).toBe(esperado);
    });
    it('varredura: o laço de dia útil não volta a ser reescrito no catálogo', () => {
        expect(semComentario(fonte('catalogo-obrigacoes.js'))).not.toMatch(/d\.setDate\(d\.getDate\(\) \+ passo\)/);
    });
});

describe('Trava do débito repetido: débito SEM valor fica null, nunca R$ 0,00', () => {
    it('valor ausente não vira zero', () => {
        const r = conferirDebitosJaEnviados({
            debitosDaGuia: [{ codigo: '2172', extensao: '01', valor: null }],
            enviosAnteriores: [{ debitos: [{ codigo: '2172', extensao: '01', valor: 100 }], canal: 'email-graph', enviadoEm: '2026-08-01' }],
        });
        const texto = JSON.stringify(r);
        expect(texto).toContain('2172');
        expect(texto).not.toMatch(/"valor":0[,}]/);
    });
});

describe('Leitores nas DUAS formas (varredura)', () => {
    it('recuperação tributária lê a UF pelos donos, não só pelo bloco aninhado', () => {
        const src = semComentario(fonte('recuperacao-tributaria-orchestrator.js'));
        expect(src).toMatch(/ufDoDestinatarioDoc\(doc\)/);
        expect(src).toMatch(/ufEmitente\(doc\)/);
    });
    it('cobertura de saída lê o emitente pelo dono', () => {
        expect(semComentario(fonte('cobertura-saida.js'))).toMatch(/cnpjEmitente\(d\)/);
    });
    it('DIPAM e varredura DIFAL leem o valor pelo dono, com as formas na projeção', () => {
        expect(semComentario(fonte('dipam-produtor-rural.js'))).toMatch(/valorDoDocumento\(d\)/);
        expect(semComentario(fonte('difal-routes.js'))).toMatch(/valorDoDocumento\(d\)/);
        for (const f of ['dipam-routes.js', 'difal-routes.js']) {
            const src = fonte(f);
            for (const campo of ["'totais.vNF'", "'valores.total'", "'vNF'", "'totalNota'"]) expect(src).toContain(campo);
        }
    });
    it('0200 do EFD-Contribuições normaliza a unidade como o 0190 (trim + maiúscula)', () => {
        expect(semComentario(fonte('sped-contrib-bloco0.js'))).toMatch(/normalizarUnidade\(item\.unidade\)/);
    });
    it('prova de captura usa o modeloComItens do dono', () => {
        const src = semComentario(fonte('prova-captura.js'));
        expect(src).toMatch(/import \{ modeloComItens \} from '\.\/gravacao-nfe-regua\.js'/);
        expect(src).not.toMatch(/const modeloComItens\s*=/);
    });
    it('as alíquotas da CSRF têm um dono só', () => {
        expect(ALIQ_LEGAL).toBe(ALIQ);
    });
});
