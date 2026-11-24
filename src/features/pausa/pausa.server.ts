// Pausa geral da Cami (configuracao.pausada). Enquanto estiver ligada, o banco não entrega rodadas
// ao motor (pegar_rodadas, em banco/02-inicio.sql): a Cami não responde e não gasta IA, e as
// mensagens continuam chegando no Chat. Ler é para qualquer membro da equipe; mudar é só do admin.
// Usa o supabaseAdmin (ignora RLS), por isso só entra por pausa.functions.ts, dentro do handler.
import { membroAdmin, type ContextoUsuario } from "@/features/mensageria/configuracao.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ResultadoPausa =
  | { ok: true; pausada: boolean; podeMudar: boolean }
  | { ok: false; erro: "sem_acesso" | "erro_ao_ler" | "erro_ao_gravar" };

async function lerPausada(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("configuracao")
    .select("pausada")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error("ler_pausa");
  return data?.pausada === true;
}

async function ehMembro(ctx: ContextoUsuario): Promise<boolean> {
  const r = await ctx.supabase.rpc("eh_membro");
  return !r.error && r.data === true;
}

export async function lerPausaLogica(ctx: ContextoUsuario): Promise<ResultadoPausa> {
  if (!(await ehMembro(ctx))) return { ok: false, erro: "sem_acesso" };
  try {
    const pausada = await lerPausada();
    const podeMudar = (await membroAdmin(ctx)) !== null;
    return { ok: true, pausada, podeMudar };
  } catch {
    return { ok: false, erro: "erro_ao_ler" };
  }
}

export async function definirPausaLogica(
  ctx: ContextoUsuario,
  entrada: { pausada: boolean },
): Promise<ResultadoPausa> {
  if ((await membroAdmin(ctx)) === null) return { ok: false, erro: "sem_acesso" };
  const r = await supabaseAdmin
    .from("configuracao")
    .update({ pausada: entrada.pausada })
    .eq("id", 1)
    .select("id");
  if (r.error || (r.data?.length ?? 0) !== 1) return { ok: false, erro: "erro_ao_gravar" };
  return { ok: true, pausada: entrada.pausada, podeMudar: true };
}
