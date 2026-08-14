// ============================================================================
// A TELA DO R-2010 — e a régua que ela NÃO pode reimplementar.
//
// Paulo, 14/08: *"pode começar r-2010"*, na sequência de fechar o R-2055.
//
// O núcleo (`reinf-servicos-tomados.js`) e a rota existiam desde 12/08,
// calibrados contra um `evtServTom` REAL com recibo de sucesso da Receita. O
// que faltava era a tela: ninguém no escritório conseguia VER o que vai ser
// declarado — e rota que nenhuma tela chama não é funcionalidade, é código
// morto com cara de entrega (mata-burro de 13/08).
//
// ═══ O QUE ESTA TRAVA VIGIA ═════════════════════════════════════════════════
//
// O achado que manda no módulo veio do arquivo aceito: a BASE de retenção NÃO é
// o valor bruto quando houve dedução de material/insumo (IN RFB 971, arts.
// 121-124) — no evento de referência o bruto é 5.755,54 e a base é 4.604,43.
// Declarar base = bruto ali seria declarar retenção sobre 25% a mais.
//
// A tela mostra; ela não decide. Conferência que recalcula promete um número
// diferente do que o outro app declara — o pior defeito de um arquivo fiscal.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { conferirBaseRetencaoInss, ALIQUOTA_ART31, ALIQUOTA_CPRB } from '../sefaz-backend/reinf-servicos-tomados.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const painel = ler('components/EfdReinf/ServicosTomadosPanel.tsx');
const servico = ler('services/reinfServicosTomadosService.ts');
const hub = ler('components/DCTFWeb/DctfwebHub.tsx');

describe('o caso REAL que calibrou o módulo continua respondido', () => {
    it('bruto 5.755,54 com retido 506,49 ⇒ houve dedução, base NÃO é o bruto', () => {
        // Números do evtServTom aceito (06/2026): a base declarada é 4.604,43,
        // 25% menor que o bruto. Se a régua algum dia disser "base = bruto"
        // aqui, o app passa a declarar retenção sobre valor que não existe.
        const c = conferirBaseRetencaoInss({ bruto: 5755.54, retido: 506.49 });
        expect(c.situacao).toBe('base-deduzida-nao-informada');
        expect(c.baseOrigem).toBe('derivada-da-retencao');
        expect(c.exigeAcao).toBe(true);
    });

    it('11% cheios provam que NÃO houve dedução — aí a base é o bruto', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 110 });
        expect(c.situacao).toBe('base-e-o-bruto');
        expect(c.base).toBe(1000);
        expect(c.indCPRB).toBe(0);
        expect(ALIQUOTA_ART31).toBe(11);
    });

    it('3,5% é AMBÍGUO e o app não escolhe — são indCPRB diferentes', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 35 });
        expect(c.situacao).toBe('aliquota-ambigua-cprb-ou-deducao');
        expect(c.base).toBeNull();
        expect(c.indCPRB).toBeNull();
        expect(ALIQUOTA_CPRB).toBe(3.5);
    });
});

describe('a tela existe, está montada e não tem régua própria', () => {
    it('está no hub, com caminho para o colaborador', () => {
        expect(hub).toMatch(/ServicosTomadosPanel/);
        expect(hub).toMatch(/R-2010 serviços tomados/);
    });

    it('lê do backend e NÃO recalcula alíquota, base nem retenção', () => {
        expect(servico).toMatch(/\/api\/admin\/reinf\/servicos-tomados/);
        // As assinaturas de quem estaria refazendo a conta do núcleo.
        expect(painel).not.toMatch(/\b11\s*\/\s*100|0\.11\b/);
        expect(painel).not.toMatch(/vlrBruto\s*\*/);
        expect(painel).not.toMatch(/aliquotaAparente\s*=/);
    });

    it('base NÃO PROVADA aparece como texto, nunca como número', () => {
        // Total parcial num campo chamado "base de retenção" seria lido como a
        // base inteira — é a razão de o backend mandar null.
        expect(painel).toMatch(/vlrTotalBaseRet === null/);
        expect(painel).toMatch(/não provada/);
    });

    it('as ressalvas vêm do backend — repeti-las na tela faria as duas divergirem', () => {
        expect(painel).toMatch(/dados\.ressalvas/);
        expect(painel).not.toMatch(/tpServico.*tabela 06/s);
    });

    it('o que ficou de FORA aparece: sem retenção e prestador pessoa física', () => {
        // Some da lista é o que faz alguém achar que declarou tudo.
        expect(painel).toMatch(/semRetencaoPrevidenciaria/);
        expect(painel).toMatch(/dePessoaFisica/);
        expect(painel).toMatch(/eSocial/);
    });

    it('lista vazia não é prova de ausência de retenção', () => {
        expect(painel).toMatch(/não prova/);
    });
});
