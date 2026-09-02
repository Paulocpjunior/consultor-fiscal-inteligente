// ============================================================================
// sefaz-backend/caminho-sharepoint.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 O CAMINHO QUE O APP MONTAVA NÃO EXISTIA NO SHAREPOINT.
//
// 02/09, medido clique a clique pelo explorador. O app montava:
//
//   Empresas / GRUPO / DEPARTAMENTO FISCAL / 2026 / 09-2026 / EMPRESA / XML SAÍDA
//
// e o que existe em /sites/ClientesSP2 é:
//
//   Empresas / 0040_Clinica Mantoan / Departamento Contábil / 2026 / Setembro
//
// TRÊS divergências: o nível **GRUPO não existe** (confirmado pelo dono: *"não
// tem grupo"*), **empresa e departamento estão trocados**, e o mês é **por
// NOME** — `09-2026` não existe em lugar nenhum.
//
// 🚨 **E O NOME DA PASTA DA EMPRESA É HUMANO**: `0001_BRISKA`,
// `0004 – AÇOUGUE YOKOAMA`, `0022– LOJA DO CENTRO`, `0019 _3D PICTURES`. O
// separador muda, o traço às vezes é `–` e às vezes `-`, o espaço vem antes ou
// depois. **Montar esse nome por concatenação é impossível** — e montar errado
// criaria uma pasta NOVA ao lado da que existe, duplicando a empresa no
// SharePoint com o nome errado.
//
// ✂️ Por isso a régua é NAVEGAR, não prever: lista o nível e **casa pelo
// CÓDIGO** (`0040`), que é o único pedaço estável do nome. É a mesma lição do
// mês por extenso, um nível abaixo.
//
// 📌 DECISÕES DO DONO (02/09), e elas mandam neste módulo:
//   · a pasta do fiscal é **`Departamento Fiscal`**, IRMÃ de `Departamento
//     Contábil`, dentro da pasta da empresa;
//   · **o app CRIA** as pastas do fiscal — daí para baixo o nome é dele, e
//     por isso ele pode ser consistente (`Setembro`, não `Set`).
//
// ⚠️ **O APP NÃO CRIA A PASTA DA EMPRESA.** Ela já existe, com nome que uma
// pessoa escreveu; criar seria duplicar o cliente. Não achando o código, a
// régua RECUSA nomeando o código procurado.
// ============================================================================

/** A biblioteca onde as empresas moram. */
export const PASTA_RAIZ = 'Empresas';

/** A pasta do fiscal — irmã de "Departamento Contábil" (decisão de 02/09). */
export const DEPARTAMENTO_FISCAL = 'Departamento Fiscal';

/**
 * O mês por extenso — o app escreve assim porque é ele quem CRIA, e porque a
 * pasta vizinha (Contábil) usa nome de mês. `09-2026` não existe na árvore.
 */
export const MESES_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Tira acento, baixa a caixa e colapsa espaço — para COMPARAR, nunca para gravar. */
export function normalizar(texto) {
    return String(texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** '9' | '09' | 9 → 'Setembro'. Mês fora de 1..12 devolve null (nunca chuta). */
export function nomeDoMes(mes) {
    const n = Number(String(mes ?? '').replace(/\D/g, ''));
    if (!Number.isInteger(n) || n < 1 || n > 12) return null;
    return MESES_PT[n - 1];
}

/**
 * As formas em que o mês pode APARECER numa pasta escrita à mão.
 *
 * 🚨 A pasta do Contábil tem `Jan`, `Fev`, `Out` ao lado de `Setembro` e
 * `Novembro` — o mesmo ano, escrito de cinco jeitos. Ler só a forma que o app
 * grava faria a leitura falhar em pasta que existe.
 */
export function apelidosDoMes(mes, ano) {
    const nome = nomeDoMes(mes);
    if (!nome) return [];
    const n = Number(String(mes).replace(/\D/g, ''));
    const dd = String(n).padStart(2, '0');
    const abrev = nome.slice(0, 3);
    const formas = [nome, abrev, dd, String(n)];
    if (ano) formas.push(`${dd}-${ano}`, `${dd}_${ano}`, `${dd}/${ano}`);
    return [...new Set(formas.map(normalizar))];
}

/**
 * O código no começo do nome da pasta — o único pedaço estável.
 *
 * ⚠️ Só conta dígito no INÍCIO: `0083_Com. Evang. DF` é o código 0083, e
 * `AB Promoção` não tem código (devolve null em vez de inventar um).
 */
export function codigoDaPasta(nome) {
    const m = /^\s*(\d{1,6})/.exec(String(nome || ''));
    return m ? m[1] : null;
}

/**
 * Acha a pasta da empresa pelo CÓDIGO do cadastro.
 *
 * ⚠️ Compara por NÚMERO, não por texto: a pasta escreve `0040` e o cadastro
 * pode ter `40` — comparar como string faria a empresa "não existir".
 *
 * ⚠️ **Dois candidatos NÃO viram escolha silenciosa.** Se duas pastas têm o
 * mesmo código (`0109 – FASTWELD_ESTADO(PROVISORIO)` e `0109_Fastweld` estão
 * as duas lá), a régua devolve as duas e NÃO escolhe — gravar no lugar errado
 * espalha XML em duas pastas do mesmo cliente, e ninguém percebe.
 */
export function acharPastaDaEmpresa(pastas, codCliente) {
    const alvo = Number(String(codCliente ?? '').replace(/\D/g, ''));
    if (!Number.isInteger(alvo) || alvo <= 0) {
        return { situacao: 'codigo-ausente', pasta: null, candidatas: [] };
    }
    const nomes = (pastas || []).map(p => (typeof p === 'string' ? p : p?.nome)).filter(Boolean);
    const casam = nomes.filter(n => {
        const c = codigoDaPasta(n);
        return c !== null && Number(c) === alvo;
    });
    if (casam.length === 0) return { situacao: 'nao-encontrada', pasta: null, candidatas: [] };
    if (casam.length > 1) return { situacao: 'ambigua', pasta: null, candidatas: casam };
    return { situacao: 'ok', pasta: casam[0], candidatas: casam };
}

/**
 * Acha uma pasta por qualquer um dos nomes aceitos (comparação normalizada).
 * Devolve o nome REAL, com a grafia da pasta — é ele que vai na URL do Graph.
 */
export function acharPastaPorNome(pastas, aceitos) {
    const alvos = new Set((aceitos || []).map(normalizar));
    const nomes = (pastas || []).map(p => (typeof p === 'string' ? p : p?.nome)).filter(Boolean);
    return nomes.find(n => alvos.has(normalizar(n))) || null;
}

/**
 * O caminho do fiscal, a partir da pasta REAL da empresa.
 *
 * `Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Setembro/XML SAÍDA`
 *
 * ⚠️ Nada aqui é chutado: `pastaEmpresa` vem de `acharPastaDaEmpresa` (ou
 * seja, foi LIDO do SharePoint) e o resto é o que o app cria.
 */
export function caminhoFiscal({ pastaEmpresa, ano, mes, direcao = 'SAÍDA' }) {
    return caminhoDaFolha({ pastaEmpresa, ano, mes, folha: `XML ${direcao}` });
}

/**
 * Uma FOLHA qualquer dentro do mês — `XML SAÍDA`, `IMPOSTOS`, `RECIBOS`.
 *
 * ⚠️ Ela é o dono ÚNICO da árvore: `caminhoFiscal` e `caminhoImpostos` são
 * apelidos dela. Cada módulo montar a sua própria produziria o que este dia
 * achou — o mesmo caminho escrito em cinco lugares, e um deles errado.
 */
export function caminhoDaFolha({ pastaEmpresa, ano, mes, folha }) {
    const nomeMes = nomeDoMes(mes);
    if (!pastaEmpresa || !ano || !nomeMes || !folha) return null;
    return [PASTA_RAIZ, pastaEmpresa, DEPARTAMENTO_FISCAL, String(ano), nomeMes, folha].join('/');
}

/**
 * A pasta das GUIAS do rito de envio — irmã das de XML, no mesmo mês.
 *
 * 📌 O rito de 24/07 arquiva a guia em `IMPOSTOS`; ela passa a viver dentro do
 * `Departamento Fiscal` do mês, junto do que se refere àquela competência.
 */
export function caminhoImpostos({ pastaEmpresa, ano, mes }) {
    return caminhoDaFolha({ pastaEmpresa, ano, mes, folha: 'IMPOSTOS' });
}

/**
 * A pasta dos RECIBOS da REINF — irmã de IMPOSTOS.
 *
 * 📌 IMPOSTOS guarda a GUIA (o que o cliente paga); RECIBOS guarda a PROVA DE
 * ENTREGA da obrigação acessória. Misturar faz alguém mandar recibo no lugar
 * da guia.
 */
export function caminhoRecibos({ pastaEmpresa, ano, mes }) {
    return caminhoDaFolha({ pastaEmpresa, ano, mes, folha: 'RECIBOS' });
}
