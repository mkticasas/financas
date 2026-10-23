// Edge Function: ler-comprovante
// Recebe a foto (base64, já reduzida no celular), pede ao Claude para extrair
// os dados num formato fixo e devolve JSON para o site preencher o formulário.
// Secret necessária: ANTHROPIC_API_KEY  (opcional: ANTHROPIC_MODEL)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "A chave ANTHROPIC_API_KEY não está configurada nas Secrets do Supabase." }, 500);
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5";

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Requisição inválida." }, 400); }
  const { image, mediaType = "image/jpeg", categorias = [], cartoes = [], hoje } = body || {};
  if (!image || typeof image !== "string") return json({ error: "Nenhuma imagem recebida." }, 400);
  if (image.length > 6_000_000) return json({ error: "Imagem grande demais. Tente outra foto." }, 413);

  const cats: string[] = Array.isArray(categorias) && categorias.length ? categorias.map(String) : ["Outros"];

  const tool = {
    name: "registrar_comprovante",
    description: "Registra os dados extraídos de um comprovante, nota fiscal, recibo ou print de pagamento.",
    input_schema: {
      type: "object",
      properties: {
        legivel: { type: "boolean", description: "false se a imagem não for um comprovante ou estiver ilegível" },
        tipo: { type: "string", enum: ["despesa", "receita"], description: "receita só se for dinheiro recebido (Pix recebido, salário)" },
        descricao: { type: "string", description: "Nome curto do estabelecimento ou do que foi pago, ex.: 'Mercado Tauste', 'Conta de luz CPFL'" },
        valor: { type: "number", description: "Valor TOTAL pago em reais, ex.: 123.45" },
        data: { type: "string", description: "Data da compra/pagamento no formato AAAA-MM-DD" },
        forma: { type: "string", enum: ["Pix", "Crédito", "Débito", "Dinheiro", "Boleto", "Transferência"] },
        parcelas: { type: "integer", description: "Número de parcelas (1 se à vista)" },
        cartao_final: { type: "string", description: "Últimos 4 dígitos do cartão, se aparecerem" },
        categoria: { type: "string", enum: cats },
        confianca: { type: "string", enum: ["alta", "media", "baixa"], description: "Quão seguro está do valor e da data" },
        duvidas: { type: "array", items: { type: "string", enum: ["valor", "data", "forma", "categoria", "descricao", "parcelas"] }, description: "Campos que precisam ser conferidos" },
      },
      required: ["legivel", "tipo", "descricao", "valor", "data", "forma", "parcelas", "categoria", "confianca", "duvidas"],
    },
  };

  const prompt = `Você lê comprovantes brasileiros (Pix, nota fiscal, cupom, fatura, print de app de banco ou delivery).
Hoje é ${hoje || new Date().toISOString().slice(0, 10)}. Se o ano não aparecer, use o ano mais provável perto de hoje.
Valores usam vírgula decimal (R$ 1.234,56 = 1234.56). Use o valor TOTAL efetivamente pago (com descontos e taxas).
Em compra parcelada, valor = total da compra e parcelas = número de vezes.
Cartões cadastrados (final): ${Array.isArray(cartoes) && cartoes.length ? cartoes.join(", ") : "nenhum"}.
Escolha a categoria mais adequada da lista. Marque em "duvidas" tudo o que não estiver claro na imagem.`;

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        tools: [tool],
        tool_choice: { type: "tool", name: "registrar_comprovante" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
  } catch (e) {
    return json({ error: "Não consegui falar com a IA. Tente de novo.", detalhe: String(e) }, 502);
  }

  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = out?.error?.message || `Erro ${r.status}`;
    const amigavel = r.status === 401 ? "Chave da Anthropic inválida."
      : /credit|balance/i.test(msg) ? "Créditos da Anthropic acabaram ou venceram."
      : "A IA recusou a leitura.";
    return json({ error: amigavel, detalhe: msg }, 502);
  }
  const bloco = (out.content || []).find((c: any) => c.type === "tool_use");
  if (!bloco) return json({ error: "A IA não devolveu os dados. Tente outra foto." }, 502);
  return json({ dados: bloco.input, modelo: model });
});
