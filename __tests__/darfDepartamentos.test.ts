// ============================================================================
// 🚨 O DARF DA DCTFWEB NÃO É DE UM DEPARTAMENTO SÓ — e enviar sem saber DOBRA
//    a cobrança no cliente.
//
// Paulo, 17/08 (HYPE CAFE SERVICOS DE ALIMENTACAO, 07/2026 — *"ERRO
// GRAVÍSSIMO"*): ele ia enviar o DARF de PIS/COFINS e, *"por desencargo"*, abriu
// o PDF. Dentro vinha o **1082 — CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO**,
// que é do DP/Folha. Se o DP mandar a guia dele, o cliente paga o 1082 duas
// vezes. Nada na tela dizia isso, e os botões de envio estavam ali.
//
// ═══ A VERDADE FISCAL QUE O TESTE PROTEGE ═══════════════════════════════════
//
// **Não existe "escolher os impostos" de um DARF.** A Receita consolida por
// VENCIMENTO: um vencimento, uma cobrança, com todos os códigos daquela data. A
// saída real é a guia POR VENCIMENTO — que a aba DARF já emite. O que faltava
// era o app DIZER, antes do envio, que o unificado mistura departamentos.
//
// Os números abaixo são do DARF REAL (documento 07.16.26229.7962009-0):
//   1082  CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO   201,71  venc 20/08
//   2172  COFINS - CONTRIB P/ FIN. SEG. SOCIAL            591,68  venc 25/08
//   8109  PIS - FATURAMENTO                              128,20  venc 25/08
//   Totais                                                921,59
// ============================================================================
import {
    departamentoPelaDescricao, classificarDebitoDarf,
    separarDarfPorDepartamento, avisoDeMistura,
} from '../sefaz-backend/darf-departamentos.js';
import { readFileSync } from 'fs';
import { join } from 'path';

/** O DARF real da HYPE CAFE 07/2026, campo a campo. */
const DARF_HYPE = [
    { codigo: '1082', descricao: 'CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO', valor: 201.71 },
    { codigo: '2172', descricao: 'COFINS - CONTRIB P/ FIN. SEG. SOCIAL', valor: 591.68 },
    { codigo: '8109', descricao: 'PIS - FATURAMENTO', valor: 128.20 },
];

describe('🚨 o caso REAL da HYPE: o DARF de PIS/COFINS trazia INSS do DP dentro', () => {
    it('separa os três débitos nos departamentos certos', () => {
        const s = separarDarfPorDepartamento(DARF_HYPE);
        expect(s.total).toBeCloseTo(921.59, 2);
        const porDep = Object.fromEntries(s.grupos.map((g: any) => [g.departamento, g.total]));
        expect(porDep['fiscal']).toBeCloseTo(719.88, 2);      // COFINS + PIS
        expect(porDep['dp-folha']).toBeCloseTo(201.71, 2);    // o 1082 que quase foi junto
    });

    it('🚨 e diz que está MISTURADO — é essa flag que segura o envio', () => {
        expect(separarDarfPorDepartamento(DARF_HYPE).misturado).toBe(true);
    });

    it('o aviso nomeia QUANTO é de cada um e diz o risco em dinheiro', () => {
        const a = avisoDeMistura(separarDarfPorDepartamento(DARF_HYPE))!;
        expect(a.texto).toContain('719,88');
        expect(a.texto).toContain('201,71');
        expect(a.texto).toContain('921,59');
        expect(a.texto).toMatch(/DUAS VEZES/);
    });

    it('🚨 o aviso NÃO promete escolher imposto — promete o que a Receita permite', () => {
        // Prometer um recorte por tributo seria promessa que a tela não cumpre
        // (a lição do ✕ que dizia "dá pra reverter no cadastro", 14/08).
        const a = avisoDeMistura(separarDarfPorDepartamento(DARF_HYPE))!;
        expect(a.acao).toMatch(/consolida por VENCIMENTO/);
        expect(a.acao).toMatch(/guias separadas por vencimento/i);
        // E diz o que fazer quando o vencimento é o MESMO — aí não há recorte.
        expect(a.acao).toMatch(/MESMO vencimento/);
        expect(a.acao).toMatch(/combine quem envia/i);
    });

    it('guia de um departamento só NÃO acusa nada', () => {
        const s = separarDarfPorDepartamento(DARF_HYPE.filter(d => d.codigo !== '1082'));
        expect(s.misturado).toBe(false);
        expect(avisoDeMistura(s)).toBeNull();
        expect(s.departamentos).toEqual(['fiscal']);
    });
});

describe('a DESCRIÇÃO manda, o código corrobora', () => {
    it('🚨 RETENÇÃO vem antes de "contribuição previdenciária"', () => {
        // "CP RETIDA" é contribuição previdenciária, mas de SERVIÇO TOMADO: vai
        // pela EFD-Reinf (Contábil), não pela folha. Testar "CONTR PREV" antes
        // carimbaria a retenção do Contábil como DP — a mesma mistura, na
        // direção contrária, e igualmente invisível.
        expect(departamentoPelaDescricao('CP RETIDA SOBRE NF DE SERVICO')).toBe('contabil');
        expect(departamentoPelaDescricao('CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO')).toBe('dp-folha');
    });

    it('faturamento é Fiscal; segurado/patronal é DP', () => {
        expect(departamentoPelaDescricao('PIS - FATURAMENTO')).toBe('fiscal');
        expect(departamentoPelaDescricao('IRPJ - PJ EM GERAL')).toBe('fiscal');
        expect(departamentoPelaDescricao('CONTRIBUICAO PREVIDENCIARIA PATRONAL')).toBe('dp-folha');
    });

    it('produção rural é Contábil (R-2055), não Fiscal', () => {
        expect(departamentoPelaDescricao('CONTRIB SOBRE AQUISICAO DE PRODUCAO RURAL')).toBe('contabil');
    });

    it('descrição que não diz nada devolve null — não se chuta', () => {
        expect(departamentoPelaDescricao('OUTROS')).toBeNull();
        expect(departamentoPelaDescricao('')).toBeNull();
        expect(departamentoPelaDescricao(null)).toBeNull();
    });
});

describe('🚨 não saber de quem é NÃO é o mesmo que saber que é meu', () => {
    it('código e descrição desconhecidos ⇒ nao-classificado, e ACENDE o alerta', () => {
        const s = separarDarfPorDepartamento([
            { codigo: '8109', descricao: 'PIS - FATURAMENTO', valor: 100 },
            { codigo: '9999', descricao: 'OUTROS DEBITOS', valor: 50 },
        ]);
        expect(s.naoClassificados).toHaveLength(1);
        // Um departamento reconhecido só, e ainda assim MISTURADO: o débito
        // desconhecido pode ser de outro depto, e o silêncio é o que dobra a
        // cobrança. Ausência de prova não é prova de ausência.
        expect(s.departamentos).toEqual(['fiscal']);
        expect(s.misturado).toBe(true);
    });

    it('código mapeado discordando da descrição ⇒ nao-classificado, com o motivo', () => {
        // Divergência é ALERTA de primeira classe (regra de 06/08), nunca
        // escolha silenciosa.
        const c = classificarDebitoDarf({ codigo: '1082', descricao: 'PIS - FATURAMENTO', valor: 10 });
        expect(c.departamento).toBe('nao-classificado');
        expect(c.motivo).toMatch(/Fiscal/);
        expect(c.motivo).toMatch(/DP \/ Folha/);
        expect(c.motivo).toMatch(/Não escolho por você/);
    });

    it('lista vazia não é "guia limpa" — não há o que afirmar', () => {
        const s = separarDarfPorDepartamento([]);
        expect(s.misturado).toBe(false);
        expect(s.total).toBe(0);
        expect(s.grupos).toHaveLength(0);
    });

    it('classificação carrega a FONTE — de-para de código não se inventa', () => {
        const c = classificarDebitoDarf(DARF_HYPE[0]!);
        expect(c.departamento).toBe('dp-folha');
        expect(c.fonte).toMatch(/DARF real/);
    });
});

describe('🚨 TODO caminho de envio passa pela mesma porta', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/DCTFWeb/DetalheDeclaracao.tsx'), 'utf8');
    const semComentarios = tela
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    it('as QUATRO rotas de envio chamam a trava — lista não vale, varredura vale', () => {
        // A lição de 13/08: régua que vale "em todo lugar que faz X" se trava
        // varrendo o X. Botão de envio novo sem a trava é guia dobrada no
        // cliente, e envelheceria EM SILÊNCIO.
        const rotas = ['enviarDarfPeloServidor', 'enviarDarfPorWhatsapp', 'enviarDarfAoCliente'];
        for (const rota of rotas) {
            const i = semComentarios.indexOf(`const ${rota} = async`);
            expect(i).toBeGreaterThan(-1);
            const corpo = semComentarios.slice(i, i + 400);
            expect(corpo).toMatch(/podeEnviarEstaGuia\(\)/);
        }
    });

    it('a trava CARREGA a composição sozinha — não depende de clique anterior', () => {
        // Depender de "Ver débitos apurados" seria proteger só quem já sabia do
        // problema, que é ninguém.
        const i = semComentarios.indexOf('const podeEnviarEstaGuia');
        const corpo = semComentarios.slice(i, i + 1600);
        expect(corpo).toMatch(/listarDebitosDeclaracao\(user/);
    });

    it('🚨 sem conseguir conferir, o envio PEDE confirmação — não libera calado', () => {
        const i = semComentarios.indexOf('const podeEnviarEstaGuia');
        const corpo = semComentarios.slice(i, i + 1600);
        expect(corpo).toMatch(/NÃO FOI POSSÍVEL CONFERIR/);
        // O que não pode: `return true` quando a composição não foi lida.
        expect(corpo).not.toMatch(/if \(!comp[^)]*\) return true/);
    });

    it('a tela NÃO reimplementa o de-para — importa o núcleo', () => {
        expect(tela).toMatch(/from '\.\.\/\.\.\/sefaz-backend\/darf-departamentos\.js'/);
        // Código de receita cravado na tela seria a segunda cópia da régua.
        expect(semComentarios).not.toMatch(/'1082'/);
        expect(semComentarios).not.toMatch(/'2172'/);
    });

    it('a composição aparece na TELA, antes dos botões', () => {
        expect(tela).toMatch(/composicaoDarf/);
        expect(tela).toMatch(/avisoDaComposicao/);
        // E é carregada junto com o DARF, sem esperar clique.
        expect(tela).toMatch(/darfConferido/);
    });
});
