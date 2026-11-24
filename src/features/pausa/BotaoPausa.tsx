import { QueryClientContext, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";

import { useModoDados } from "@/features/plataforma/dados/ProvedorDados";
import { ASSISTANT_NAME } from "@/lib/brand";

import { definirPausa, lerPausa } from "./pausa.functions";
import estilos from "./BotaoPausa.module.css";

const CHAVE = ["pausa-da-cami"] as const;

/**
 * O interruptor "Pausar / Retomar" da Cami, no topo da plataforma. Pausada, ela não responde
 * ninguém e não gasta IA; as mensagens continuam chegando no Chat para a equipe. Só aparece no
 * modo banco, e só o admin muda (os outros veem o estado).
 */
export function BotaoPausa() {
  const modo = useModoDados();
  const temCliente = useContext(QueryClientContext) !== undefined;
  // Sem o modo banco (exemplo e testes) ou sem o cliente de consultas, não há o que pausar.
  if (modo !== "banco" || !temCliente) return null;
  return <BotaoPausaAtivo />;
}

function BotaoPausaAtivo() {
  const cliente = useQueryClient();
  const leitura = useQuery({
    queryKey: CHAVE,
    queryFn: () => lerPausa(),
    refetchInterval: 30_000,
  });
  const mudar = useMutation({
    mutationFn: (pausada: boolean) => definirPausa({ data: { pausada } }),
    onSuccess: (r) => {
      if (r.ok) cliente.setQueryData(CHAVE, r);
      else void cliente.invalidateQueries({ queryKey: CHAVE });
    },
  });

  const dado = leitura.data;
  if (!dado || !dado.ok) return null;

  const pausada = dado.pausada;
  const ocupado = mudar.isPending;
  const erro = mudar.data && !mudar.data.ok ? "Não deu para salvar. Tente de novo." : null;

  if (!dado.podeMudar) {
    return (
      <span className={pausada ? estilos["estadoPausada"] : estilos["estadoLigada"]} role="status">
        <span className={estilos["ponto"]} aria-hidden="true" />
        {ASSISTANT_NAME} {pausada ? "pausada" : "ligada"}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={pausada ? estilos["pausada"] : estilos["ligada"]}
      disabled={ocupado}
      aria-pressed={pausada}
      title={
        pausada
          ? `${ASSISTANT_NAME} está pausada: não responde ninguém. As mensagens continuam chegando no Chat. Ao retomar, ela não responde o que chegou durante a pausa. Clique para retomar.`
          : `Pausar a ${ASSISTANT_NAME}: ela para de responder e de gastar IA. As mensagens continuam chegando no Chat.`
      }
      onClick={() => mudar.mutate(!pausada)}
    >
      <span className={estilos["ponto"]} aria-hidden="true" />
      {ocupado ? "Salvando…" : pausada ? `${ASSISTANT_NAME} pausada · Retomar` : `${ASSISTANT_NAME} ligada · Pausar`}
      {erro ? (
        <span className={estilos["erro"]} role="alert">
          {erro}
        </span>
      ) : null}
    </button>
  );
}
