// ============================================================================
// 🧰 Varredura dos defeitos VERIFICADOS do frontend (03/09), por classe.
//
// Cada bloco lê o CÓDIGO (nunca a prosa) e cobra a forma que fecha a classe:
//   A) dinheiro digitado passa pelo DONO (`parseValorMoeda`) — ilegível é
//      recusa nomeada, nunca `|| 0`, e "1.234,56" não vira 1.23 nem 123456;
//   B) toast de sucesso só depois do write resolver;
//   C) spinner solta em `finally` — rede que cai não trava o botão;
//   D) promessa sem catch vira estado de erro na tela;
//   E) `res.ok` é lido antes de tratar o JSON como dado;
//   F) JSON.parse de cache passa por `safeStorage`;
//   H) componente sem consumidor não fica no repo;
//   I) CNPJ de piloto não é default de campo; a caixa do cofre tem UM dono.
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { montarArquivoGiaSt } from '../services/giaStExportService';

const RAIZ = join(__dirname, '..');
const ler = (f: string) => readFileSync(join(RAIZ, f), 'utf8');
// Varredura lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS, 22/08).
const semComentarios = (s: string) => s.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
const depois = (src: string, ancora: string, janela = 900) => {
    const i = src.indexOf(ancora);
    expect(`${ancora} encontrado=${i >= 0}`).toBe(`${ancora} encontrado=true`);
    return src.slice(i, i + janela);
};

function fontes(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) fontes(p, out);
        else if (/\.(ts|tsx)$/.test(nome)) out.push(p);
    }
    return out;
}

describe('A) dinheiro digitado passa pelo dono', () => {
    const PORTAS = [
        'components/NfseNacional/EmitirModal.tsx',
        'components/LucroPresumidoReal/DareSpModal.tsx',
        'components/EfdReinf/FechamentoReinfPanel.tsx',
        'components/TaxEmission/DarfModal.tsx',
        'components/SimuladorReforma/index.tsx',
        'components/SpedFiscal/ConciliarFaturamento.tsx',
        'components/LucroPresumidoReal/BaseCreditoModal.tsx',
        'components/SimplesNacionalDetalhe.tsx',
    ];
    it.each(PORTAS.map((f) => [f]))('%s importa parseValorMoeda e não carrega a cópia', (f) => {
        const src = semComentarios(ler(f));
        expect(src).toMatch(/from '\.\.?\/(?:\.\.\/)?services\/valorDigitado'/);
        // As duas formas que quebravam: vírgula→ponto sem tirar o milhar
        // (1.500,00 → 1.5) e tirar TODO ponto antes da vírgula (1234.56 → 123456).
        expect(src).not.toMatch(/parseFloat\([a-zA-Z.]+\.replace\(',', '\.'\)\)/);
        expect(src).not.toMatch(/Number\(String\([a-zA-Z.]+\)\.replace\(',', '\.'\)\)/);
        expect(src).not.toMatch(/replace\(\/\\\.\/g, ?''\)\.replace\(',', ?'\.'\)/);
    });

    it('EmitirModal recusa nomeando o campo antes de emitir', () => {
        const src = ler('components/NfseNacional/EmitirModal.tsx');
        expect(src).toMatch(/valorLido === null\) return onShowToast\(`Não entendi o valor do serviço/);
    });

    it('FechamentoReinf: vazio fica de fora, ilegível recusa nomeando o código, nada vira 0', () => {
        const src = semComentarios(ler('components/EfdReinf/FechamentoReinfPanel.tsx'));
        expect(src).toMatch(/ilegiveis\.length\) \{\s*setErro\(`Não entendi o valor do totalizador/);
        expect(src).not.toMatch(/\|\| 0 \}\)\)/);
    });

    it('SimplesNacionalDetalhe: gravar recusa o CNAE ilegível e diz que NÃO gravou', () => {
        const src = semComentarios(ler('components/SimplesNacionalDetalhe.tsx'));
        expect(src).toMatch(/Não entendi o faturamento em .*Os valores NÃO foram gravados/);
        expect(src).not.toMatch(/isNaN\(val\) \? 0 : val/);
    });

    it('GIA-ST: a mensagem lida por gente sai em pt-BR, não "R$ 1234.56"', () => {
        const guia = { ufFavorecida: 'MG', competencia: '07/2026', inconsistencias: [], c14IcmsDevolucao: 1234.56, c15IcmsRessarcimentos: 0 };
        expect(() => montarArquivoGiaSt([{ guia, anexoI: [] } as never], { nome: 'Fulano', cpf: '12345678901' } as never))
            .toThrow(/R\$ 1\.234,56 difere/);
        expect(ler('services/giaStExportService.ts')).not.toMatch(/toFixed\(2\)\} difere/);
    });
});

describe('B) sucesso só depois do write', () => {
    it('NfpProCloud: saveAnalise devolve {ok} e quem chama não promete nem navega na falha', () => {
        const src = semComentarios(ler('components/NfpProCloud/index.tsx'));
        expect(src).toMatch(/Promise<\{ ok: boolean \}>/);
        expect(src).toMatch(/return \{ ok: true \};/);
        expect((src.match(/const salvou = await saveAnalise\(/g) || []).length).toBeGreaterThanOrEqual(3);
        expect((src.match(/if \(!salvou\.ok\) return;/g) || []).length).toBeGreaterThanOrEqual(3);
        expect(src).not.toMatch(/await saveAnalise\((nova|updated|atualizada)\);\s*onShowToast/);
    });

    it('App: edição do Simples com try/catch; folha e cadastro aguardam o write antes do estado', () => {
        const src = semComentarios(ler('App.tsx'));
        const edicao = depois(src, 'if (simplesEmpresaToEdit) {', 1200);
        expect(edicao).toMatch(/try \{\s*await simplesService\.updateEmpresa\(simplesEmpresaToEdit\.id/);
        expect(edicao).toMatch(/catch \(err: any\) \{\s*setToastMessage\(`Erro ao atualizar empresa/);

        const folha = depois(src, 'const handleUpdateFolha12 = async', 700);
        expect(folha.indexOf('await simplesService.updateFolha12(')).toBeLessThan(folha.indexOf('setSimplesEmpresas('));
        expect(folha).toMatch(/O valor NÃO foi gravado/);

        const fat = depois(src, 'const handleSaveFaturamentoManual = async', 700);
        expect(fat).toMatch(/Os valores NÃO foram gravados/);
        expect(fat).toMatch(/throw err;/);

        const upd = depois(src, 'const handleUpdateEmpresa = async', 700);
        expect(upd.indexOf('await simplesService.updateEmpresa(')).toBeLessThan(upd.indexOf('setSimplesEmpresas('));
    });

    it('Detalhe do Simples: o histórico só fecha o modal depois do write', () => {
        const src = depois(semComentarios(ler('components/SimplesNacionalDetalhe.tsx')), 'const handleSaveHistory = async', 700);
        expect(src).toMatch(/try \{\s*await onSaveFaturamentoManual/);
        expect(src).toMatch(/Erro ao salvar o histórico.*NÃO foram gravados/);
    });
});

describe('C) spinner solta em finally', () => {
    const SITES: Array<[string, string]> = [
        ['components/FimDeMesBloco.tsx', 'await darFimDeMes('],
        ['components/FimDeMesBloco.tsx', 'await reabrirCompetencia('],
        ['components/xml/DipamProdutorRuralPanel.tsx', 'cpfTitular: limpo } as any)'],
        ['components/xml/DipamProdutorRuralPanel.tsx', 'await salvarProdutorRural({ doc, nome, natureza, seguradoEspecial })'],
        ['components/Tarefas.tsx', 'const moverPara = async'],
        ['components/Tarefas/ModalCriarTarefa.tsx', 'await criarTarefaManual('],
        ['components/AnaliseCredito/ModalInvoiceManual.tsx', 'await adicionarInvoice('],
        ['hooks/useCategoriasCredito.ts', 'await salvarCreditConfig('],
    ];
    it.each(SITES)('%s — %s termina em finally', (arquivo, ancora) => {
        const trecho = depois(semComentarios(ler(arquivo)), ancora, 900);
        expect(trecho).toMatch(/finally\s*\{/);
    });
});

describe('D) promessa sem catch vira erro na tela', () => {
    it.each([['components/SpedFiscal/ConciliarFaturamento.tsx'], ['components/SpedFiscal/CruzarComCapturadas.tsx']])('%s lista de empresas', (f) => {
        const trecho = depois(semComentarios(ler(f)), 'getEmpresasDisponiveis(currentUser).then', 400);
        expect(trecho).toMatch(/\.catch\(/);
        expect(trecho).toMatch(/Não deu para listar as empresas/);
    });
    it('SpConnect: estado do Instagram que não responde é DITO', () => {
        const src = semComentarios(ler('components/SpConnect/index.tsx'));
        expect(src).toMatch(/const \[igEstadoErro, setIgEstadoErro\]/);
        expect(src).toMatch(/else setIgEstadoErro\(r\.error/);
        expect(src).toMatch(/\}\)\(\)\.catch\(\(e: any\) => setIgEstadoErro/);
        expect(src).toMatch(/\{igEstadoErro && <p/);
    });
});

describe('E) res.ok antes do JSON', () => {
    const SITES: Array<[string, string]> = [
        ['components/PrazosMunicipaisPanel.tsx', "fetch('/api/admin/prazos-municipais', { headers"],
        ['components/PrazosMunicipaisPanel.tsx', "fetch('/api/admin/prazos-municipais/consultar'"],
        ['components/NfseSpSessaoCookies.tsx', "fetch('/api/admin/sefaz/nfsesp-portal-session'"],
        ['components/xml/IssSpPanel.tsx', "fetch('/api/admin/sefaz/nfsesp-ws-sonda'"],
        ['components/xml/IssSpPanel.tsx', "fetch('/api/admin/sefaz/nfsesp-ws-diagnostico'"],
        ['components/ConfigAdminModal.tsx', "fetch('/api/admin/gemini/versao'"],
        ['components/AnalisadorRegime/AnalisadorRegime.tsx', "fetch('/api/gemini'"],
    ];
    it.each(SITES)('%s — %s', (arquivo, ancora) => {
        const trecho = depois(semComentarios(ler(arquivo)), ancora, 700);
        expect(trecho).toMatch(/if \(!r\.ok\)/);
        // o motivo do backend viaja quando existe
        expect(trecho).toMatch(/\.error/);
    });
    it('ConsultaNFePorChavePanel: falha da consulta não é lida como cert inválido', () => {
        expect(ler('components/ConsultaNFePorChavePanel.tsx')).toMatch(/isto não diz que o certificado é inválido/);
    });
});

describe('F) cache local não derruba a importação', () => {
    it('as notas do Simples leem pelo safeStorage.getJSON', () => {
        // O caminho da GRAVAÇÃO (depois do setDoc na nuvem) — a leitura já tinha try/catch.
        const src = depois(semComentarios(ler('services/simplesNacionalService.ts')), "setDoc(doc(dbRef, 'simples_notas'", 700);
        expect(src).toMatch(/safeStorage\.getJSON\(STORAGE_KEY_NOTAS, \{\}\)/);
        expect(src).not.toMatch(/JSON\.parse\(/);
    });
});

describe('H) componente sem consumidor não fica no repo', () => {
    it('ObrigacoesETarefas saiu e ninguém o importa', () => {
        expect(existsSync(join(RAIZ, 'components/ObrigacoesETarefas.tsx'))).toBe(false);
        const alvos = [...fontes(join(RAIZ, 'components')), join(RAIZ, 'App.tsx')];
        const consumidores = alvos.filter((p) => /ObrigacoesETarefas['"]/.test(readFileSync(p, 'utf8')));
        expect(consumidores.map((p) => relative(RAIZ, p))).toEqual([]);
    });
});

describe('I) defaults e literais', () => {
    it('SaeNfceCaptura nasce sem CNPJ de piloto', () => {
        expect(semComentarios(ler('components/xml/SaeNfceCaptura.tsx'))).toMatch(/const \[cnpj, setCnpj\] = useState\(''\)/);
    });
    it('a caixa do cofre tem UM dono e nenhuma tela repete o literal', () => {
        const { EMAIL_COFRE_XML } = require('../services/cofreInstrucoes');
        expect(EMAIL_COFRE_XML).toBe('xml@spassessoriacontabil.com.br');
        const infratores = fontes(join(RAIZ, 'components'))
            .filter((p) => readFileSync(p, 'utf8').includes(EMAIL_COFRE_XML))
            .map((p) => relative(RAIZ, p).replace(/\\/g, '/'));
        expect(infratores).toEqual([]);
        for (const f of ['components/xml/AutXmlHarvest.tsx', 'components/xml/CofreEmailPanel.tsx', 'components/xml/CofreChecklistPanel.tsx', 'components/CapturaDiagnosticoPanel.tsx']) {
            expect(ler(f)).toMatch(/EMAIL_COFRE_XML/);
        }
    });
});
