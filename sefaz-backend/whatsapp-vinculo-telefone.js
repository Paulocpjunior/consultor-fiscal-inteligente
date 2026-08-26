// ============================================================================
// 🔗 QUEM É O CLIENTE DESTE NÚMERO? — a medição antes da tela
//
// Nos prints de 26/08 quase toda conversa tem o selo âmbar **"vincular"** e a
// coluna do cliente diz *"Sem vínculo com o cadastro"*. Isso trava três coisas
// de uma vez: a coluna do cliente (responsável da carteira + guias enviadas)
// nasce vazia, o relatório de atendimento não sabe de qual cliente é cada
// conversa, e a fase 3 da IA — responder com os dados do próprio app — é
// impossível, porque ela não sabe de quem é o número.
//
// O cadastro JÁ tem onde guardar isso: `dadosFiscais.whatsappCliente` e
// `dadosFiscais.telefone`. O que faltava era cruzar.
//
// 🚨 E ISTO SUGERE, NUNCA DECIDE. Número de WhatsApp muda de dono, o telefone
// do cadastro às vezes é o do contador e não o do cliente, e vincular errado
// mostraria as guias de um cliente dentro da conversa de outro — dado fiscal
// na tela da pessoa errada. Toda sugestão sai CARIMBADA com o campo que casou,
// e quem confirma é gente.
//
// ⚠️ E A AMBIGUIDADE NÃO VIRA ESCOLHA SILENCIOSA: dois clientes com o mesmo
// número devolvem os DOIS, nomeados, sem sugestão — é a mesma régua do
// `principal` do cadastro central (07/08). Escolher aqui faria o app apontar o
// cliente errado com toda a confiança.
// ============================================================================

/** Só os dígitos, sem o DDI 55 do Brasil. Devolve '' pro que não dá pra ler. */
function local(bruto) {
    let d = String(bruto || '').replace(/\D/g, '');
    // 55 + DDD + 8 ou 9 dígitos. O `55` só sai quando o que sobra tem tamanho
    // de telefone brasileiro — senão um número que COMECE com 55 (ex.: DDD 55,
    // Rio Grande do Sul) perderia os dois primeiros dígitos.
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    return d.length === 10 || d.length === 11 ? d : '';
}

/**
 * As formas COMPARÁVEIS de um número. O 9º dígito entrou em 2012 e o cadastro
 * da casa tem número dos dois tempos, então `11997377599` e `1197377599` são o
 * MESMO telefone e precisam casar.
 *
 * ⚠️ E a expansão só vale pra CELULAR: fixo tem 8 dígitos começando em 2-5, e
 * pôr um 9 na frente dele inventaria um celular que talvez seja de outra
 * pessoa — casamento falso no lugar mais caro, que é o que decide de quem é a
 * conversa.
 */
export function formasDoNumero(bruto) {
    const d = local(bruto);
    if (!d) return [];
    const ddd = d.slice(0, 2);
    const resto = d.slice(2);
    const formas = new Set([d]);
    if (resto.length === 9 && resto.startsWith('9')) formas.add(ddd + resto.slice(1));
    if (resto.length === 8 && /^[6-9]/.test(resto)) formas.add(`${ddd}9${resto}`);
    return [...formas];
}

/** Os dois números que uma empresa pode ter no cadastro, com a ORIGEM junto. */
export function telefonesDaEmpresa(empresa = {}) {
    const df = empresa.dadosFiscais || {};
    // `whatsappCliente` é o campo que existe PARA isto — ele vence o
    // `telefone`, que é o telefone geral e às vezes é o do escritório.
    const candidatos = [
        ['whatsappCliente', df.whatsappCliente ?? empresa.whatsappCliente],
        ['telefone', df.telefone ?? empresa.telefone],
    ];
    const saida = [];
    for (const [campo, valor] of candidatos) {
        for (const forma of formasDoNumero(valor)) saida.push({ campo, forma });
    }
    return saida;
}

/**
 * O cruzamento. Entram as conversas SEM vínculo e as empresas do cadastro;
 * sai a medição + a lista de sugestões.
 *
 * A resposta separa três desfechos porque as AÇÕES são diferentes:
 *  · `sugestoes`   → um clique de confirmação;
 *  · `ambiguos`    → alguém decide qual, ou arruma o cadastro duplicado;
 *  · `semCadastro` → o número não está em cadastro nenhum: ou é terceiro
 *                    (candidato a vaga, fornecedor), ou o cliente nunca teve o
 *                    WhatsApp preenchido. Fundir os três num número só faria
 *                    parecer que existe um botão pra resolver tudo.
 */
export function cruzarNumerosComCadastro({ conversas = [], empresas = [] } = {}) {
    const indice = new Map();          // forma → [{empresaId, nome, campo}]
    let empresasComNumero = 0;
    for (const e of empresas) {
        const tels = telefonesDaEmpresa(e);
        if (tels.length) empresasComNumero += 1;
        for (const { campo, forma } of tels) {
            const lista = indice.get(forma) || [];
            // A MESMA empresa aparecendo pelos dois campos não é ambiguidade —
            // é o mesmo cliente duas vezes. Sem isto, todo cadastro que repete
            // o número em `telefone` e `whatsappCliente` viraria "ambíguo" e a
            // fila encheria de conflito que não existe.
            if (!lista.some((x) => x.empresaId === e.id)) {
                // 🐛 `nomeEmpresa`, nunca `nome`: a linha da conversa JÁ tem um
                // `nome` (o do contato), e o espalhamento lá embaixo trocaria o
                // nome de quem escreveu pelo nome do cliente. Dois fatos
                // diferentes com a mesma chave é a armadilha de sempre, aqui na
                // tela onde o atendente lê com quem está falando.
                lista.push({ empresaId: e.id, nomeEmpresa: e.nome || e.razaoSocial || e.id, campo });
                indice.set(forma, lista);
            }
        }
    }

    const sugestoes = [];
    const ambiguos = [];
    const semCadastro = [];
    const semNumeroLegivel = [];

    for (const c of conversas) {
        const formas = formasDoNumero(c.numero);
        if (!formas.length) {
            // DM do Instagram não tem telefone — ela não é lacuna de vínculo,
            // é outro canal. Sai nomeada em vez de virar "sem cadastro".
            semNumeroLegivel.push({ numero: c.numero, nome: c.nome || null, canal: c.canal || null });
            continue;
        }
        const achados = [];
        for (const f of formas) {
            for (const x of indice.get(f) || []) {
                if (!achados.some((a) => a.empresaId === x.empresaId)) achados.push(x);
            }
        }
        const linha = {
            numero: c.numero, nome: c.nome || null, fila: c.fila || null,
            // 🚨 CONTATO ≠ CONVERSA, e misturar os dois faz o buraco parecer
            // sete vezes maior do que é (26/08, primeira medição real: 2.216
            // "sem vínculo" onde a maioria é o CATÁLOGO importado da Ultra
            // Fox, gente que nunca trocou uma mensagem aqui). Quem já
            // escreveu é lacuna de verdade; quem só está na agenda não é.
            temConversa: Boolean(c.temConversa),
        };
        if (achados.length === 1) sugestoes.push({ ...linha, ...achados[0] });
        else if (achados.length > 1) ambiguos.push({ ...linha, candidatos: achados });
        else semCadastro.push(linha);
    }

    // A ordem é a do trabalho: quem casou pelo campo do WhatsApp primeiro (o
    // sinal mais forte), e dentro disso quem tem fila — conversa viva vale
    // mais que contato parado.
    sugestoes.sort((a, b) => (a.campo === b.campo ? 0 : a.campo === 'whatsappCliente' ? -1 : 1));

    // O recorte que importa: quem JÁ TROCOU MENSAGEM aqui. O resto é agenda.
    const comConversa = (lista) => lista.filter((x) => x.temConversa).length;

    return {
        total: conversas.length,
        empresasComNumero,
        sugestoes,
        ambiguos,
        semCadastro,
        semNumeroLegivel,
        // 🚨 A MESMA CONTA NO RECORTE DE QUEM ESCREVEU. Sem ela, "2.159 sem
        // cadastro" lê-se como 2.159 clientes perdidos — e a ação (preencher
        // cadastro) seria cobrada sobre uma agenda que em boa parte nem é de
        // cliente. Alarme com número inflado é o que faz a equipe parar de
        // olhar o painel.
        ativos: {
            total: conversas.filter((c) => c.temConversa).length,
            sugestoes: comConversa(sugestoes),
            ambiguos: comConversa(ambiguos),
            semCadastro: comConversa(semCadastro),
        },
    };
}

/** A sugestão de UMA conversa — o que a coluna do cliente mostra. */
export function sugestaoParaNumero(numero, empresas = []) {
    const r = cruzarNumerosComCadastro({ conversas: [{ numero }], empresas });
    if (r.sugestoes.length === 1) return { situacao: 'sugerida', ...r.sugestoes[0] };
    if (r.ambiguos.length === 1) return { situacao: 'ambigua', candidatos: r.ambiguos[0].candidatos };
    return { situacao: 'sem-cadastro' };
}
