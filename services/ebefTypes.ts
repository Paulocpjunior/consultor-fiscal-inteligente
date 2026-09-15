export type EbefStatus =
  | "rascunho"
  | "em_revisao"
  | "aprovado"
  | "entrega_registrada"
  | "concluido"
  | "dispensa_revisada";
export interface EbefExterior {
  nascimento: string;
  naturalidade: string;
  residenciaFiscal: string;
  nif: string;
  endereco: string;
  email: string;
  representante: string;
}
export interface EbefPessoa {
  exterior?: EbefExterior;
  id: string;
  tipo: "PF" | "PJ";
  papelScp: "nenhum" | "ostensivo" | "participante";
  beneficiariosScp: string[];
  fundamentoScp: string;
  nome: string;
  documento: string;
  pais: string;
  administrador: boolean;
  controle: boolean;
  fundamentoControle: string;
  evidenciaId: string;
  assinatura: "pendente" | "confirmada" | "nao_aplicavel";
  assinaturaEvidenciaId: string;
  assinaturaJustificativa: string;
}
export interface EbefVinculo {
  id: string;
  titularId: string;
  entidadeId: string;
  capital: string;
  votos: string;
  inicio: string;
  fim: string;
  evidenciaId: string;
}
export interface EbefDraft {
  ano: number;
  dataBase: string;
  natureza:
    | "nao_informada"
    | "ltda"
    | "simples"
    | "scp"
    | "sa_fechada"
    | "slu"
    | "empresario_individual"
    | "outra";
  domicilio: "BR" | "exterior" | "nao_informado";
  receitaAnterior: string;
  receitaAno: number;
  evidenciaReceitaId: string;
  socioPJ: "sim" | "nao" | "nao_confirmado";
  evidenciaEnquadramentoId: string;
  enquadramentoConferido: boolean;
  matrizConferida: boolean;
  evento: "anual" | "inscricao" | "alteracao" | "passou_obrigada";
  dataEvento: string;
  evidenciaEventoId: string;
  prazoInterno: string;
  responsavel: string;
  observacoes: string;
  cadeiaConferida: boolean;
  controleConferido: boolean;
  pessoas: EbefPessoa[];
  vinculos: EbefVinculo[];
}
export interface EbefDocumento {
  id: string;
  nome: string;
  tamanho: number;
  sha256: string;
  criadoEm: string;
  autor: string;
}
export interface EbefBeneficiario {
  id: string;
  nome: string;
  percentual: string;
  caminhos: string[];
  criterios: string[];
}
export interface EbefAnalise {
  regra: string;
  enquadramento: "obrigada" | "dispensada" | "futura" | "inconclusivo";
  motivo: string;
  inicioObrigacao: string | null;
  prazoLegal: string | null;
  pendencias: string[];
  beneficiarios: EbefBeneficiario[];
  fonte: string;
}
export interface EbefRecord {
  revision: number;
  status: EbefStatus;
  draft: EbefDraft;
  documentos: EbefDocumento[];
  analise: EbefAnalise;
  atualizadoEm: string;
  atualizadoPor: string;
  entrega: { protocolo: string; data: string; documentoId: string } | null;
}
export interface EbefContext {
  empresaId: string;
  fonte: "simples" | "lucro";
  cnpj: string;
  nome: string;
}
export interface EbefHistorico {
  revision: number;
  status: EbefStatus;
  atualizadoEm: string;
  atualizadoPor: string;
  acao: string;
}
