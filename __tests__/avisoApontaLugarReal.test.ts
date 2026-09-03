// ============================================================================
// 🚨 AVISO QUE MANDA A PESSOA A UM LUGAR TEM DE APONTAR UM LUGAR QUE ELA ACHA
//
// Varredura de 21/08, no rastro do achado do E250: dois avisos mandavam
// *"informe no cadastro"* e o cadastro **não existia em tela nenhuma** — a
// pessoa procurava, não achava, e concluía que o app estava quebrado. Isso é
// PIOR que silêncio: gasta o tempo dela e ensina a desconfiar do app inteiro.
//
// Varrendo os 61 avisos que apontam um lugar, sobraram três com o mesmo vício
// em forma mais leve: apontar a **chave do banco** ("preencha em
// `dadosFiscais.uf`") ou lugar nenhum ("informe a contagem física"). O
// colaborador não sabe o que é `dadosFiscais` — ele sabe o que é o botão
// "Dados Fiscais".
//
// Esta trava fecha a CLASSE: mensagem de usuário não cita caminho de campo do
// Firestore. Ela é deliberadamente ESTREITA — só a assinatura literal
// `dadosFiscais.<campo>` dentro de string de mensagem —, porque falso positivo
// em teste que bloqueia build vira teste desligado.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');
const PASTAS = ['sefaz-backend', 'services', 'components'];
const EXTENSOES = ['.ts', '.tsx', '.js'];

/**
 * Onde citar o caminho do campo é legítimo, COM o motivo escrito.
 * Exceção se declara aqui — nunca apagando a varredura.
 */
const PERMITIDO: Record<string, string> = {
    // Mensagem para o DESENVOLVEDOR (erro de programação), não para a equipe.
    'sefaz-backend/sped-fiscal-orchestrator.js': 'erro de coleta, lido no log',
    'sefaz-backend/sped-contrib-orchestrator.js': 'erro de coleta, lido no log',
};

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules' || nome === 'dist' || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (EXTENSOES.some((e) => nome.endsWith(e))) out.push(p);
    }
    return out;
}

/** A linha é uma MENSAGEM (tem verbo de instrução dentro de aspas)? */
const INSTRUCAO = /(preencha|cadastre|informe|configure|corrija)/i;

describe('🚨 aviso ao usuário aponta TELA, não chave do banco', () => {
    it('nenhuma mensagem manda preencher um caminho de campo do Firestore', () => {
        const infratores: string[] = [];
        // Varredura vazia é trava falsa: as três pastas somam ~940 arquivos hoje.
        expect(PASTAS.flatMap((p) => varrer(join(RAIZ, p))).length).toBeGreaterThan(500);
        for (const pasta of PASTAS) {
            for (const arquivo of varrer(join(RAIZ, pasta))) {
                const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
                if (PERMITIDO[rel]) continue;
                readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
                    const semComentario = linha.replace(/\/\/.*$/, '');
                    if (!INSTRUCAO.test(semComentario)) return;
                    if (!/dadosFiscais\.[a-zA-Z]/.test(semComentario)) return;
                    // Só conta quando o caminho está DENTRO da mensagem (aspas).
                    if (!/['"`][^'"`]*dadosFiscais\.[a-zA-Z][^'"`]*['"`]/.test(semComentario)) return;
                    infratores.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 90)}`);
                });
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 AVISO APONTANDO A CHAVE DO BANCO\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nQuem lê o aviso é o COLABORADOR, e ele não sabe o que é `dadosFiscais` — ele sabe\n'
                + 'o que é o botão "Dados Fiscais". Escreva o caminho da tela ("Empresas → Dados\n'
                + 'Fiscais", "SPED Fiscal → aba Ajustes E111").\n\n'
                + 'Se a mensagem for para o LOG (erro de programação), declare o arquivo em PERMITIDO\n'
                + 'COM o motivo — nunca apague a varredura.\n',
            );
        }
    });

    // As três que a varredura de 21/08 corrigiu, travadas pelo texto que ficou.
    it('e as três corrigidas continuam dizendo o caminho', () => {
        const diz = (rel: string, trecho: string) =>
            expect({ rel, ok: readFileSync(join(RAIZ, rel), 'utf8').includes(trecho) })
                .toEqual({ rel, ok: true });
        diz('sefaz-backend/sync-orchestrator-cte.js', 'Empresas → Dados Fiscais');
        diz('sefaz-backend/sped-bloco-h.js', 'aba 📦 Inventário (Bloco H)');
        // ⚠️ A do canal da Prefeitura de SP MUDOU DE CASA em 29/08, e a trava
        // literal reprovou a própria correção — a 7ª vez desta família.
        //
        // A mensagem vivia no `caixa-postal-provider.js` e dizia "preencha o
        // CCM" para a carteira INTEIRA, porque o `ccmSp` nunca era passado.
        // Agora quem responde é o DONO (`caixa-postal-prefeitura-sp.js`), e ele
        // só manda preencher quem é de SP CAPITAL — para os demais o campo não
        // existe e mandar preencher era o aviso que não resolve.
        diz('sefaz-backend/caixa-postal-prefeitura-sp.js', 'Empresas → Dados Fiscais');
    });

    // 🚨 E a MESMA classe, um passo adiante: a mensagem tem de apontar um lugar
    // que RESOLVA. Mandar preencher o CCM em empresa que não é de SP capital
    // aponta uma tela que existe e um campo que ela não tem — a pessoa procura,
    // preenche, e nada muda.
    it('o canal da Prefeitura de SP não manda preencher CCM em quem não é da capital', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { canalPrefeituraSp } = require('../sefaz-backend/caixa-postal-prefeitura-sp.js');
        const fora = canalPrefeituraSp({ dadosFiscais: { codMunIBGE: '3518800' } });
        expect(fora.situacao).toBe('nao-se-aplica');
        expect(String(fora.motivo)).not.toMatch(/Dados Fiscais/);
    });

    // O achado que abriu a classe: o aviso mandava cadastrar num lugar que não
    // existia. Estes dois agora existem — e o teste do PR anterior prova a tela.
    it('os avisos do E250 e do C197 apontam a aba que passou a existir', () => {
        for (const rel of ['sefaz-backend/sped-bloco-e-st.js', 'sefaz-backend/sped-difal-c197.js']) {
            expect({ rel, ok: readFileSync(join(RAIZ, rel), 'utf8').includes('Ajustes E111') })
                .toEqual({ rel, ok: true });
        }
    });
});
