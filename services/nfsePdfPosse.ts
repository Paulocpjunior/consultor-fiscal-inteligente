/**
 * nfsePdfPosse.ts — "este PDF é MESMO da empresa escolhida?" (PURO, testável)
 *
 * 🚨 O CASO (03/09, Paulo): *"lancei uma nota da J.P. PISSATO na empresa
 * SILVIO FREIRE, e o consultor não deu nenhum erro avisando de que eu estava
 * importando na empresa errada, e eu não me atentei tbm"*.
 *
 * 📌 O "não deu nenhum erro" era POR CONSTRUÇÃO, e isso foi MEDIDO: o
 * importador de NFS-e em PDF grava `empresaId`/`empresaCnpj`/`empresaNome` da
 * empresa SELECIONADA no combo e o prestador/tomador lidos do papel — e
 * **nunca compara os dois**. A única conferência que existia ali é a da
 * COMPETÊNCIA (`recorteDaNfsePdf`).
 *
 * 🔴 E A TELA PROMETIA O CONTRÁRIO, na cara: *"Apenas NFSe em que <CNPJ>
 * aparece como prestador ou tomador serão aceitas."* É a promessa que a tela
 * não cumpre (a família do ✕ de 14/08) no lugar mais caro: o documento entra
 * no LIVRO da empresa errada — infla o serviço tomado de uma e some da outra —,
 * e nada acende, porque a nota é legítima e o cadastro está certo.
 *
 * 📌 O CAMINHO DO XML JÁ CONFERIA desde 27/07 (`validarLoteParaEmpresa` na
 * tela + `matchCompanyAndDirection` no servidor, que é a autoridade). O do PDF
 * ficou de fora — é a "meia trava" de sempre: protege quem entra por uma porta
 * e deixa a outra aberta.
 */

/** Raiz (8 dígitos) — matriz e filial compartilham, mesmo critério da captura. */
export function raizCnpj(v: string | null | undefined): string {
    return String(v || '').replace(/\D/g, '').slice(0, 8);
}

const soDigitos = (v: string | null | undefined) => String(v || '').replace(/\D/g, '');

export interface EmpresaConhecidaPdf {
    id: string;
    nome: string;
    cnpj: string;
}

export type SituacaoPossePdf = 'desta-empresa' | 'de-outra-empresa' | 'nao-conferido';

export interface PossePdf {
    situacao: SituacaoPossePdf;
    /** Importar aqui é erro certo — os dois lados foram lidos e nenhum é ela. */
    bloquear: boolean;
    /** De que lado a empresa aparece, quando aparece. */
    lado: 'prestador' | 'tomador' | null;
    /** Quem o documento diz que é o dono, quando dá para saber. */
    donoProvavel: { cnpjCpf: string; nome: string; empresa: EmpresaConhecidaPdf | null } | null;
    /** Frase pronta — sempre com a AÇÃO. */
    mensagem: string;
}

/**
 * Confere a posse do PDF contra a empresa escolhida.
 *
 * ⚠️ TRÊS SITUAÇÕES, e a do meio é a que impede o alarme falso: neste MESMO
 * arquivo já está registrado que a DANFSe v2.0 de Brasília chega com
 * **prestador e tomador VAZIOS** (02/09, RADIO E TV SUL AMERICANA). Bloquear
 * ali seria acusar de "empresa errada" um PDF que o app não conseguiu LER — o
 * defeito de 31/08 (MARCOS ANTONIO ZAMBOLIN) na direção contrária, e ele
 * fecharia a única porta que essa nota tem.
 *
 * Por isso: só BLOQUEIA quando os DOIS lados foram lidos e nenhum é a empresa.
 * Lado ilegível vira aviso — e os campos de prestador/tomador da própria tela
 * são editáveis, então quem lê o papel completa e segue.
 */
export function conferirPosseDaNfsePdf(p: {
    prestadorCnpj?: string | null;
    prestadorNome?: string | null;
    tomadorCnpj?: string | null;
    tomadorNome?: string | null;
    empresaCnpj: string;
    empresaNome?: string | null;
    empresas?: EmpresaConhecidaPdf[];
}): PossePdf {
    const alvo = raizCnpj(p.empresaCnpj);
    const prest = soDigitos(p.prestadorCnpj);
    const toma = soDigitos(p.tomadorCnpj);

    if (!alvo) {
        return {
            situacao: 'nao-conferido', bloquear: false, lado: null, donoProvavel: null,
            mensagem: 'A empresa selecionada está sem CNPJ no cadastro — não dá para conferir de quem é '
                + 'este PDF. Confira o cadastro antes de importar.',
        };
    }

    if (prest && raizCnpj(prest) === alvo) {
        return {
            situacao: 'desta-empresa', bloquear: false, lado: 'prestador', donoProvavel: null,
            mensagem: 'Este PDF é desta empresa — ela aparece como PRESTADORA (serviço prestado, saída).',
        };
    }
    if (toma && raizCnpj(toma) === alvo) {
        return {
            situacao: 'desta-empresa', bloquear: false, lado: 'tomador', donoProvavel: null,
            mensagem: 'Este PDF é desta empresa — ela aparece como TOMADORA (serviço tomado, entrada).',
        };
    }

    // 🚨 SÓ AQUI SE AFIRMA "não é desta empresa": com os DOIS lados legíveis.
    if (prest && toma) {
        // O dono é a CONTRAPARTE que sobra depois de tirar quem não é cliente:
        // numa nota tomada por outro cliente, o dono é o TOMADOR. Sem saber a
        // direção, o app oferece os dois — e quando um deles É cliente
        // cadastrado, esse é o que ele nomeia (é o que resolve o clique).
        const porRaiz = new Map<string, EmpresaConhecidaPdf>();
        for (const e of p.empresas || []) {
            const r = raizCnpj(e.cnpj);
            if (r && !porRaiz.has(r)) porRaiz.set(r, e);
        }
        const cadastradoTomador = porRaiz.get(raizCnpj(toma)) || null;
        const cadastradoPrestador = porRaiz.get(raizCnpj(prest)) || null;
        const dono = cadastradoTomador
            ? { cnpjCpf: toma, nome: p.tomadorNome || '', empresa: cadastradoTomador }
            : cadastradoPrestador
                ? { cnpjCpf: prest, nome: p.prestadorNome || '', empresa: cadastradoPrestador }
                : { cnpjCpf: toma, nome: p.tomadorNome || '', empresa: null };

        const quem = dono.empresa
            ? `é de ${dono.empresa.nome} (${dono.cnpjCpf})`
            : `tem ${p.prestadorNome || prest} como prestador e ${p.tomadorNome || toma} como tomador — `
              + 'nenhum dos dois é a empresa selecionada';
        return {
            situacao: 'de-outra-empresa',
            bloquear: true,
            lado: null,
            donoProvavel: dono,
            mensagem: `Este PDF NÃO é de ${p.empresaNome || p.empresaCnpj}: ele ${quem}. `
                + (dono.empresa
                    ? 'Troque a empresa no combo acima antes de importar.'
                    : 'Confira o arquivo e o cadastro antes de importar.')
                + ' Importar aqui põe a nota no livro da empresa errada — e ela some do livro de quem é.',
        };
    }

    // ⚠️ LADO ILEGÍVEL NÃO É "de outra empresa" — é a DANFSe que este leitor não
    // sabe nomear (o caso RADIO E TV SUL AMERICANA, 02/09). Avisa e deixa
    // seguir: os campos de prestador e tomador desta tela são editáveis.
    const faltando = [!prest && 'o PRESTADOR', !toma && 'o TOMADOR'].filter(Boolean).join(' nem ');
    return {
        situacao: 'nao-conferido',
        bloquear: false,
        lado: null,
        donoProvavel: null,
        mensagem: `Não consegui LER ${faltando} neste PDF — o que NÃO quer dizer que ele seja de outra `
            + 'empresa (cada prefeitura tem o seu leiaute). CONFIRA se a empresa selecionada é mesmo a '
            + 'parte desta nota, e preencha o CNPJ abaixo antes de salvar: sem ele o documento entra sem '
            + 'a contraparte, e o EFD-Contribuições barra o arquivo inteiro por COD_PART vazio.',
    };
}
