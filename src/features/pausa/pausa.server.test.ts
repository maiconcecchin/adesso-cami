import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  admin: true as boolean,
  membro: true as boolean,
  pausada: false,
  erroLer: false,
  linhasGravadas: 1,
  gravado: [] as unknown[],
}));

vi.mock("@/features/mensageria/configuracao.server", () => ({
  membroAdmin: async () => (estado.admin ? "membro-1" : null),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            estado.erroLer
              ? { data: null, error: { message: "x" } }
              : { data: { pausada: estado.pausada }, error: null },
        }),
      }),
      update: (campos: unknown) => ({
        eq: () => ({
          select: async () => {
            estado.gravado.push(campos);
            return {
              data: Array.from({ length: estado.linhasGravadas }, () => ({ id: 1 })),
              error: null,
            };
          },
        }),
      }),
    }),
  },
}));

import { definirPausaLogica, lerPausaLogica } from "./pausa.server";

const ctx = () =>
  ({
    userId: "u1",
    supabase: { rpc: async () => ({ data: estado.membro, error: null }) },
  }) as never;

beforeEach(() => {
  estado.admin = true;
  estado.membro = true;
  estado.pausada = false;
  estado.erroLer = false;
  estado.linhasGravadas = 1;
  estado.gravado = [];
});

describe("pausa geral da Cami", () => {
  it("quem não é da equipe não lê nada", async () => {
    estado.membro = false;
    expect(await lerPausaLogica(ctx())).toEqual({ ok: false, erro: "sem_acesso" });
  });

  it("a equipe lê o estado, e só o admin pode mudar", async () => {
    estado.pausada = true;
    estado.admin = false;
    expect(await lerPausaLogica(ctx())).toEqual({ ok: true, pausada: true, podeMudar: false });
    estado.admin = true;
    expect(await lerPausaLogica(ctx())).toEqual({ ok: true, pausada: true, podeMudar: true });
  });

  it("erro do banco na leitura não vaza detalhe", async () => {
    estado.erroLer = true;
    expect(await lerPausaLogica(ctx())).toEqual({ ok: false, erro: "erro_ao_ler" });
  });

  it("atendente não consegue pausar", async () => {
    estado.admin = false;
    expect(await definirPausaLogica(ctx(), { pausada: true })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(estado.gravado).toEqual([]);
  });

  it("o admin pausa e retoma gravando só o campo pausada", async () => {
    expect(await definirPausaLogica(ctx(), { pausada: true })).toEqual({
      ok: true,
      pausada: true,
      podeMudar: true,
    });
    expect(await definirPausaLogica(ctx(), { pausada: false })).toMatchObject({ ok: true, pausada: false });
    expect(estado.gravado).toEqual([{ pausada: true }, { pausada: false }]);
  });

  it("sem linha gravada, avisa que não salvou", async () => {
    estado.linhasGravadas = 0;
    expect(await definirPausaLogica(ctx(), { pausada: true })).toEqual({ ok: false, erro: "erro_ao_gravar" });
  });
});
