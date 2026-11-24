// Funções de servidor da pausa geral da Cami. A lógica fica em pausa.server.ts, que entra por
// import() dentro do handler para não ir ao navegador.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EntradaPausa = { pausada: boolean };

export function lerEntradaPausa(entrada: unknown): EntradaPausa {
  const pausada = (entrada as { pausada?: unknown } | null)?.pausada;
  if (typeof pausada !== "boolean") throw new Error("entrada_invalida");
  return { pausada };
}

export const lerPausa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { lerPausaLogica } = await import("./pausa.server");
    return lerPausaLogica({ supabase: context.supabase, userId: context.userId });
  });

export const definirPausa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: EntradaPausa) => lerEntradaPausa(entrada))
  .handler(async ({ data, context }) => {
    const { definirPausaLogica } = await import("./pausa.server");
    return definirPausaLogica({ supabase: context.supabase, userId: context.userId }, data);
  });
