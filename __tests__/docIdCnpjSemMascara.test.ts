// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O docId DA IDEMPOTÊNCIA LEVAVA O CNPJ CRU (03/09)
//
// O cadastro guarda o CNPJ em DUAS formas (`51227692000146` e
// `51.227.692/0001-46`). Nos orquestradores do DAS, do DARF e da DCTFWeb o id
// era `${empresaCnpj}_${competencia}_…` com a pontuação virando `_` — ou seja,
// a MESMA guia ganhava um segundo documento e a trava que impede a segunda
// emissão não via a primeira.
//
// Os orquestradores puxam firebase-admin e não carregam no jest: a prova é por
// VARREDURA da fonte (o padrão desta casa para eles), mais o helper do CNPJ
// exercitado de verdade.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { join } from 'path';
import { limparCnpj } from '../sefaz-backend/documento-dv.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const semComentarios = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const ORQUESTRADORES = [
    'sefaz-backend/das-orchestrator.js',
    'sefaz-backend/darf-orchestrator.js',
    'sefaz-backend/dctfweb-orchestrator.js',
];

describe('todo docId de guia/declaração sai do CNPJ SEM máscara', () => {
    for (const arq of ORQUESTRADORES) {
        it(`${arq}: nenhum id monta \`\${empresaCnpj}_\` cru`, () => {
            const src = semComentarios(ler(arq));
            expect(src).not.toMatch(/\$\{empresaCnpj\}_/);
            expect(src).not.toMatch(/\$\{String\(empresaCnpj\)\.replace/);
            expect(src).toMatch(/function cnpjParaId\(/);
            expect(src).toMatch(/import \{ limparCnpj \} from '\.\/documento-dv\.js'/);
            // Cada id que identifica a guia/declaração passa pelo helper
            // (inline, ou guardado em `cnpjId` quando o mesmo id serve a mais
            // de um lugar).
            expect((src.match(/cnpjParaId\(empresaCnpj\)/g) || []).length).toBeGreaterThanOrEqual(1);
            expect((src.match(/\$\{(cnpjParaId\(empresaCnpj\)|cnpjId)\}_/g) || []).length).toBeGreaterThanOrEqual(1);
        });
    }

    it('o helper recusa CNPJ que não tem 14 posições — id de ninguém não se grava', () => {
        // limparCnpj é a régua da forma; cada orquestrador conferir 14 é o
        // que impede `_2026-07_regular` (um id sem empresa).
        expect(limparCnpj('51.227.692/0001-46')).toBe('51227692000146');
        expect(limparCnpj('123')).toHaveLength(3);
        for (const arq of ORQUESTRADORES) {
            expect(semComentarios(ler(arq))).toMatch(/limpo\.length !== 14/);
        }
    });
});

// ═══ A COMPETÊNCIA DO DARF ENTRAVA CRUA ══════════════════════════════════════
// `07/2026` virava `072026` no provider (`replace(/\D/g,'').slice(0,6)`) —
// período de apuração ano 0720, mês 26, dentro do código de barras.
describe('o DARF normaliza a competência na PORTA, como o DAS', () => {
    const orq = semComentarios(ler('sefaz-backend/darf-orchestrator.js'));
    const prov = semComentarios(ler('sefaz-backend/darf-provider.js'));

    it('o orquestrador passa pela régua e não desestrutura a competência crua', () => {
        expect(orq).toMatch(/competenciaNormalizadaOuErro\(req\.competencia\)/);
        expect(orq).not.toMatch(/const \{[^}]*\bcompetencia\b[^}]*\} = req;/);
        expect(orq).toMatch(/provider\.gerarDarf\(\{ \.\.\.req, competencia \}\)/);
    });

    it('a recusa diz as DUAS consequências (período no SICALC + guia em dobro)', () => {
        const fonte = ler('sefaz-backend/darf-orchestrator.js');
        expect(fonte).toMatch(/SICALC/);
        expect(fonte).toMatch(/duas vezes/);
    });

    it('o provider mock não faz mais `replace(/\\D/g).slice(0, 6)` — usa o dono', () => {
        expect(prov).not.toMatch(/replace\(\/\\D\/g, ''\)\.slice\(0, 6\)/);
        expect(prov).toMatch(/normalizarCompetencia\(competencia\)/);
    });
});

// ═══ O nDPS DA NFS-e NACIONAL SAI DAS EMITIDAS ═══════════════════════════════
describe('o orquestrador da NFS-e Nacional deriva o sequencial das emitidas', () => {
    const src = semComentarios(ler('sefaz-backend/nfse-nacional-orchestrator.js'));
    it('lê as emitidas da empresa e chama o pure `proximoSequencialDps`', () => {
        expect(src).toMatch(/import \{ proximoSequencialDps \} from '\.\/nfse-nacional-dps-builder\.js'/);
        expect(src).toMatch(/proximoSequencialDps\(jaEmitidas, serieDps\)/);
        expect(src).toMatch(/provider\.emitirNfse\(\{ \.\.\.req, sequencial, serie: serieDps \}\)/);
        // E grava o número, para o próximo não depender de reler o idDps.
        expect(src).toMatch(/nDps: sequencial/);
    });
});
