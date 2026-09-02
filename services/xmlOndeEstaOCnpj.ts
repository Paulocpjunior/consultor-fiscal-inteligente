// ============================================================================
// services/xmlOndeEstaOCnpj.ts  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "ME MANDE O ARQUIVO" É PASSAR O PROBLEMA DE VOLTA.
//
// 02/09, caso do Ivan (0530): a importação recusou notas de serviço PRESTADO
// dizendo `emit: -` — o app não leu o prestador. Minha resposta foi pedir o
// XML, e o Paulo cortou na hora: *"como vou enviar um arquivo se você diz que
// não posso capturar?"*.
//
// Ele está certo, e a régua da casa já dizia isso desde 24/08: **quando o app
// tem como saber a resposta, avisar não é entrega — é passar o problema
// adiante**. E o app TEM: o arquivo está na mão dele, foi ele que leu e
// falhou. A pergunta *"onde está o CNPJ desta empresa neste XML?"* se responde
// com o arquivo que já está ali.
//
// ⚠️ O QUE SAI DAQUI É ESTRUTURA, NUNCA CONTEÚDO: nomes de tag e o CNPJ que a
// própria pessoa digitou. Nenhum outro valor do documento é exposto — quem lê
// a tela não precisa ver o dado do cliente para saber por que a leitura falhou.
// ============================================================================

const soDigitos = (s: string) => String(s || '').replace(/\D/g, '');

export interface OcorrenciaDeDocumento {
    /** A tag que CONTÉM o número — `Cnpj`, `CNPJ`, `CpfCnpj`… */
    tag: string;
    /** O caminho de tags até ela — `Nfse > InfNfse > PrestadorServico > …`. */
    caminho: string[];
    /** Só dígitos. */
    documento: string;
}

/**
 * Todo CNPJ/CPF do XML, com o CAMINHO de tags até ele.
 *
 * ⚠️ Percorre com uma PILHA de tags abertas em vez de casar estrutura fixa:
 * cada geração do leiaute aninha diferente, e prever o aninhamento é
 * exatamente o que fez a leitura falhar. Aqui não se prevê nada — se lê.
 */
export function documentosNoXml(xml: string): OcorrenciaDeDocumento[] {
    const txt = String(xml || '');
    const achados: OcorrenciaDeDocumento[] = [];
    const pilha: string[] = [];
    // Tags de abertura, fechamento e auto-fechadas, mais o texto entre elas.
    const re = /<\/?([A-Za-z_][\w.:-]*)\b[^>]*?(\/?)>([^<]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
        const [bruto, nomeCru, autoFecha, texto] = m;
        // O prefixo de namespace (`ns2:Cnpj`) não é o nome da tag.
        const nome = nomeCru.includes(':') ? nomeCru.split(':').pop()! : nomeCru;
        if (bruto.startsWith('</')) { pilha.pop(); continue; }
        if (!autoFecha) pilha.push(nome);

        const d = soDigitos(texto);
        // Só CNPJ (14) e CPF (11) — número solto de outro campo não é documento.
        if (d.length === 14 || d.length === 11) {
            achados.push({ tag: nome, caminho: [...pilha], documento: d });
        }
        if (autoFecha) { /* nada a empilhar */ }
    }
    return achados;
}

export interface ProcuraDoCnpj {
    /** `true` quando o CNPJ da empresa está no arquivo (em qualquer tag). */
    encontrado: boolean;
    /** Onde ele aparece — o que precisa ser ensinado ao leitor. */
    ocorrencias: OcorrenciaDeDocumento[];
    /** Os outros documentos do arquivo, para a tela dizer de quem ele é. */
    outros: string[];
}

/**
 * Responde a pergunta que o colaborador não consegue responder sozinho:
 * **este XML tem o CNPJ da minha empresa, e em qual lugar?**
 */
export function procurarCnpjNoXml(xml: string, cnpjEmpresa: string): ProcuraDoCnpj {
    const alvo = soDigitos(cnpjEmpresa);
    const todos = documentosNoXml(xml);
    const ocorrencias = alvo ? todos.filter((o) => o.documento === alvo) : [];
    const outros = [...new Set(todos.map((o) => o.documento).filter((d) => d !== alvo))];
    return { encontrado: ocorrencias.length > 0, ocorrencias, outros };
}

/**
 * A frase da tela — com a AÇÃO de cada desfecho, que são OPOSTAS.
 *
 * 🚨 As duas respostas possíveis mandam a pessoa a lugares diferentes:
 *   · o CNPJ ESTÁ no arquivo ⇒ o defeito é do LEITOR do app, e o caminho da
 *     tag é a correção — ninguém precisa mexer em cadastro nenhum;
 *   · o CNPJ NÃO está ⇒ a recusa estava certa, e o arquivo é de outra empresa
 *     (a tela diz de quem, pelos documentos que ele traz).
 */
export function explicarProcura(p: ProcuraDoCnpj, cnpjEmpresa: string): string {
    const cnpj = soDigitos(cnpjEmpresa);
    if (p.encontrado) {
        const caminhos = [...new Set(p.ocorrencias.map((o) => o.caminho.join(' › ')))];
        return `O CNPJ ${cnpj} ESTÁ neste XML, em ${caminhos.join(' e ')}. `
            + 'Ou seja: o arquivo é desta empresa e o app é que ainda não sabe ler essa '
            + 'parte do leiaute. Copie esta linha e mande ao time — é ela que conserta.';
    }
    if (p.outros.length === 0) {
        return 'Não há nenhum CNPJ/CPF legível neste XML — o arquivo pode estar '
            + 'incompleto ou não ser uma nota. Confira o que foi baixado na origem.';
    }
    return `O CNPJ ${cnpj} NÃO aparece em lugar nenhum deste XML. Os documentos que ele traz `
        + `são: ${p.outros.join(', ')}. A recusa está certa: o arquivo é de outra empresa — `
        + 'confira se a empresa selecionada é a mesma da nota.';
}
